BEGIN;

CREATE TABLE IF NOT EXISTS store_menu_costs (
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    ingredients JSONB NOT NULL CHECK (jsonb_typeof(ingredients) = 'array' AND jsonb_array_length(ingredients) BETWEEN 1 AND 100),
    cost_won BIGINT NOT NULL CHECK (cost_won BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (store_id, product_name)
);

COMMIT;
