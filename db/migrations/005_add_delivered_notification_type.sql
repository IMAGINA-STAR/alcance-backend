-- Notificación al anunciante cuando el influencer marca la solicitud como entregada.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_delivered';
