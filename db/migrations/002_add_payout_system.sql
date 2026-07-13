-- Sistema de pagos a influencers: datos bancarios y estado de payout.
DO $$ BEGIN
  CREATE TYPE payout_status_type AS ENUM ('pendiente', 'pagado');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE influencer_profiles
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT;

-- influencer_amount es una columna generada (88% de amount) para que
-- siempre quede en sincronía con el monto de la transacción.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS influencer_amount NUMERIC(10,2) GENERATED ALWAYS AS (amount * 0.88) STORED,
  ADD COLUMN IF NOT EXISTS payout_status payout_status_type NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS payout_date DATE,
  ADD COLUMN IF NOT EXISTS payout_reference TEXT;
