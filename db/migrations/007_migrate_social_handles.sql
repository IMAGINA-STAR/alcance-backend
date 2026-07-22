-- Copia instagram_handle/tiktok_handle existentes hacia influencer_social_accounts,
-- solo para influencers con el campo correspondiente no nulo ni vacío.
-- followers_count: en la práctica el 100% de los datos reales hoy están en Instagram
-- (tiktok_handle nunca se escribió desde ningún endpoint), así que la fila de
-- Instagram se lleva el total actual de `followers` y la de TikTok (si alguna
-- existiera) se crea en 0, para no duplicar el conteo al sumar por plataforma.
-- Idempotente vía ON CONFLICT DO NOTHING (migrate.js re-corre todos los archivos).

INSERT INTO influencer_social_accounts (influencer_id, platform, handle, followers_count)
SELECT id, 'instagram', instagram_handle, followers
FROM influencer_profiles
WHERE instagram_handle IS NOT NULL AND TRIM(instagram_handle) <> ''
ON CONFLICT (influencer_id, platform) DO NOTHING;

INSERT INTO influencer_social_accounts (influencer_id, platform, handle, followers_count)
SELECT id, 'tiktok', tiktok_handle, 0
FROM influencer_profiles
WHERE tiktok_handle IS NOT NULL AND TRIM(tiktok_handle) <> ''
ON CONFLICT (influencer_id, platform) DO NOTHING;
