// Corre las migraciones SQL en db/migrations, en orden, contra la base
// de datos configurada en DATABASE_URL (.env).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Aplicando ${file}...`);
      await pool.query(sql);
    }
    console.log('Migraciones aplicadas correctamente.');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Error al aplicar migraciones:', err);
  process.exit(1);
});
