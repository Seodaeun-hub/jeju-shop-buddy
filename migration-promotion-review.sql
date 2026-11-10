BEGIN;

ALTER TABLE execution_plans
    ADD COLUMN IF NOT EXISTS promotion_review jsonb
    CHECK (promotion_review IS NULL OR (strategy_code = 'PROMOTION' AND jsonb_typeof(promotion_review) = 'object'));

COMMIT;
