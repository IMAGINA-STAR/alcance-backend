// Wrapper delgado sobre la API de Resend (https://resend.com/docs/api-reference),
// igual de simple que services/recurrente.js. Usa fetch nativo de Node.

const RESEND_BASE_URL = 'https://api.resend.com';

// Envía un correo. Si RESEND_API_KEY no está configurado (ej. en desarrollo
// local), lo omite silenciosamente en vez de romper el flujo que lo llamó.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY no está configurado; se omite el envío de correo.');
    return;
  }

  const from = process.env.EMAIL_FROM || 'Alcance <onboarding@resend.dev>';

  const res = await fetch(`${RESEND_BASE_URL}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || `Resend respondió con estado ${res.status}`);
  }
}

module.exports = { sendEmail };
