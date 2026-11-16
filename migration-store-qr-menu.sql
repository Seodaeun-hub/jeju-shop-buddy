CREATE TABLE IF NOT EXISTS store_qr_menus (
    store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    public_id uuid NOT NULL UNIQUE,
    publication jsonb
);
