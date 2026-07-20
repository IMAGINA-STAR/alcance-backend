-- Estado intermedio "entregado" en el flujo de solicitudes: aceptada -> entregada -> pagada.
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'delivered' AFTER 'accepted';

-- Evidencia de entrega que sube el influencer (link a la publicación + nota opcional).
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS evidence_note TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
