const express = require('express');
const { Webhook } = require('svix');
const { markTransactionPaid } = require('../services/transactions');

const router = express.Router();

// POST /api/webhooks/recurrente
// Recurrente llama aquí cuando un pago cambia de estado (solo en modo LIVE —
// no se disparan webhooks para checkouts creados con llaves TEST).
router.post('/recurrente', async (req, res) => {
  const secret = process.env.RECURRENTE_WEBHOOK_SECRET;

  // Sin el signing secret configurado, no podemos verificar la firma con
  // seguridad. Mientras solo uses llaves TEST esto no importa (no llegan
  // webhooks), pero es obligatorio configurarlo antes de pasar a LIVE.
  if (!secret) {
    console.warn('RECURRENTE_WEBHOOK_SECRET no está configurado; se ignora el webhook.');
    return res.status(200).send('ok');
  }

  let event;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(req.rawBody, {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature'],
    });
  } catch (err) {
    console.error('Firma de webhook inválida:', err.message);
    return res.status(400).send('Firma inválida');
  }

  try {
    if (event.event_type === 'intent.succeeded' && event.checkout?.id) {
      await markTransactionPaid({ paymentReference: event.checkout.id });
    }
    res.status(200).send('ok');
  } catch (err) {
    console.error('Error al procesar webhook de Recurrente:', err);
    // Igual respondemos 200 para que Recurrente no siga reintentando algo
    // que ya registramos en nuestros logs; ajusta según tu tolerancia.
    res.status(200).send('ok');
  }
});

module.exports = router;
