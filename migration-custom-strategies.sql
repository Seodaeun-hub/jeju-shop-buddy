BEGIN;

ALTER TABLE execution_plans
    DROP CONSTRAINT ck_execution_plans_strategy_code,
    DROP CONSTRAINT ck_execution_plans_strategy_conditions,
    ADD CONSTRAINT ck_execution_plans_strategy_code CHECK (
        strategy_code IN ('OUTREACH', 'PROMOTION', 'INVENTORY', 'CUSTOM')
    ),
    ADD CONSTRAINT ck_execution_plans_strategy_conditions CHECK (
        (strategy_code IN ('OUTREACH', 'PROMOTION') AND budget_won IS NOT NULL AND channel IS NOT NULL)
        OR (strategy_code IN ('INVENTORY', 'CUSTOM') AND budget_won IS NULL AND channel IS NULL)
    );

COMMIT;
