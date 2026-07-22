-- Redes sociales por influencer (Instagram, TikTok, YouTube), una fila por
-- plataforma. influencer_profiles.followers sigue siendo el total (suma de
-- todas las plataformas), sincronizado desde la aplicación en cada
-- POST/PATCH/DELETE de /api/influencer/social-accounts (routes/influencer.js).
-- No se borran instagram_handle/tiktok_handle de influencer_profiles todavía.
DO $$ BEGIN
  CREATE TYPE social_platform AS ENUM ('instagram', 'tiktok', 'youtube');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS influencer_social_accounts (
    id              SERIAL PRIMARY KEY,
    influencer_id   INTEGER NOT NULL REFERENCES influencer_profiles(id) ON DELETE CASCADE,
    platform        social_platform NOT NULL,
    handle          VARCHAR(60) NOT NULL,
    followers_count INTEGER NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (influencer_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_influencer_social_accounts_influencer
  ON influencer_social_accounts(influencer_id);
