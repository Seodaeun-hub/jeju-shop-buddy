ALTER TABLE execution_plans ADD COLUMN IF NOT EXISTS instagram_scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_execution_plans_instagram_due
    ON execution_plans (instagram_scheduled_at) WHERE instagram_scheduled_at IS NOT NULL;
