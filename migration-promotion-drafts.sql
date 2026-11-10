BEGIN;

ALTER TABLE execution_plans ADD COLUMN IF NOT EXISTS promotion_draft jsonb
    CHECK (promotion_draft IS NULL OR (strategy_code = 'PROMOTION' AND jsonb_typeof(promotion_draft) = 'object'));

CREATE TABLE IF NOT EXISTS store_product_photos (
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_name varchar(255) NOT NULL,
    photo_data_url text NOT NULL CHECK (length(photo_data_url) <= 450000),
    PRIMARY KEY (store_id, product_name)
);

COMMIT;
