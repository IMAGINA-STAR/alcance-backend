const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/payouts
// Lista las transacciones ya cobradas al anunciante pero pendientes de
// pagarle al influencer, con sus datos bancarios.
router.get('/payouts', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id AS transaction_id, t.amount, t.influencer_amount, t.created_at, t.paid_at,
              u.name AS influencer_name, u.email AS influencer_email,
              ip.bank_name, ip.bank_account_number
       FROM transactions t
       JOIN requests r ON r.id = t.request_id
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       JOIN users u ON u.id = ip.user_id
       WHERE t.payout_status = 'pendiente' AND t.status = 'paid'
       ORDER BY t.paid_at ASC NULLS LAST, t.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los pagos pendientes.' });
  }
});

// PATCH /api/admin/payouts/:transactionId/mark-paid
// Marca una transacción como pagada al influencer, guardando la fecha y
// una referencia de pago opcional.
router.patch('/payouts/:transactionId/mark-paid', requireAuth, requireRole('admin'), async (req, res) => {
  const { transactionId } = req.params;
  const { payout_reference } = req.body;

  try {
    const result = await pool.query(
      `UPDATE transactions
       SET payout_status = 'pagado', payout_date = CURRENT_DATE, payout_reference = $1
       WHERE id = $2 AND payout_status = 'pendiente'
       RETURNING *`,
      [payout_reference || null, transactionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró esa transacción o ya fue pagada.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al marcar la transacción como pagada.' });
  }
});

module.exports = router;
