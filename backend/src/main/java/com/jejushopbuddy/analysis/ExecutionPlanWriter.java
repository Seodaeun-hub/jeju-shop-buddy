package com.jejushopbuddy.analysis;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.jejushopbuddy.analysis.SalesStrategies.Suggestion;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
class ExecutionPlanWriter {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private final JdbcClient jdbc;
    private final SalesAnalysisReader reader;
    private final ObjectMapper json;

    ExecutionPlanWriter(JdbcClient jdbc, SalesAnalysisReader reader, ObjectMapper json) {
        this.jdbc = jdbc;
        this.reader = reader;
        this.json = json;
    }

    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public Optional<Plan> create(UUID analysisId, String ownerEmail, String strategyCode, Conditions conditions) {
        var analysis = reader.find(analysisId, ownerEmail);
        if (analysis.isEmpty()) {
            return Optional.empty();
        }
        var strategy = SalesStrategies.from(analysis.get()).strategies().stream()
                .filter(candidate -> candidate.code().equals(strategyCode)).findFirst().orElseThrow();
        UUID id = UUID.randomUUID();
        LocalDate start = LocalDate.now(SEOUL);
        LocalDate end = start.plusWeeks(conditions.durationWeeks()).minusDays(1);
        ObjectNode snapshot = json.valueToTree(strategy);
        snapshot.remove("code");

        var createdAt = jdbc.sql("""
                INSERT INTO execution_plans
                    (id, analysis_id, strategy_code, strategy_snapshot, duration_weeks,
                     budget_won, channel, start_date, end_date)
                VALUES (:id, :analysisId, :strategyCode, CAST(:snapshot AS jsonb), :weeks,
                        :budget, :channel, :startDate, :endDate)
                RETURNING created_at
                """)
                .param("id", id)
                .param("analysisId", analysisId)
                .param("strategyCode", strategy.code())
                .param("snapshot", json.writeValueAsString(snapshot))
                .param("weeks", conditions.durationWeeks())
                .param("budget", conditions.budgetWon())
                .param("channel", conditions.channel())
                .param("startDate", start)
                .param("endDate", end)
                .query((rs, row) -> rs.getObject("created_at", OffsetDateTime.class))
                .single();

        var checklist = checklistFor(strategy, conditions, start, end);
        int order = 1;
        for (var item : checklist) {
            jdbc.sql("""
                    INSERT INTO execution_checklist_items (id, plan_id, title, due_date, sort_order, completed)
                    VALUES (:id, :planId, :title, :dueDate, :sortOrder, :completed)
                    """)
                    .param("id", item.id())
                    .param("planId", id)
                    .param("title", item.title())
                    .param("dueDate", item.dueDate())
                    .param("sortOrder", order++)
                    .param("completed", item.completed())
                    .update();
        }
        return Optional.of(new Plan(id, analysisId, strategy, conditions, start, end, checklist, createdAt));
    }

    @Transactional
    public ChecklistUpdate updateChecklist(UUID planId, UUID itemId, String ownerEmail, boolean completed) {
        var owned = jdbc.sql("""
                SELECT p.id FROM execution_plans p
                JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id
                JOIN owners o ON o.id = s.owner_id
                WHERE p.id = :planId AND o.email = :ownerEmail
                FOR SHARE OF p, a, s, o
                """)
                .param("planId", planId)
                .param("ownerEmail", ownerEmail)
                .query(UUID.class)
                .optional();
        if (owned.isEmpty()) {
            return new ChecklistUpdate(false, null);
        }

        var item = jdbc.sql("""
                UPDATE execution_checklist_items SET completed = :completed
                WHERE id = :itemId AND plan_id = :planId
                RETURNING id, title, due_date, completed
                """)
                .param("itemId", itemId)
                .param("planId", planId)
                .param("completed", completed)
                .query((rs, row) -> new ChecklistItem(rs.getObject("id", UUID.class), rs.getString("title"),
                        rs.getObject("due_date", LocalDate.class), rs.getBoolean("completed")))
                .optional();
        return new ChecklistUpdate(true, item.orElse(null));
    }

    private static List<ChecklistItem> checklistFor(Suggestion strategy, Conditions conditions,
                                                     LocalDate start, LocalDate end) {
        if (strategy.status().equals("NEEDS_INPUT")) {
            var items = new ArrayList<ChecklistItem>();
            for (String input : strategy.missingInputs()) {
                items.add(item(input + " 확인하기", start.plusDays(items.size())));
            }
            String review = strategy.code().equals("PROMOTION")
                    ? "수집한 자료로 할인 후 주문당 수익과 예산 검토하기"
                    : "수집한 재고 자료로 품목별 발주량 검토하기";
            items.add(item(review, end));
            return List.copyOf(items);
        }

        String channel = conditions.channel().equals("INSTAGRAM") ? "인스타그램" : "매장";
        var evidence = strategy.evidence().getFirst();
        String check = evidence.label() == null ? "실제 주문 가능 시간과 현재 " + channel + " 안내 확인"
                : evidence.label() + " 구간의 주문 가능 시간과 현재 " + channel + " 안내 확인";
        return List.of(item(check, start),
                item("안내가 다르면 수정할 문구 정리", start.plusDays(1)),
                item("필요한 경우 " + channel + " 주문 안내 수정", start.plusDays(2)),
                item(strategy.followUp(), end));
    }

    private static ChecklistItem item(String title, LocalDate dueDate) {
        return new ChecklistItem(UUID.randomUUID(), title, dueDate, false);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Conditions(int durationWeeks, Long budgetWon, String channel) {}

    record ChecklistUpdate(boolean planFound, ChecklistItem item) {}

    record ChecklistItem(UUID id, String title, LocalDate dueDate, boolean completed) {}

    record Plan(UUID id, UUID analysisId, Suggestion strategy, Conditions conditions, LocalDate startDate,
                LocalDate endDate, List<ChecklistItem> checklist, OffsetDateTime createdAt) {}
}
