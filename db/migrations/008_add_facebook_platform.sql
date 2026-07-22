-- Agrega 'facebook' como cuarta plataforma soportada en social_platform.
-- No afecta filas existentes; ADD VALUE IF NOT EXISTS es idempotente.
ALTER TYPE social_platform ADD VALUE IF NOT EXISTS 'facebook';
