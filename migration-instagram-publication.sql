ALTER TABLE execution_plans
    ADD COLUMN IF NOT EXISTS instagram_publication JSONB
    CHECK (instagram_publication IS NULL OR (strategy_code = 'PROMOTION' AND jsonb_typeof(instagram_publication) = 'object'));
