BEGIN;

ALTER TABLE inventory_demand_snapshots
    ADD COLUMN IF NOT EXISTS original_bounds JSONB NOT NULL DEFAULT 'null'::jsonb
        CHECK (jsonb_typeof(original_bounds) IN ('object', 'null'));

COMMIT;
