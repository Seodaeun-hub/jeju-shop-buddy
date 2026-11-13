BEGIN;

CREATE TABLE IF NOT EXISTS store_inventory_recipes (
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    ingredient_name VARCHAR(50) NOT NULL CHECK (ingredient_name ~ '[^[:space:]]'),
    unit VARCHAR(12) NOT NULL CHECK (unit ~ '[^[:space:]]'),
    amount NUMERIC(13, 3) NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
    PRIMARY KEY (store_id, product_name, ingredient_name, unit)
);

COMMIT;
