package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import com.jejushopbuddy.analysis.ExecutionOutcomeController.*;
import com.jejushopbuddy.time.BusinessDate;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import tools.jackson.databind.json.JsonMapper;

class ExecutionOutcomeTest {
    private static final LocalDate TODAY = LocalDate.parse("2021-06-15");
    private static Outcome sample(boolean simulated) {
        return new Outcome(simulated, LocalDate.parse("2021-06-01"), "가상 홍보 초안 검토", "실제 게시·개선 결과 아님", null, "",
                new Comparison("김치찌개",
                        new Period(LocalDate.parse("2021-05-18"), LocalDate.parse("2021-05-31"), 12, 6619000L, 312L, 48L, 204L, 1632000L),
                        new Period(LocalDate.parse("2021-06-01"), LocalDate.parse("2021-06-14"), 12, 6968000L, 336L, 72L, 247L, 1976000L),
                        List.of(new Source("SIMULATED-before-payment.csv", "a".repeat(64)), new Source("SIMULATED-before-product.csv", "b".repeat(64)),
                                new Source("SIMULATED-after-payment.csv", "c".repeat(64)), new Source("SIMULATED-after-product.csv", "d".repeat(64)))), null);
    }

    @Test void requiresCompletedPeriodsAndSimulatedProvenance() {
        assertThat(ExecutionOutcomeController.valid(sample(true), TODAY)).isTrue();
        assertThat(ExecutionOutcomeController.valid(sample(false), TODAY)).isFalse();
        assertThat(ExecutionOutcomeController.valid(sample(true), TODAY.minusDays(1))).isFalse();
        assertThat(ExecutionOutcomeController.valid(null, TODAY)).isFalse();
    }

    @Test void distinguishesUnknownReviewsFromObservedZeroAndRejectsInvalidInventory() {
        var unknown = new Outcome(true, TODAY.minusDays(1), "안내문 점검", "", null, null, null, null);
        assertThat(ExecutionOutcomeController.valid(unknown, TODAY)).isTrue();
        assertThat(ExecutionOutcomeController.valid(new Outcome(true, TODAY.minusDays(1), "안내문 점검", "", 0, "", null, null), TODAY)).isFalse();
        assertThat(ExecutionOutcomeController.valid(new Outcome(true, TODAY.minusDays(1), "안내문 점검", "", 0, "6월 1~14일 가상 검색 범위", null, null), TODAY)).isTrue();
        var inventory = new Inventory(LocalDate.parse("2021-06-05"), "김치찌개", 23L,
                List.of(new Remaining("돼지고기", "kg", new BigDecimal("-0.2"))));
        assertThat(ExecutionOutcomeController.valid(new Outcome(true, LocalDate.parse("2021-06-05"), "발주 점검", "", null, null, null, inventory), TODAY)).isFalse();
    }

    @Test @EnabledIfEnvironmentVariable(named = "SHOP_BUDDY_TEST_OUTCOME_DB", matches = "true")
    void persistsReloadsAndProtectsOwnershipWithoutChangingPublicationOrPlans() {
        var env = System.getenv();
        var source = new DriverManagerDataSource(env.get("SHOP_BUDDY_DB_URL"), env.get("SHOP_BUDDY_DB_USER"), env.get("SHOP_BUDDY_DB_PASSWORD"));
        String schema = "outcome_test_" + UUID.randomUUID().toString().replace("-", "");
        var jdbc = JdbcClient.create(source);
        jdbc.sql("CREATE SCHEMA " + schema).update();
        try {
            source.setSchema(schema);
            new ResourceDatabasePopulator(new FileSystemResource("../schema.sql"), new FileSystemResource("../seed-jeju-areas.sql"),
                    new FileSystemResource("../seed-aewol-demo.sql")).execute(source);
            // Migration must also be safe to run repeatedly on an initialized schema.
            new ResourceDatabasePopulator(new FileSystemResource("../migration-execution-outcome.sql"),
                    new FileSystemResource("../migration-execution-outcome.sql")).execute(source);
            var id = UUID.randomUUID();
            var email = jdbc.sql("SELECT email FROM owners LIMIT 1").query(String.class).single();
            jdbc.sql("""
                    INSERT INTO execution_plans (id, analysis_id, strategy_code, strategy_snapshot, duration_weeks, start_date, end_date)
                    SELECT :id, id, 'CUSTOM', '{"marketing":true}', 2, DATE '2021-06-01', DATE '2021-06-14'
                    FROM sales_analyses LIMIT 1
                    """).param("id", id).update();
            var mapper = JsonMapper.builder().findAndAddModules().build();
            var clock = new BusinessDate(null) { @Override public LocalDate today() { return TODAY; } };
            var controller = new ExecutionOutcomeController(jdbc, mapper, clock);
            assertThat(((Envelope) controller.read(id, () -> email).getBody()).outcome()).isNull();
            assertThat(controller.save(id, sample(true), () -> email).getStatusCode().value()).isEqualTo(200);
            var reopened = new ExecutionOutcomeController(jdbc, mapper, clock);
            assertThat(((Envelope) reopened.read(id, () -> email).getBody()).outcome()).isEqualTo(sample(true));
            var earlierClock = new BusinessDate(null) { @Override public LocalDate today() { return LocalDate.parse("2021-06-01"); } };
            var earlier = (Envelope) new ExecutionOutcomeController(jdbc, mapper, earlierClock).read(id, () -> email).getBody();
            assertThat(earlier.outcome()).isNull();
            assertThat(earlier.pendingUntil()).isEqualTo(TODAY);
            assertThat(controller.read(id, () -> "other@example.test").getStatusCode().value()).isEqualTo(404);
            assertThat(controller.save(id, sample(true), () -> "other@example.test").getStatusCode().value()).isEqualTo(404);
            assertThat(jdbc.sql("SELECT manual_promotion_publication IS NULL AND instagram_publication IS NULL FROM execution_plans WHERE id=:id")
                    .param("id", id).query(Boolean.class).single()).isTrue();
            var inventory = new Inventory(LocalDate.parse("2021-06-05"), "김치찌개", 23L,
                    List.of(new Remaining("돼지고기", "kg", new BigDecimal("0.2"))));
            var replacement = new Outcome(true, LocalDate.parse("2021-06-05"), "김치찌개 배정 재료 당일 점검", "다른 메뉴 사용 없음 가정", null, null, null, inventory);
            assertThat(controller.save(id, replacement, () -> email).getStatusCode().value()).isEqualTo(200);
            assertThat(((Envelope) reopened.read(id, () -> email).getBody()).outcome()).isEqualTo(replacement);
        } finally {
            source.setSchema(null);
            jdbc.sql("DROP SCHEMA " + schema + " CASCADE").update();
        }
    }
}
