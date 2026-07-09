const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const COMMISSION_RATE = 12.0; // porcentaje que se queda la plataforma

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
      `INSERT INTO requests (space_id, advertiser_id, message, offered_budget)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [space_id, advertiserId, message || null, offered_budget]
    );
    res.status(201).json(result.rows[0]);
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
              s.content_type, ap.brand_name, u.email AS advertiser_email
       FROM requests r
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
       JOIN users u ON u.id = ap.user_id
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
              s.content_type, u.name AS influencer_name
       FROM requests r
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       JOIN users u ON u.id = ip.user_id
       JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
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

module.exports = router;
