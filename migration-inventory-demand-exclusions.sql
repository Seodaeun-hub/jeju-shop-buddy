BEGIN;

ALTER TABLE inventory_demand_snapshots
    ADD COLUMN IF NOT EXISTS excluded_dates JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(excluded_dates) = 'array');

COMMIT;
