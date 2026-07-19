// Único lugar que marca una transacción como pagada. Antes esto ocurría
// por separado en routes/webhooks.js (modo LIVE) y en el fallback de
// routes/requests.js (modo TEST, sin webhooks de Recurrente); ahora ambos
// llaman aquí para no duplicar el UPDATE ni la notificación a las partes.
const pool = require('../db/pool');
const { notify } = require('./notifications');

// Acepta transactionId (id interno) o paymentReference (checkout id de
// Recurrente) — cada llamador usa el identificador que ya tiene a mano.
async function markTransactionPaid({ transactionId, paymentReference } = {}) {
  const whereColumn = transactionId ? 'id' : 'payment_reference';
  const param = transactionId || paymentReference;
  if (!param) throw new Error('Se requiere transactionId o paymentReference.');

  const result = await pool.query(
    `UPDATE transactions SET status = 'paid', paid_at = NOW()
     WHERE ${whereColumn} = $1 AND status != 'paid' RETURNING *`,
    [param]
  );
  // Ya estaba pagada (o no existe): no hay nada nuevo que notificar.
  if (result.rows.length === 0) return null;

  const tx = result.rows[0];

  const partiesResult = await pool.query(
    `SELECT ap_u.id AS advertiser_user_id, ap_u.name AS advertiser_name,
            inf_u.id AS influencer_user_id,
            s.content_type
     FROM requests r
     JOIN spaces s ON s.id = r.space_id
     JOIN influencer_profiles ip ON ip.id = s.influencer_id
     JOIN users inf_u ON inf_u.id = ip.user_id
     JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
     JOIN users ap_u ON ap_u.id = ap.user_id
     WHERE r.id = $1`,
    [tx.request_id]
  );
  const parties = partiesResult.rows[0];

  if (parties) {
    const amountFmt = Number(tx.amount).toFixed(2);

    notify({
      userId: parties.advertiser_user_id,
      type: 'payment_confirmed',
      title: 'Pago confirmado',
      body: `Tu pago de Q${amountFmt} por "${parties.content_type}" fue confirmado.`,
      link: '/mis-solicitudes',
    }).catch((err) => console.error('Error creando notificación de pago (anunciante):', err));

    notify({
      userId: parties.influencer_user_id,
      type: 'payment_confirmed',
      title: '¡Recibiste un pago!',
      body: `${parties.advertiser_name} pagó Q${amountFmt} por "${parties.content_type}".`,
      link: '/dashboard',
    }).catch((err) => console.error('Error creando notificación de pago (influencer):', err));
  }

  return tx;
}

module.exports = { markTransactionPaid };
