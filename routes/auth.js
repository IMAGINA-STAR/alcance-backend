const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();
const SALT_ROUNDS = 10;

// POST /api/auth/register
// Crea el usuario base y, según el rol, su perfil (influencer o anunciante).
router.post('/register', async (req, res) => {
  const { name, email, password, role, profile } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: name, email, password, role.' });
  }
  if (!['anunciante', 'influencer'].includes(role)) {
    return res.status(400).json({ error: 'El rol debe ser "anunciante" o "influencer".' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role`,
      [name, email, passwordHash, role]
    );
    const user = userResult.rows[0];

    if (role === 'influencer') {
      await client.query(
        `INSERT INTO influencer_profiles (user_id, category, followers, engagement_rate, bio, instagram_handle)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          user.id,
          profile?.category || null,
          profile?.followers || 0,
          profile?.engagement_rate || null,
          profile?.bio || null,
          profile?.instagram_handle || null,
        ]
      );
    } else {
      await client.query(
        `INSERT INTO advertiser_profiles (user_id, brand_name, industry, website)
         VALUES ($1, $2, $3, $4)`,
        [user.id, profile?.brand_name || name, profile?.industry || null, profile?.website || null]
      );
    }

    await client.query('COMMIT');

    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({ user, token });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear la cuenta.' });
  } finally {
    client.release();
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

module.exports = router;
