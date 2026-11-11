BEGIN;

CREATE TABLE IF NOT EXISTS store_pos_files (
    id UUID PRIMARY KEY,
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
    kind VARCHAR(7) NOT NULL CHECK (kind IN ('PAYMENT', 'PRODUCT')),
    filename VARCHAR(255) NOT NULL CHECK (filename ~ '[^[:space:]]'),
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 10485760),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_store_pos_files_store_uploaded ON store_pos_files (store_id, uploaded_at DESC, id DESC);

COMMIT;
