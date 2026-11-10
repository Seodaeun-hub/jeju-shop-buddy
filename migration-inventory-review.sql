BEGIN;

ALTER TABLE execution_plans
    ADD COLUMN IF NOT EXISTS inventory_review jsonb
    CHECK (inventory_review IS NULL OR (strategy_code = 'INVENTORY' AND jsonb_typeof(inventory_review) = 'array'));

COMMIT;
