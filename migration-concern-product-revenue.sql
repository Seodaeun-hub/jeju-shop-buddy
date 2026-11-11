BEGIN;

ALTER TABLE analysis_product_sales
    ADD COLUMN IF NOT EXISTS before_revenue bigint CHECK (before_revenue BETWEEN 0 AND 9007199254740991),
    ADD COLUMN IF NOT EXISTS after_revenue bigint CHECK (after_revenue BETWEEN 0 AND 9007199254740991);

COMMIT;
