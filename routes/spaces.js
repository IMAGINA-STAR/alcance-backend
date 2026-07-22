const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/spaces
// Catálogo público con filtros opcionales: category, minFollowers, maxPrice
router.get('/', async (req, res) => {
  const { category, minFollowers, maxPrice } = req.query;

  const conditions = ['s.active = TRUE'];
  const values = [];

  if (category) {
    values.push(category);
    conditions.push(`ip.category = $${values.length}`);
  }
  if (minFollowers) {
    values.push(minFollowers);
    conditions.push(`ip.followers >= $${values.length}`);
  }
  if (maxPrice) {
    values.push(maxPrice);
    conditions.push(`s.price <= $${values.length}`);
  }

  const query = `
    SELECT
      s.id, s.content_type, s.price, s.description, s.created_at,
      ip.id AS influencer_id, ip.category, ip.followers, ip.engagement_rate, ip.instagram_handle, ip.photo_url,
      u.name AS influencer_name,
      rt.avg_rating, rt.review_count,
      COALESCE((
        SELECT json_agg(json_build_object(
          'platform', sa.platform, 'handle', sa.handle, 'followers_count', sa.followers_count
        ) ORDER BY sa.platform)
        FROM influencer_social_accounts sa
        WHERE sa.influencer_id = ip.id
      ), '[]'::json) AS social_accounts
    FROM spaces s
    JOIN influencer_profiles ip ON ip.id = s.influencer_id
    JOIN users u ON u.id = ip.user_id
    LEFT JOIN (
      SELECT s2.influencer_id,
             ROUND(AVG(rv.rating)::numeric, 2) AS avg_rating,
             COUNT(rv.id) AS review_count
      FROM reviews rv
      JOIN requests r ON r.id = rv.request_id
      JOIN transactions t ON t.request_id = r.id AND t.status = 'paid'
      JOIN spaces s2 ON s2.id = r.space_id
      JOIN advertiser_profiles ap ON ap.id = r.advertiser_id
      WHERE rv.reviewer_id = ap.user_id
      GROUP BY s2.influencer_id
    ) rt ON rt.influencer_id = ip.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.created_at DESC
  `;

  try {
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el catálogo de espacios.' });
  }
});

// POST /api/spaces
// Solo un influencer autenticado puede publicar un espacio propio.
router.post('/', requireAuth, requireRole('influencer'), async (req, res) => {
  const { content_type, price, description } = req.body;
  if (!content_type || !price) {
    return res.status(400).json({ error: 'content_type y price son obligatorios.' });
  }

  try {
    const profileResult = await pool.query('SELECT id FROM influencer_profiles WHERE user_id = $1', [req.user.id]);
    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró tu perfil de influencer.' });
    }
    const influencerId = profileResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO spaces (influencer_id, content_type, price, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [influencerId, content_type, price, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al publicar el espacio.' });
  }
});

// PATCH /api/spaces/:id
// Editar o desactivar un espacio propio.
router.patch('/:id', requireAuth, requireRole('influencer'), async (req, res) => {
  const { id } = req.params;
  const { content_type, price, description, active } = req.body;

  try {
    const ownerCheck = await pool.query(
      `SELECT s.id FROM spaces s
       JOIN influencer_profiles ip ON ip.id = s.influencer_id
       WHERE s.id = $1 AND ip.user_id = $2`,
      [id, req.user.id]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'No puedes editar un espacio que no es tuyo.' });
    }

    const result = await pool.query(
      `UPDATE spaces SET
        content_type = COALESCE($1, content_type),
        price = COALESCE($2, price),
        description = COALESCE($3, description),
        active = COALESCE($4, active),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [content_type, price, description, active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el espacio.' });
  }
});

module.exports = router;
