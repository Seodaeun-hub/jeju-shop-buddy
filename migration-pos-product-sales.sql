BEGIN;

CREATE TABLE IF NOT EXISTS analysis_product_sales (
    analysis_id uuid NOT NULL REFERENCES sales_analyses(id) ON DELETE CASCADE,
    product_name varchar(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    before_quantity bigint NOT NULL CHECK (before_quantity BETWEEN 0 AND 9007199254740991),
    after_quantity bigint NOT NULL CHECK (after_quantity BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (analysis_id, product_name)
);

COMMIT;
