const { Pool } = require('pg');
require('dotenv').config();

// Un solo pool de conexiones compartido por toda la app.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

module.exports = pool;
