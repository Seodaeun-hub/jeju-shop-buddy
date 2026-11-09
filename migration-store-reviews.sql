-- Apply after schema.sql. Safe to run again on an existing development database.
BEGIN;

CREATE TABLE IF NOT EXISTS store_reviews (
    id UUID PRIMARY KEY,
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
    reviewed_on DATE NOT NULL CHECK (isfinite(reviewed_on)),
    body VARCHAR(1000) NOT NULL CHECK (body ~ '[^[:space:]]')
);

CREATE INDEX IF NOT EXISTS ix_store_reviews_store_date ON store_reviews (store_id, reviewed_on DESC, id);

ALTER TABLE store_reviews ADD COLUMN IF NOT EXISTS model_topics VARCHAR(80);

COMMIT;
