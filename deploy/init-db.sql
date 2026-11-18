-- Serialize initialization if two deployments start at the same time.
SELECT pg_advisory_lock(5483209468);

SELECT to_regclass('public.owners') IS NULL AS needs_schema \gset
\if :needs_schema
    \ir schema.sql
\endif
\ir migration-store-reviews.sql
\ir migration-chart-questions.sql
\ir migration-rehearsal-date.sql
\ir migration-execution-outcome.sql
\ir seed-jeju-areas.sql

SELECT pg_advisory_unlock(5483209468);
