package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.ExecutionPlanWriter.ChecklistItem;
import com.jejushopbuddy.analysis.ExecutionPlanWriter.Conditions;
import com.jejushopbuddy.analysis.ExecutionPlanWriter.Plan;
import com.jejushopbuddy.analysis.SalesStrategies.Suggestion;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
class ExecutionPlanReader {
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    ExecutionPlanReader(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Optional<Plan> find(UUID id, String ownerEmail) {
        var plan = jdbc.sql("""
                SELECT p.analysis_id, p.duration_weeks, p.budget_won, p.channel,
                       p.start_date, p.end_date, p.created_at, p.inventory_review,
                       p.strategy_snapshot || jsonb_build_object('code', p.strategy_code) AS strategy
                FROM execution_plans p
                JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id
                JOIN owners o ON o.id = s.owner_id
                WHERE p.id = :id AND o.email = :ownerEmail
                """)
                .param("id", id)
                .param("ownerEmail", ownerEmail)
                .query((rs, row) -> new SavedPlan(
                        rs.getObject("analysis_id", UUID.class),
                        json.readValue(rs.getString("strategy"), Suggestion.class),
                        new Conditions(rs.getInt("duration_weeks"), rs.getObject("budget_won", Long.class),
                                rs.getString("channel")),
                        rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                        rs.getObject("created_at", OffsetDateTime.class), rs.getString("inventory_review")))
                .optional();
        if (plan.isEmpty()) {
            return Optional.empty();
        }

        var checklist = jdbc.sql("""
                SELECT id, title, due_date, completed
                FROM execution_checklist_items WHERE plan_id = :id ORDER BY sort_order
                """)
                .param("id", id)
                .query((rs, row) -> new ChecklistItem(rs.getObject("id", UUID.class), rs.getString("title"),
                        rs.getObject("due_date", LocalDate.class), rs.getBoolean("completed")))
                .list();
        var saved = plan.get();
        var items = saved.inventoryReview() == null ? null
                : List.of(json.readValue(saved.inventoryReview(), InventoryReviewController.Item[].class));
        return Optional.of(new Plan(id, saved.analysisId(), saved.strategy(), saved.conditions(),
                saved.startDate(), saved.endDate(), checklist, saved.createdAt(), items));
    }

    private record SavedPlan(UUID analysisId, Suggestion strategy, Conditions conditions,
                             LocalDate startDate, LocalDate endDate, OffsetDateTime createdAt, String inventoryReview) {}
}
