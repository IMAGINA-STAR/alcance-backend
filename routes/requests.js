const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createCheckout, getCheckout } = require('../services/recurrente');
const { markTransactionPaid } = require('../services/transactions');
const { notify } = require('../services/notifications');

const router = express.Router();
const COMMISSION_RATE = 12.0; // porcentaje que se queda la plataforma
const PAYABLE_STATUSES = ['delivered', 'completed']; // estados en los que ya se puede cobrar

// POST /api/requests
// Un anunciante envía una solicitud para un espacio publicado.
router.post('/', requireAuth, requireRole('anunciante'), async (req, res) => {
  const { space_id, message, offered_budget } = req.body;
  if (!space_id || !offered_budget) {
    return res.status(400).json({ error: 'space_id y offered_budget son obligatorios.' });
  }

  try {
    const advertiserResult = await pool.query('SELECT id FROM advertiser_profiles WHERE user_id = $1', [req.user.id]);
    if (advertiserResult.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró tu perfil de anunciante.' });
    }
    const advertiserId = advertiserResult.rows[0].id;

    const result = await pool.query(
      `WITH new_request AS (
         INSERT INTO requests (space_id, advertiser_id, message, offered_budget)
         VALUES ($1, $2, $3, $4) RETURNING *
       )
       SELECT nr.*, u.id AS influencer_user_id, s.content_type, ap.brand_name
       FROM new_request nr
       JOIN spaces s ON s.id = nr.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       JOIN users u ON u.id = ip.user_id
       JOIN advertiser_profiles ap ON ap.id = nr.advertiser_id`,
      [space_id, advertiserId, message || null, offered_budget]
    );
    const row = result.rows[0];

    notify({
      userId: row.influencer_user_id,
      type: 'new_request',
      title: 'Nueva solicitud de colaboración',
      body: `${row.brand_name} te envió una propuesta para "${row.content_type}" por Q${Number(offered_budget).toFixed(2)}.`,
      link: '/dashboard',
    }).catch((err) => console.error('Error creando notificación de nueva solicitud:', err));

    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar la solicitud.' });
  }
});

// GET /api/requests/received
// El influencer ve las solicitudes que le han hecho a sus espacios.
router.get('/received', requireAuth, requireRole('influencer'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.message, r.offered_budget, r.status, r.created_at,
              r.evidence_url, r.evidence_note, r.delivered_at,
              s.content_type, ap.brand_name, u.email AS advertiser_email,
              COALESCE(t.status, NULL) AS payment_status
       FROM requests r
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
       JOIN users u ON u.id = ap.user_id
       LEFT JOIN transactions t ON t.request_id = r.id
       WHERE ip.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las solicitudes.' });
  }
});

// GET /api/requests/sent
// El anunciante ve el estado de las solicitudes que ha enviado.
router.get('/sent', requireAuth, requireRole('anunciante'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.message, r.offered_budget, r.status, r.created_at,
              r.evidence_url, r.evidence_note, r.delivered_at,
              s.content_type, u.name AS influencer_name,
              COALESCE(t.status, NULL) AS payment_status
       FROM requests r
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       JOIN users u ON u.id = ip.user_id
       JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
       LEFT JOIN transactions t ON t.request_id = r.id
       WHERE ap.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tus solicitudes.' });
  }
});

// PATCH /api/requests/:id/respond
// El influencer acepta o rechaza una solicitud. Si acepta, se genera la transacción.
router.patch('/:id/respond', requireAuth, requireRole('influencer'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'accepted' | 'rejected'

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status debe ser "accepted" o "rejected".' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownerCheck = await client.query(
      `SELECT r.id, r.offered_budget FROM requests r
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       WHERE r.id = $1 AND ip.user_id = $2`,
      [id, req.user.id]
    );
    if (ownerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Esta solicitud no corresponde a uno de tus espacios.' });
    }

    const updated = await client.query(
      `UPDATE requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (status === 'accepted') {
      const amount = ownerCheck.rows[0].offered_budget;
      const commissionAmount = (amount * COMMISSION_RATE) / 100;
      const payoutAmount = amount - commissionAmount;

      await client.query(
        `INSERT INTO transactions (request_id, amount, commission_rate, commission_amount, payout_amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, amount, COMMISSION_RATE, commissionAmount, payoutAmount]
      );
    }

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al responder la solicitud.' });
  } finally {
    client.release();
  }
});

// POST /api/requests/:id/mark-delivered
// El influencer marca su colaboración como entregada, adjuntando el link
// (o nota) de evidencia. Solo se permite si la solicitud ya fue aceptada.
router.post('/:id/mark-delivered', requireAuth, requireRole('influencer'), async (req, res) => {
  const { id } = req.params;
  const { evidence_url, evidence_note } = req.body;

  if (!evidence_url || !evidence_url.trim()) {
    return res.status(400).json({ error: 'evidence_url es obligatorio.' });
  }

  try {
    const ownerCheck = await pool.query(
      `SELECT r.id, r.status FROM requests r
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       WHERE r.id = $1 AND ip.user_id = $2`,
      [id, req.user.id]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Esta solicitud no corresponde a uno de tus espacios.' });
    }
    if (ownerCheck.rows[0].status !== 'accepted') {
      return res.status(400).json({ error: 'Solo puedes marcar como entregadas solicitudes que ya fueron aceptadas.' });
    }

    const updated = await pool.query(
      `UPDATE requests
       SET status = 'delivered', evidence_url = $1, evidence_note = $2, delivered_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [evidence_url.trim(), evidence_note ? evidence_note.trim() : null, id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al marcar la solicitud como entregada.' });
  }
});

// POST /api/requests/:id/checkout
// El anunciante genera un link de pago de Recurrente para una solicitud ya entregada.
router.post('/:id/checkout', requireAuth, requireRole('anunciante'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT r.id, r.status, s.content_type, u.name AS influencer_name,
              t.id AS transaction_id, t.amount, t.status AS transaction_status, t.payment_reference
       FROM requests r
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       JOIN users u ON u.id = ip.user_id
       JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
       LEFT JOIN transactions t ON t.request_id = r.id
       WHERE r.id = $1 AND ap.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró esa solicitud entre las tuyas.' });
    }
    const row = result.rows[0];

    if (!PAYABLE_STATUSES.includes(row.status)) {
      return res.status(400).json({ error: 'Solo puedes pagar solicitudes que ya fueron marcadas como entregadas.' });
    }
    if (row.transaction_status === 'paid') {
      return res.status(400).json({ error: 'Esta solicitud ya fue pagada.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const checkout = await createCheckout({
      description: `${row.content_type} — ${row.influencer_name}`,
      amountInQuetzales: row.amount,
      successUrl: `${frontendUrl}/pago-exitoso?request_id=${id}`,
      cancelUrl: `${frontendUrl}/pago-cancelado?request_id=${id}`,
      metadata: { request_id: String(id), transaction_id: String(row.transaction_id) },
    });

    await pool.query(
      `UPDATE transactions SET payment_reference = $1 WHERE id = $2`,
      [checkout.id, row.transaction_id]
    );

    res.json({ checkout_url: checkout.checkout_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al generar el link de pago.' });
  }
});

// GET /api/requests/:id/payment-status
// El anunciante consulta si su pago ya se completó. También sirve para
// confirmar pagos de PRUEBA, ya que Recurrente no manda webhooks en modo TEST.
router.get('/:id/payment-status', requireAuth, requireRole('anunciante'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT t.id AS transaction_id, t.status, t.payment_reference
       FROM transactions t
       JOIN requests r ON r.id = t.request_id
       JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
       WHERE r.id = $1 AND ap.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró una transacción para esta solicitud.' });
    }
    const tx = result.rows[0];

    // Si ya la marcamos como pagada (por webhook, en modo LIVE), respondemos directo.
    if (tx.status === 'paid') {
      return res.json({ status: 'paid' });
    }

    // Respaldo para modo TEST: consultamos directo a Recurrente el estado del checkout.
    if (tx.payment_reference) {
      const checkout = await getCheckout(tx.payment_reference);
      if (checkout.status === 'paid' || checkout.status === 'succeeded') {
        await markTransactionPaid({ transactionId: tx.transaction_id });
        return res.json({ status: 'paid' });
      }
    }

    res.json({ status: tx.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al verificar el estado del pago.' });
  }
});

// Verifica si userId es el anunciante o el influencer dueño de la solicitud id.
// Devuelve null si la solicitud no existe, false si no tiene permiso, true si sí.
async function checkRequestAccess(id, userId) {
  const result = await pool.query(
    `SELECT ap.user_id AS advertiser_user_id, ip.user_id AS influencer_user_id
     FROM requests r
     JOIN spaces s ON s.id = r.space_id
     JOIN influencer_profiles ip ON ip.id = s.influencer_id
     JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
     WHERE r.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const { advertiser_user_id, influencer_user_id } = result.rows[0];
  return userId === advertiser_user_id || userId === influencer_user_id;
}

// Devuelve los datos de ambas partes de una solicitud (usados para saber a
// quién notificar un mensaje nuevo), o null si la solicitud no existe.
async function getRequestParties(id) {
  const result = await pool.query(
    `SELECT ap.user_id AS advertiser_user_id, adv_u.name AS advertiser_name,
            ip.user_id AS influencer_user_id, inf_u.name AS influencer_name
     FROM requests r
     JOIN spaces s ON s.id = r.space_id
     JOIN influencer_profiles ip ON ip.id = s.influencer_id
     JOIN users inf_u ON inf_u.id = ip.user_id
     JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
     JOIN users adv_u ON adv_u.id = ap.user_id
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

// GET /api/requests/:id/messages
// Devuelve el historial de chat de una solicitud, del más viejo al más nuevo.
router.get('/:id/messages', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const access = await checkRequestAccess(id, req.user.id);
    if (access === null) {
      return res.status(404).json({ error: 'No se encontró esa solicitud.' });
    }
    if (access === false) {
      return res.status(403).json({ error: 'No tienes permiso para ver esta conversación.' });
    }

    const result = await pool.query(
      `SELECT m.id, m.request_id, m.sender_id, m.body, m.created_at, u.name AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.request_id = $1
       ORDER BY m.created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los mensajes.' });
  }
});

// POST /api/requests/:id/messages
// Envía un mensaje nuevo en el chat de una solicitud.
router.post('/:id/messages', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { body } = req.body;

  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
  }

  try {
    const parties = await getRequestParties(id);
    if (parties === null) {
      return res.status(404).json({ error: 'No se encontró esa solicitud.' });
    }
    const isAdvertiser = req.user.id === parties.advertiser_user_id;
    const isInfluencer = req.user.id === parties.influencer_user_id;
    if (!isAdvertiser && !isInfluencer) {
      return res.status(403).json({ error: 'No tienes permiso para escribir en esta conversación.' });
    }

    const result = await pool.query(
      `WITH new_message AS (
         INSERT INTO messages (request_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *
       )
       SELECT nm.id, nm.request_id, nm.sender_id, nm.body, nm.created_at, u.name AS sender_name
       FROM new_message nm
       JOIN users u ON u.id = nm.sender_id`,
      [id, req.user.id, body.trim()]
    );
    const savedMessage = result.rows[0];

    const recipientId = isAdvertiser ? parties.influencer_user_id : parties.advertiser_user_id;
    const recipientLink = isAdvertiser ? '/dashboard' : '/mis-solicitudes';
    notify({
      userId: recipientId,
      type: 'new_message',
      title: 'Nuevo mensaje',
      body: `${savedMessage.sender_name} te escribió: "${savedMessage.body.slice(0, 140)}"`,
      link: recipientLink,
    }).catch((err) => console.error('Error creando notificación de nuevo mensaje:', err));

    res.status(201).json(savedMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar el mensaje.' });
  }
});

// POST /api/requests/:id/reviews
// El anunciante o el influencer de una solicitud ya pagada la califica.
router.post('/:id/reviews', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { rating, comment } = req.body;

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'rating debe ser un número entero entre 1 y 5.' });
  }

  try {
    const access = await checkRequestAccess(id, req.user.id);
    if (access === null) {
      return res.status(404).json({ error: 'No se encontró esa solicitud.' });
    }
    if (access === false) {
      return res.status(403).json({ error: 'No tienes permiso para calificar esta solicitud.' });
    }

    const txResult = await pool.query('SELECT status FROM transactions WHERE request_id = $1', [id]);
    if (txResult.rows.length === 0 || txResult.rows[0].status !== 'paid') {
      return res.status(400).json({ error: 'Solo puedes calificar solicitudes que ya fueron pagadas.' });
    }

    const existing = await pool.query(
      'SELECT id FROM reviews WHERE request_id = $1 AND reviewer_id = $2',
      [id, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ya calificaste esta solicitud.' });
    }

    const result = await pool.query(
      `INSERT INTO reviews (request_id, reviewer_id, rating, comment)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, req.user.id, ratingNum, comment || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar la calificación.' });
  }
});

// GET /api/requests/:id/reviews
// Devuelve las reseñas existentes de una solicitud (para saber si cada parte ya calificó).
router.get('/:id/reviews', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const access = await checkRequestAccess(id, req.user.id);
    if (access === null) {
      return res.status(404).json({ error: 'No se encontró esa solicitud.' });
    }
    if (access === false) {
      return res.status(403).json({ error: 'No tienes permiso para ver las calificaciones de esta solicitud.' });
    }

    const result = await pool.query(
      `SELECT id, request_id, reviewer_id, rating, comment, created_at
       FROM reviews
       WHERE request_id = $1
       ORDER BY created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las calificaciones.' });
  }
});

module.exports = router;
