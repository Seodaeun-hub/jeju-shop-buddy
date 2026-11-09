package com.jejushopbuddy.analysis;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
class ExecutionResultWriter {
    private static final String OWNED_PLAN = """
            WITH owned_plan AS MATERIALIZED (
                SELECT p.id
                FROM execution_plans p
                JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id
                JOIN owners o ON o.id = s.owner_id
                WHERE p.id = :planId AND o.email = :ownerEmail
                FOR SHARE OF p, a, s, o
            ),
            """;

    private final JdbcClient jdbc;
    private final ObjectMapper json;

    ExecutionResultWriter(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public Optional<Result> create(UUID planId, String ownerEmail, Input input) {
        UUID id = UUID.randomUUID();
        var comparison = compare(input);
        var statement = jdbc.sql("""
                INSERT INTO execution_results
                    (id, plan_id, scope, before_start, before_end, before_days, before_amount, before_count,
                     after_start, after_end, after_days, after_amount, after_count, comparison)
                SELECT :id, p.id, :scope, :beforeStart, :beforeEnd, :beforeDays, :beforeAmount, :beforeCount,
                       :afterStart, :afterEnd, :afterDays, :afterAmount, :afterCount, CAST(:comparison AS jsonb)
                FROM execution_plans p
                JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id
                JOIN owners o ON o.id = s.owner_id
                WHERE p.id = :planId AND o.email = :ownerEmail
                FOR SHARE OF p, a, s, o
                RETURNING created_at
                """)
                .param("id", id)
                .param("planId", planId)
                .param("ownerEmail", ownerEmail);
        return bindInput(statement, input, comparison)
                .query((rs, row) -> rs.getObject("created_at", OffsetDateTime.class))
                .optional().map(timestamp -> result(id, planId, input, comparison, timestamp));
    }

    Optional<Replacement> replace(UUID planId, UUID resultId, String ownerEmail, Input input) {
        var comparison = compare(input);
        var statement = jdbc.sql(OWNED_PLAN + """
                changed AS (
                    UPDATE execution_results r
                    SET scope = :scope, before_start = :beforeStart, before_end = :beforeEnd,
                        before_days = :beforeDays, before_amount = :beforeAmount, before_count = :beforeCount,
                        after_start = :afterStart, after_end = :afterEnd, after_days = :afterDays,
                        after_amount = :afterAmount, after_count = :afterCount, comparison = CAST(:comparison AS jsonb)
                    FROM owned_plan p
                    WHERE r.id = :resultId AND r.plan_id = p.id
                    RETURNING r.created_at
                )
                SELECT changed.created_at FROM owned_plan LEFT JOIN changed ON TRUE
                """)
                .param("planId", planId)
                .param("resultId", resultId)
                .param("ownerEmail", ownerEmail);
        return bindInput(statement, input, comparison)
                .query((rs, row) -> {
                    var timestamp = rs.getObject("created_at", OffsetDateTime.class);
                    return new Replacement(timestamp == null ? null : result(resultId, planId, input, comparison, timestamp));
                })
                .optional();
    }

    Deletion delete(UUID planId, UUID resultId, String ownerEmail) {
        return jdbc.sql(OWNED_PLAN + """
                deleted AS (
                    DELETE FROM execution_results r
                    USING owned_plan p
                    WHERE r.id = :resultId AND r.plan_id = p.id
                    RETURNING r.id
                )
                SELECT deleted.id IS NOT NULL FROM owned_plan LEFT JOIN deleted ON TRUE
                """)
                .param("planId", planId)
                .param("resultId", resultId)
                .param("ownerEmail", ownerEmail)
                .query(Boolean.class)
                .optional()
                .map(deleted -> deleted ? Deletion.DELETED : Deletion.RESULT_NOT_FOUND)
                .orElse(Deletion.PLAN_NOT_FOUND);
    }

    enum Deletion { DELETED, PLAN_NOT_FOUND, RESULT_NOT_FOUND }

    private JdbcClient.StatementSpec bindInput(JdbcClient.StatementSpec statement, Input input, Comparison comparison) {
        var before = input.before();
        var after = input.after();
        return statement.param("scope", input.scope())
                .param("beforeStart", before.start())
                .param("beforeEnd", before.end())
                .param("beforeDays", before.days())
                .param("beforeAmount", before.amount())
                .param("beforeCount", before.count())
                .param("afterStart", after.start())
                .param("afterEnd", after.end())
                .param("afterDays", after.days())
                .param("afterAmount", after.amount())
                .param("afterCount", after.count())
                .param("comparison", json.writeValueAsString(comparison));
    }

    private static Result result(UUID id, UUID planId, Input input, Comparison comparison, OffsetDateTime createdAt) {
        return new Result(id, planId, input.scope(), input.before(), input.after(), comparison, createdAt);
    }

    private static Comparison compare(Input input) {
        var before = input.before();
        var after = input.after();
        return new Comparison(compare(before.amount(), before.days(), after.amount(), after.days()),
                compare(before.count(), before.days(), after.count(), after.days()));
    }

    private static Metric compare(Long beforeTotal, int beforeDays, Long afterTotal, int afterDays) {
        if (beforeTotal == null) {
            return null;
        }
        BigDecimal before = BigDecimal.valueOf(beforeTotal);
        BigDecimal after = BigDecimal.valueOf(afterTotal);
        BigDecimal beforeDayCount = BigDecimal.valueOf(beforeDays);
        BigDecimal afterDayCount = BigDecimal.valueOf(afterDays);
        BigDecimal rate = null;
        if (before.signum() != 0) {
            // Cross-multiply the daily averages so the rate uses the exact, unrounded ratio.
            BigDecimal baseline = before.multiply(afterDayCount);
            rate = after.multiply(beforeDayCount).subtract(baseline).movePointRight(2)
                    .divide(baseline, 2, RoundingMode.HALF_UP);
        }
        return new Metric(before.divide(beforeDayCount, 2, RoundingMode.HALF_UP),
                after.divide(afterDayCount, 2, RoundingMode.HALF_UP), rate);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Period(LocalDate start, LocalDate end, int days, Long amount, Long count) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Comparison(Metric amount, Metric count) {}

    record Metric(BigDecimal beforeDailyAverage, BigDecimal afterDailyAverage,
                  @JsonInclude(JsonInclude.Include.ALWAYS) BigDecimal changeRatePercent) {}

    record Input(String scope, Period before, Period after) {}

    record Replacement(Result result) {}

    record Result(UUID id, UUID planId, String scope, Period before, Period after,
                  Comparison comparison, OffsetDateTime createdAt) {}
}
