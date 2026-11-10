BEGIN;

ALTER TABLE analysis_product_sales
    ADD COLUMN IF NOT EXISTS price_won bigint CHECK (price_won BETWEEN 1 AND 9007199254740991);

ALTER TABLE execution_plans
    ADD COLUMN IF NOT EXISTS promotion_review_saved_at timestamptz;

COMMIT;
