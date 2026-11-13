ALTER TABLE store_pos_files ADD COLUMN IF NOT EXISTS toss_month DATE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_store_pos_files_toss_month
    ON store_pos_files (store_id, kind, toss_month);
