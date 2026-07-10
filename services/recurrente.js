// Wrapper delgado sobre la API de Recurrente (https://docs.recurrente.com)
// Usa fetch nativo de Node (disponible desde Node 18+).

const RECURRENTE_BASE_URL = 'https://app.recurrente.com/api';

function getSecretKey() {
  const key = process.env.RECURRENTE_SECRET_KEY;
  if (!key) {
    throw new Error('Falta configurar RECURRENTE_SECRET_KEY en las variables de entorno.');
  }
  return key;
}

async function recurrenteRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${RECURRENTE_BASE_URL}${path}`, {
    method,
    headers: {
      'X-SECRET-KEY': getSecretKey(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error || `Recurrente respondió con estado ${res.status}`;
    throw new Error(message);
  }
  return data;
}

// Crea un checkout (página de pago alojada) para una solicitud aceptada.
// amountInQuetzales: monto en quetzales (ej. 350.00) — se convierte a centavos.
function createCheckout({ description, amountInQuetzales, successUrl, cancelUrl, metadata }) {
  const amountInCents = Math.round(amountInQuetzales * 100);
  return recurrenteRequest('/checkouts', {
    method: 'POST',
    body: {
      items: [
        {
          name: description,
          amount_in_cents: amountInCents,
          currency: 'GTQ',
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
    },
  });
}

// Consulta el estado actual de un checkout. Se usa como respaldo para
// confirmar pagos en modo TEST, ya que Recurrente no envía webhooks
// para checkouts creados con llaves de prueba.
function getCheckout(checkoutId) {
  return recurrenteRequest(`/checkouts/${checkoutId}`);
}

module.exports = { createCheckout, getCheckout };
