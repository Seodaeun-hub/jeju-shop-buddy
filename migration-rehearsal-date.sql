-- Account-scoped scenario date; storage timestamps and authentication still use real time.
ALTER TABLE owners ADD COLUMN IF NOT EXISTS rehearsal_date DATE
    CHECK (rehearsal_date IS NULL OR (isfinite(rehearsal_date) AND rehearsal_date >= DATE '1900-01-01'));
