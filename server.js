require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const spacesRoutes = require('./routes/spaces');
const requestsRoutes = require('./routes/requests');
const webhooksRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
// Guardamos el body crudo (rawBody) porque la verificación de firma de
// los webhooks de Recurrente necesita el JSON exacto tal como llegó,
// antes de que Express lo parsee.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'alcance-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/spaces', spacesRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/webhooks', webhooksRoutes);

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.listen(PORT, () => {
  console.log(`Alcance backend corriendo en http://localhost:${PORT}`);
});
