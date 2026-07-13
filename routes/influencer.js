const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/influencer/profile
// Devuelve el perfil del influencer autenticado (incluye photo_url) para que
// el dashboard pueda mostrar la foto ya guardada al iniciar sesión.
router.get('/profile', requireAuth, requireRole('influencer'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM influencer_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró tu perfil de influencer.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tu perfil.' });
  }
});

// PATCH /api/influencer/profile
// Actualiza el perfil del influencer autenticado. Por ahora solo photo_url
// (enlace externo a la foto de perfil, sin subida de archivos).
router.patch('/profile', requireAuth, requireRole('influencer'), async (req, res) => {
  const { photo_url } = req.body;

  try {
    const result = await pool.query(
      `UPDATE influencer_profiles SET photo_url = $1 WHERE user_id = $2 RETURNING *`,
      [photo_url || null, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró tu perfil de influencer.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar tu perfil.' });
  }
});

// GET /api/influencer/earnings
// Devuelve el resumen de ganancias del influencer autenticado: total pendiente
// de cobrar (ya pagado por el anunciante, pero aún no pagado por la plataforma),
// total ya pagado históricamente, y el detalle de sus transacciones.
router.get('/earnings', requireAuth, requireRole('influencer'), async (req, res) => {
  try {
    const totalsResult = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN t.payout_status = 'pendiente' AND t.status = 'paid' THEN t.influencer_amount ELSE 0 END), 0) AS total_pendiente,
         COALESCE(SUM(CASE WHEN t.payout_status = 'pagado' THEN t.influencer_amount ELSE 0 END), 0) AS total_pagado
       FROM transactions t
       JOIN requests r ON r.id = t.request_id
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       WHERE ip.user_id = $1`,
      [req.user.id]
    );

    const transactionsResult = await pool.query(
      `SELECT t.id, t.amount, t.influencer_amount, t.status AS transaction_status,
              t.payout_status, t.payout_date, t.payout_reference, t.created_at, t.paid_at
       FROM transactions t
       JOIN requests r ON r.id = t.request_id
       JOIN spaces s ON s.id = r.space_id
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       WHERE ip.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    res.json({
      total_pendiente: totalsResult.rows[0].total_pendiente,
      total_pagado: totalsResult.rows[0].total_pagado,
      transactions: transactionsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tus ganancias.' });
  }
});

// PATCH /api/influencer/bank-info
// Actualiza los datos bancarios del influencer autenticado, para poder pagarle.
router.patch('/bank-info', requireAuth, requireRole('influencer'), async (req, res) => {
  const { bank_name, bank_account_number } = req.body;

  try {
    const result = await pool.query(
      `UPDATE influencer_profiles SET bank_name = $1, bank_account_number = $2 WHERE user_id = $3 RETURNING *`,
      [bank_name || null, bank_account_number || null, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró tu perfil de influencer.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar tus datos bancarios.' });
  }
});

module.exports = router;
