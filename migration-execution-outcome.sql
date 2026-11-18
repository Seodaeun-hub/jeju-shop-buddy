-- Outcome provenance and one-day inventory records; not a social publication receipt.
ALTER TABLE execution_plans ADD COLUMN IF NOT EXISTS execution_outcome jsonb
    CHECK (execution_outcome IS NULL OR jsonb_typeof(execution_outcome) = 'object');
