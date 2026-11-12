BEGIN;

ALTER TABLE store_pos_files
    ADD COLUMN IF NOT EXISTS coverage_start DATE,
    ADD COLUMN IF NOT EXISTS coverage_end DATE,
    ADD COLUMN IF NOT EXISTS calendar_date DATE;

ALTER TABLE store_pos_files
    DROP CONSTRAINT IF EXISTS ck_store_pos_files_coverage,
    ADD CONSTRAINT ck_store_pos_files_coverage CHECK (
        (coverage_start IS NULL AND coverage_end IS NULL) OR
        (coverage_start IS NOT NULL AND coverage_end IS NOT NULL AND coverage_start <= coverage_end)
    );

COMMIT;
