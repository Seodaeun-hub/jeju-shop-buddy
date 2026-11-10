CREATE TABLE IF NOT EXISTS execution_guide_snapshots (
    id UUID PRIMARY KEY,
    analysis_id UUID NOT NULL REFERENCES sales_analyses (id) ON DELETE CASCADE,
    recommendation_id UUID REFERENCES strategy_recommendations (id) ON DELETE CASCADE,
    strategy_code VARCHAR(16) NOT NULL CHECK (strategy_code = 'OUTREACH'),
    input_fingerprint VARCHAR(64) NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
