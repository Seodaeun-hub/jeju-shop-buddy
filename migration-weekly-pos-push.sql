BEGIN;

CREATE TABLE IF NOT EXISTS weekly_pos_push_subscriptions (
    owner_id UUID PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    endpoint VARCHAR(2048) NOT NULL UNIQUE,
    p256dh VARCHAR(88) NOT NULL,
    auth_secret VARCHAR(88) NOT NULL,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weekly_pos_push_deliveries (
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    outcome VARCHAR(8) NOT NULL DEFAULT 'CLAIMED'
        CHECK (outcome IN ('CLAIMED', 'SENT', 'EXPIRED', 'FAILED')),
    PRIMARY KEY (owner_id, week_start)
);

COMMIT;
