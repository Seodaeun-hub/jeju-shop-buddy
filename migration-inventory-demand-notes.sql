BEGIN;

CREATE TABLE IF NOT EXISTS inventory_demand_notes (
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
    target_date DATE NOT NULL CHECK (isfinite(target_date)),
    product_name VARCHAR(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    note VARCHAR(200) NOT NULL CHECK (note ~ '[^[:space:]]' AND note !~ '[[:cntrl:]]'),
    PRIMARY KEY (store_id, target_date, product_name)
);

COMMIT;
