BEGIN;

CREATE TABLE IF NOT EXISTS inventory_demand_snapshots (
    plan_id UUID NOT NULL REFERENCES execution_plans (id) ON DELETE CASCADE,
    target_date DATE NOT NULL CHECK (isfinite(target_date)),
    product_name VARCHAR(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    low BIGINT NOT NULL CHECK (low >= 0),
    high BIGINT NOT NULL CHECK (high >= low AND high <= 9007199254740991),
    basis VARCHAR(16) NOT NULL CHECK (basis IN ('WEATHER', 'WEEKDAY')),
    saved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plan_id, target_date, product_name)
);

COMMIT;
