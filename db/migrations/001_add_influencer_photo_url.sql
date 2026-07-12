-- Agrega el campo de foto de perfil (enlace externo) al influencer.
ALTER TABLE influencer_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;
