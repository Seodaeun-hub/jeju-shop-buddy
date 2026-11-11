BEGIN;

UPDATE execution_plans
SET strategy_snapshot = jsonb_set(strategy_snapshot, '{marketing}', 'true')
WHERE strategy_code = 'CUSTOM'
  AND NOT strategy_snapshot ? 'marketing'
  AND (strategy_snapshot->>'title') ~* '(홍보|광고|인스타|SNS|블로그|가게를?[[:space:]]*알리|메뉴[[:space:]]*사진.*(게시|방문[[:space:]]*안내)|메뉴[[:space:]]*알리)';

WITH updated AS (
    SELECT r.id,
           jsonb_agg(
               CASE WHEN card->>'code' = 'CUSTOM' AND NOT card ? 'marketing'
                    AND (card->>'title') ~* '(홍보|광고|인스타|SNS|블로그|가게를?[[:space:]]*알리|메뉴[[:space:]]*사진.*(게시|방문[[:space:]]*안내)|메뉴[[:space:]]*알리)'
               THEN jsonb_set(card, '{marketing}', 'true')
               ELSE card END ORDER BY position
           ) AS strategies
    FROM strategy_recommendations r
    CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'strategies') WITH ORDINALITY AS item(card, position)
    GROUP BY r.id
)
UPDATE strategy_recommendations r
SET snapshot = jsonb_set(r.snapshot, '{strategies}', updated.strategies)
FROM updated
WHERE r.id = updated.id AND r.snapshot->'strategies' IS DISTINCT FROM updated.strategies;

-- Older installations let PostgreSQL name these cross-column checks.
DO $$
DECLARE
    check_name text;
BEGIN
    FOR check_name IN
        SELECT DISTINCT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'execution_plans'::regclass AND c.contype = 'c'
          AND a.attname IN ('promotion_draft', 'instagram_publication')
          AND pg_get_expr(c.conbin, c.conrelid) LIKE '%strategy_code%PROMOTION%'
    LOOP
        EXECUTE format('ALTER TABLE execution_plans DROP CONSTRAINT %I', check_name);
    END LOOP;
END
$$;

ALTER TABLE execution_plans
    ADD CONSTRAINT ck_execution_plans_promotion_draft CHECK (
        promotion_draft IS NULL OR (
            jsonb_typeof(promotion_draft) = 'object'
            AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
        )
    ),
    ADD CONSTRAINT ck_execution_plans_instagram_publication CHECK (
        instagram_publication IS NULL OR (
            jsonb_typeof(instagram_publication) = 'object'
            AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
        )
    );

COMMIT;
