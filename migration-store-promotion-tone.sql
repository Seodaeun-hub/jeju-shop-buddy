ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS promotion_tone VARCHAR(16) CHECK (promotion_tone IN ('PLAIN', 'FRIENDLY', 'SHORT')),
    ADD COLUMN IF NOT EXISTS promotion_avoid_phrases VARCHAR(500) NOT NULL DEFAULT '';
