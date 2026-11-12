package com.jejushopbuddy.store;

import java.security.Principal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
class StoreHistoryController {
    private final JdbcClient jdbc;

    StoreHistoryController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/execution-reminders")
    ResponseEntity<List<ExecutionReminder>> executionReminders(Principal owner) {
        var plans = jdbc.sql("""
                SELECT p.id AS plan_id, p.analysis_id, s.id AS store_id, s.name AS store_name,
                       p.strategy_snapshot->>'title' AS title, p.end_date,
                       (p.strategy_code='PROMOTION' OR
                        COALESCE(p.strategy_code='CUSTOM' AND p.strategy_snapshot @> '{"marketing":true}', false)) AS promotion,
                       EXISTS (SELECT 1 FROM execution_results r WHERE r.plan_id=p.id) AS has_sales_result
                FROM execution_plans p JOIN sales_analyses a ON p.analysis_id=a.id
                JOIN stores s ON a.store_id=s.id JOIN owners o ON s.owner_id=o.id
                WHERE o.email=:email AND p.end_date < :today
                ORDER BY p.end_date DESC, p.created_at DESC, p.id DESC
                """).param("email", owner.getName()).param("today", LocalDate.now(ZoneId.of("Asia/Seoul")))
                .query((rs, row) -> new ExecutionReminder(rs.getObject("plan_id", UUID.class),
                        rs.getObject("analysis_id", UUID.class), rs.getObject("store_id", UUID.class),
                        rs.getString("store_name"), rs.getString("title"), rs.getObject("end_date", LocalDate.class),
                        rs.getBoolean("promotion"), rs.getBoolean("has_sales_result"))).list();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(plans);
    }

    @GetMapping("/api/stores/{storeId}/analyses")
    ResponseEntity<?> history(@PathVariable UUID storeId, Principal owner) {
        var rows = jdbc.sql("""
                SELECT a.id AS analysis_id, a.name, a.before_month, a.after_month, a.concern, a.created_at,
                       p.id AS plan_id, p.strategy_snapshot->>'title' AS title, p.start_date, p.end_date,
                       (EXISTS (SELECT 1 FROM execution_results r WHERE r.plan_id = p.id)
                        OR (p.promotion_impact->'before' IS NOT NULL AND p.promotion_impact->'after' IS NOT NULL)) AS has_result
                FROM stores s
                JOIN owners o ON o.id = s.owner_id
                LEFT JOIN sales_analyses a ON a.store_id = s.id
                LEFT JOIN execution_plans p ON p.analysis_id = a.id
                WHERE s.id = :storeId AND o.email = :email
                ORDER BY a.created_at DESC, a.id DESC, p.created_at DESC, p.id DESC
                """)
                .param("storeId", storeId)
                .param("email", owner.getName())
                .query((rs, row) -> {
                    var analysisId = rs.getObject("analysis_id", UUID.class);
                    if (analysisId == null) return new HistoryRow(null, null);
                    var analysis = new AnalysisSummary(analysisId, rs.getString("name"),
                            YearMonth.from(rs.getObject("before_month", LocalDate.class)).toString(),
                            YearMonth.from(rs.getObject("after_month", LocalDate.class)).toString(),
                            rs.getString("concern"), rs.getObject("created_at", OffsetDateTime.class),
                            new ArrayList<>());
                    var planId = rs.getObject("plan_id", UUID.class);
                    var plan = planId == null ? null : new PlanSummary(planId, rs.getString("title"),
                            rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                            rs.getBoolean("has_result"));
                    return new HistoryRow(analysis, plan);
                })
                .list();
        if (rows.isEmpty()) {
            return ResponseEntity.status(404).cacheControl(CacheControl.noStore())
                    .body(new StoreController.ApiError("STORE_NOT_FOUND", "매장을 찾을 수 없어요.", null));
        }
        var analyses = new LinkedHashMap<UUID, AnalysisSummary>();
        for (var row : rows) {
            if (row.analysis() == null) continue;
            var analysis = analyses.computeIfAbsent(row.analysis().id(), id -> row.analysis());
            if (row.plan() != null) analysis.plans().add(row.plan());
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(List.copyOf(analyses.values()));
    }

    private record HistoryRow(AnalysisSummary analysis, PlanSummary plan) {}
    record AnalysisSummary(UUID id, String name, String beforeMonth, String afterMonth, String concern,
                           OffsetDateTime createdAt, List<PlanSummary> plans) {}
    record PlanSummary(UUID id, String title, LocalDate startDate, LocalDate endDate, boolean hasResult) {}
    record ExecutionReminder(UUID planId, UUID analysisId, UUID storeId, String storeName, String title, LocalDate endDate,
                             boolean promotion, boolean hasSalesResult) {}
}
