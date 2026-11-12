BEGIN;

ALTER TABLE weekly_pos_push_subscriptions
    ADD COLUMN IF NOT EXISTS weekly_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS result_enabled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS execution_result_push_deliveries (
    plan_id UUID NOT NULL REFERENCES execution_plans(id) ON DELETE CASCADE,
    notice_key TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    outcome VARCHAR(8) NOT NULL DEFAULT 'CLAIMED'
        CHECK (outcome IN ('CLAIMED', 'SENT', 'EXPIRED', 'FAILED')),
    PRIMARY KEY (plan_id, notice_key)
);

COMMIT;
