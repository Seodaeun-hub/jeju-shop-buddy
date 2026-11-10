ALTER TABLE execution_plans ADD COLUMN IF NOT EXISTS promotion_impact JSONB
    CHECK (promotion_impact IS NULL OR (strategy_code = 'PROMOTION' AND jsonb_typeof(promotion_impact) = 'object'));
