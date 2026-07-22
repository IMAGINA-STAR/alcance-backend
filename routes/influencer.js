const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'facebook'];

// GET /api/influencer/profile
// Devuelve el perfil del influencer autenticado (incluye photo_url y el
// detalle de sus redes sociales) para que el dashboard pueda pintarlo todo
// sin llamadas adicionales al iniciar sesión.
router.get('/profile', requireAuth, requireRole('influencer'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM influencer_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró tu perfil de influencer.' });
    }
    const profile = result.rows[0];

    const socialResult = await pool.query(
      `SELECT id, platform, handle, followers_count, created_at
       FROM influencer_social_accounts WHERE influencer_id = $1 ORDER BY platform`,
      [profile.id]
    );
    profile.social_accounts = socialResult.rows;

    res.json(profile);
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

// GET /api/influencer/social-accounts
// Lista las redes sociales del influencer autenticado.
router.get('/social-accounts', requireAuth, requireRole('influencer'), async (req, res) => {
  try {
    const profileResult = await pool.query('SELECT id FROM influencer_profiles WHERE user_id = $1', [req.user.id]);
    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró tu perfil de influencer.' });
    }

    const result = await pool.query(
      `SELECT id, platform, handle, followers_count, created_at
       FROM influencer_social_accounts WHERE influencer_id = $1 ORDER BY platform`,
      [profileResult.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tus redes sociales.' });
  }
});

// POST /api/influencer/social-accounts
// Agrega o actualiza (upsert) la red social de una plataforma del influencer
// autenticado, y recalcula influencer_profiles.followers como la suma de
// followers_count de todas sus plataformas.
router.post('/social-accounts', requireAuth, requireRole('influencer'), async (req, res) => {
  const { platform, handle, followers_count } = req.body;

  if (!SOCIAL_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `platform debe ser una de: ${SOCIAL_PLATFORMS.join(', ')}.` });
  }
  if (!handle || !handle.trim()) {
    return res.status(400).json({ error: 'handle es obligatorio.' });
  }
  const followersCount = followers_count === undefined ? 0 : Number(followers_count);
  if (!Number.isInteger(followersCount) || followersCount < 0) {
    return res.status(400).json({ error: 'followers_count debe ser un entero mayor o igual a 0.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const profileResult = await client.query('SELECT id FROM influencer_profiles WHERE user_id = $1', [req.user.id]);
    if (profileResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No se encontró tu perfil de influencer.' });
    }
    const influencerId = profileResult.rows[0].id;

    const upsertResult = await client.query(
      `INSERT INTO influencer_social_accounts (influencer_id, platform, handle, followers_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (influencer_id, platform)
       DO UPDATE SET handle = EXCLUDED.handle, followers_count = EXCLUDED.followers_count
       RETURNING *`,
      [influencerId, platform, handle.trim(), followersCount]
    );

    await client.query(
      `UPDATE influencer_profiles SET followers = COALESCE(
        (SELECT SUM(followers_count) FROM influencer_social_accounts WHERE influencer_id = $1), 0
      ) WHERE id = $1`,
      [influencerId]
    );

    await client.query('COMMIT');
    res.status(201).json(upsertResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al guardar tu red social.' });
  } finally {
    client.release();
  }
});

// PATCH /api/influencer/social-accounts/:id
// Actualiza el handle y/o followers_count de una red social propia (no
// permite cambiar la plataforma; para eso se borra y se crea de nuevo).
router.patch('/social-accounts/:id', requireAuth, requireRole('influencer'), async (req, res) => {
  const { id } = req.params;
  const { handle, followers_count } = req.body;

  if (handle !== undefined && !handle.trim()) {
    return res.status(400).json({ error: 'handle no puede estar vacío.' });
  }
  let followersCount;
  if (followers_count !== undefined) {
    followersCount = Number(followers_count);
    if (!Number.isInteger(followersCount) || followersCount < 0) {
      return res.status(400).json({ error: 'followers_count debe ser un entero mayor o igual a 0.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownerCheck = await client.query(
      `SELECT sa.id, sa.influencer_id FROM influencer_social_accounts sa
       JOIN influencer_profiles ip ON ip.id = sa.influencer_id
       WHERE sa.id = $1 AND ip.user_id = $2`,
      [id, req.user.id]
    );
    if (ownerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No puedes editar una red social que no es tuya.' });
    }
    const influencerId = ownerCheck.rows[0].influencer_id;

    const updateResult = await client.query(
      `UPDATE influencer_social_accounts SET
        handle = COALESCE($1, handle),
        followers_count = COALESCE($2, followers_count)
       WHERE id = $3 RETURNING *`,
      [handle ? handle.trim() : null, followersCount ?? null, id]
    );

    await client.query(
      `UPDATE influencer_profiles SET followers = COALESCE(
        (SELECT SUM(followers_count) FROM influencer_social_accounts WHERE influencer_id = $1), 0
      ) WHERE id = $1`,
      [influencerId]
    );

    await client.query('COMMIT');
    res.json(updateResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar tu red social.' });
  } finally {
    client.release();
  }
});

// DELETE /api/influencer/social-accounts/:id
// Elimina una red social propia y recalcula influencer_profiles.followers.
router.delete('/social-accounts/:id', requireAuth, requireRole('influencer'), async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownerCheck = await client.query(
      `SELECT sa.id, sa.influencer_id FROM influencer_social_accounts sa
       JOIN influencer_profiles ip ON ip.id = sa.influencer_id
       WHERE sa.id = $1 AND ip.user_id = $2`,
      [id, req.user.id]
    );
    if (ownerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No puedes eliminar una red social que no es tuya.' });
    }
    const influencerId = ownerCheck.rows[0].influencer_id;

    await client.query('DELETE FROM influencer_social_accounts WHERE id = $1', [id]);

    await client.query(
      `UPDATE influencer_profiles SET followers = COALESCE(
        (SELECT SUM(followers_count) FROM influencer_social_accounts WHERE influencer_id = $1), 0
      ) WHERE id = $1`,
      [influencerId]
    );

    await client.query('COMMIT');
    res.json({ message: 'Red social eliminada.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar tu red social.' });
  } finally {
    client.release();
  }
});

module.exports = router;
