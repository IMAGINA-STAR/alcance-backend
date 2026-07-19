-- Notificaciones en la app (campanita) para nueva solicitud, nuevo mensaje
-- y pago confirmado. El envío por correo se dispara desde el backend al
-- crear la fila, no desde la base de datos.
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('new_request', 'new_message', 'payment_confirmed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        notification_type NOT NULL,
    title       VARCHAR(150) NOT NULL,
    body        TEXT,
    link        VARCHAR(255),
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read = FALSE;
