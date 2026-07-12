const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
