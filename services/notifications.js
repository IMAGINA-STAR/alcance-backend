// Punto central para crear notificaciones: guarda la fila (para la
// campanita del frontend) y dispara el correo en paralelo, sin bloquear
// al que llamó. Úsalo desde cualquier ruta que necesite avisarle a un
// usuario — no dupliques el INSERT ni el envío de correo en otro lado.
const pool = require('../db/pool');
const { sendEmail } = require('./email');

async function notify({ userId, type, title, body, link }) {
  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, type, title, body || null, link || null]
  );

  // El correo se envía en segundo plano: si Resend tarda o falla, no
  // queremos que la solicitud/mensaje/pago que originó esto se demore.
  pool.query('SELECT email, name FROM users WHERE id = $1', [userId])
    .then(({ rows }) => {
      const user = rows[0];
      if (!user) return;
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const fullLink = link ? `${frontendUrl}${link}` : frontendUrl;
      return sendEmail({
        to: user.email,
        subject: title,
        html: `<p>Hola ${user.name},</p><p>${body || ''}</p><p><a href="${fullLink}">Ver en Alcance</a></p>`,
      });
    })
    .catch((err) => console.error('Error al enviar la notificación por correo:', err.message));

  return result.rows[0];
}

module.exports = { notify };
