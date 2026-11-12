BEGIN;

ALTER TABLE execution_plans ADD COLUMN IF NOT EXISTS manual_promotion_publication JSONB
    CONSTRAINT ck_execution_plans_manual_promotion_publication CHECK (manual_promotion_publication IS NULL OR (
        jsonb_typeof(manual_promotion_publication) = 'object'
        AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
    ));

DO $$
DECLARE
    legacy_constraint text;
BEGIN
    FOR legacy_constraint IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute impact ON impact.attrelid = c.conrelid AND impact.attname = 'promotion_impact'
        JOIN pg_attribute strategy ON strategy.attrelid = c.conrelid AND strategy.attname = 'strategy_code'
        WHERE c.conrelid = 'execution_plans'::regclass AND c.contype = 'c'
          AND cardinality(c.conkey) = 2 AND c.conkey @> ARRAY[impact.attnum, strategy.attnum]
    LOOP
        EXECUTE format('ALTER TABLE execution_plans DROP CONSTRAINT %I', legacy_constraint);
    END LOOP;
END $$;

ALTER TABLE execution_plans
    DROP CONSTRAINT IF EXISTS ck_execution_plans_promotion_impact,
    ADD CONSTRAINT ck_execution_plans_promotion_impact CHECK (promotion_impact IS NULL OR (
        jsonb_typeof(promotion_impact) = 'object'
        AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
    ));

COMMIT;
