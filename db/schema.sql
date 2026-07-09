-- ============================================
-- ALCANCE — Esquema de base de datos (PostgreSQL)
-- Marketplace de espacios publicitarios con micro-influencers
-- ============================================

CREATE TYPE user_role AS ENUM ('anunciante', 'influencer', 'admin');
CREATE TYPE request_status AS ENUM ('pending', 'accepted', 'rejected', 'completed', 'cancelled');
CREATE TYPE transaction_status AS ENUM ('pending', 'paid', 'refunded', 'failed');

-- ---------- USUARIOS ----------
-- Tabla base para los tres tipos de usuario. El "role" determina qué
-- perfil adicional tiene asociado (influencer_profiles o advertiser_profiles).
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    email           VARCHAR(150) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL,
    phone           VARCHAR(30),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------- PERFIL DE INFLUENCER ----------
CREATE TABLE influencer_profiles (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    category        VARCHAR(60) NOT NULL,        -- Moda, Comida, Fitness, Belleza, Lifestyle...
    followers       INTEGER NOT NULL DEFAULT 0,
    engagement_rate NUMERIC(5,2),                 -- porcentaje, ej. 4.50
    bio             TEXT,
    instagram_handle VARCHAR(60),
    tiktok_handle   VARCHAR(60),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------- PERFIL DE ANUNCIANTE ----------
CREATE TABLE advertiser_profiles (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    brand_name      VARCHAR(150) NOT NULL,
    industry        VARCHAR(80),
    website         VARCHAR(255),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------- ESPACIOS PUBLICITARIOS ----------
-- Lo que publica cada influencer: qué vende, en qué formato y a qué precio.
CREATE TABLE spaces (
    id              SERIAL PRIMARY KEY,
    influencer_id   INTEGER NOT NULL REFERENCES influencer_profiles(id) ON DELETE CASCADE,
    content_type    VARCHAR(60) NOT NULL,   -- 'Historia 24h', 'Post en feed', 'Reel', 'Combo'
    price           NUMERIC(10,2) NOT NULL,
    description     TEXT,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------- SOLICITUDES ----------
-- Una propuesta de un anunciante hacia un espacio publicado.
CREATE TABLE requests (
    id              SERIAL PRIMARY KEY,
    space_id        INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    advertiser_id   INTEGER NOT NULL REFERENCES advertiser_profiles(id) ON DELETE CASCADE,
    message         TEXT,
    offered_budget  NUMERIC(10,2) NOT NULL,
    status          request_status NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------- MENSAJES ----------
-- Chat simple asociado a una solicitud (anunciante <-> influencer).
CREATE TABLE messages (
    id              SERIAL PRIMARY KEY,
    request_id      INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------- TRANSACCIONES ----------
-- El pago real, ligado a una solicitud aceptada. commission_amount es
-- lo que se queda la plataforma (ej. 12% de amount).
CREATE TABLE transactions (
    id                  SERIAL PRIMARY KEY,
    request_id          INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
    amount              NUMERIC(10,2) NOT NULL,
    commission_rate     NUMERIC(5,2) NOT NULL DEFAULT 12.00,
    commission_amount   NUMERIC(10,2) NOT NULL,
    payout_amount       NUMERIC(10,2) NOT NULL,   -- amount - commission_amount
    status              transaction_status NOT NULL DEFAULT 'pending',
    payment_reference   VARCHAR(150),               -- id de Stripe u otra pasarela
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    paid_at             TIMESTAMP
);

-- ---------- RESEÑAS ----------
CREATE TABLE reviews (
    id              SERIAL PRIMARY KEY,
    request_id      INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    reviewer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------- ÍNDICES ----------
CREATE INDEX idx_spaces_influencer ON spaces(influencer_id);
CREATE INDEX idx_spaces_active ON spaces(active);
CREATE INDEX idx_requests_space ON requests(space_id);
CREATE INDEX idx_requests_advertiser ON requests(advertiser_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_messages_request ON messages(request_id);
