package com.jejushopbuddy.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.jejushopbuddy.analysis.PromotionArchivePush;
import java.net.URI;
import java.net.http.HttpRequest;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

class WeeklyPosPushTest {
    @Test
    void usesSeoulWeekAndOpensThePreviousSunday() {
        UUID storeId = UUID.randomUUID();
        LocalDate week = WeeklyPosPush.weekStart(Instant.parse("2026-11-15T15:00:00Z"));
        assertThat(week).isEqualTo("2026-11-16");
        assertThat(WeeklyPosPush.posPath(storeId, week))
                .isEqualTo("/stores?storeId=" + storeId + "&section=pos-files&date=2026-11-15&focus=upload");
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "SHOP_BUDDY_TEST_WEEKLY_POS_DB", matches = "true")
    void claimsOneDeliveryAcrossConcurrentWorkersAndSendsAgainNextWeek() throws Exception {
        var env = System.getenv();
        String url = env.getOrDefault("SHOP_BUDDY_DB_URL", "jdbc:postgresql://127.0.0.1:5432/jeju_shop_buddy_dev");
        var source = new DriverManagerDataSource(url, env.getOrDefault("SHOP_BUDDY_DB_USER", "jeju_shop_buddy"),
                env.getOrDefault("SHOP_BUDDY_DB_PASSWORD", ""));
        String schema = "weekly_pos_test_" + UUID.randomUUID().toString().replace("-", "");
        JdbcClient admin = JdbcClient.create(source);
        admin.sql("CREATE SCHEMA " + schema).update();
        try {
            source.setSchema(schema);
            JdbcClient jdbc = JdbcClient.create(source);
            jdbc.sql("CREATE TABLE owners (id uuid PRIMARY KEY, email text NOT NULL)").update();
            jdbc.sql("CREATE TABLE stores (id uuid PRIMARY KEY, owner_id uuid NOT NULL, created_at timestamptz NOT NULL)").update();
            jdbc.sql("CREATE TABLE sales_analyses (id uuid PRIMARY KEY, store_id uuid NOT NULL)").update();
            jdbc.sql("""
                    CREATE TABLE execution_plans (id uuid PRIMARY KEY, analysis_id uuid NOT NULL,
                        end_date date NOT NULL, strategy_code text NOT NULL, strategy_snapshot jsonb)
                    """).update();
            jdbc.sql("CREATE TABLE execution_results (plan_id uuid NOT NULL)").update();
            new ResourceDatabasePopulator(new FileSystemResource("../migration-weekly-pos-push.sql"),
                    new FileSystemResource("../migration-execution-result-push.sql")).execute(source);
            verifyDeliveries(jdbc);
            verifyResultPushes(jdbc);
        } finally {
            source.setSchema(null);
            admin.sql("DROP SCHEMA " + schema + " CASCADE").update();
        }
    }

    private void verifyDeliveries(JdbcClient jdbc) throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID storeId = UUID.randomUUID();
        String email = "weekly-test@example.test";
        jdbc.sql("INSERT INTO owners VALUES (:id, :email)").param("id", ownerId).param("email", email).update();
        jdbc.sql("INSERT INTO stores VALUES (:id, :owner, CURRENT_TIMESTAMP)")
                .param("id", storeId).param("owner", ownerId).update();
        var subscription = new AppleWebPush.Subscription("https://web.push.apple.com/test-fixture",
                new AppleWebPush.Keys("test-public-key", "test-auth-secret"));
        AppleWebPush push = mock(AppleWebPush.class);
        var first = new WeeklyPosPush(jdbc, push, DayOfWeek.MONDAY, LocalTime.of(9, 0), "", 45);
        var second = new WeeklyPosPush(jdbc, push, DayOfWeek.MONDAY, LocalTime.of(9, 0), "", 45);
        first.enable(email, subscription);
        assertThat(second.enabled(email)).isTrue();
        OffsetDateTime subscribedAt = OffsetDateTime.parse("2026-11-15T08:00:00+09:00");
        jdbc.sql("UPDATE weekly_pos_push_subscriptions SET registered_at = :at")
                .param("at", subscribedAt).update();
        second.enable(email, subscription);
        assertThat(jdbc.sql("SELECT registered_at FROM weekly_pos_push_subscriptions")
                .query(OffsetDateTime.class).single().toInstant()).isEqualTo(subscribedAt.toInstant());
        first.runDue(Instant.parse("2026-11-15T23:59:59Z"));
        verifyNoInteractions(push);
        Instant due = Instant.parse("2026-11-16T00:00:00Z");
        var request = HttpRequest.newBuilder(URI.create(subscription.endpoint())).build();
        when(push.prepare(eq(subscription), any(), anyInt())).thenReturn(request);
        when(push.deliver(request)).thenReturn(201, 410);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var one = pool.submit(() -> first.runDue(due));
            var two = pool.submit(() -> second.runDue(due));
            one.get();
            two.get();
        }
        second.runDue(due.plusSeconds(60));
        verify(push, times(1)).deliver(request);
        verify(push).prepare(subscription,
                new AppleWebPush.Message(WeeklyPosPush.posPath(storeId, LocalDate.parse("2026-11-16")), "weekly-pos"), 3600);
        second.runDue(due.plusSeconds(7 * 86400L));
        verify(push, times(2)).deliver(request);
        assertThat(first.enabled(email)).isFalse();
        assertThat(jdbc.sql("SELECT outcome FROM weekly_pos_push_deliveries ORDER BY week_start").query(String.class).list())
                .containsExactly("SENT", "EXPIRED");
        first.enable(email, subscription);
        assertThat(second.enabled(email)).isTrue();
        second.enable(email, subscription, true);
        second.disable(email);
        assertThat(first.preferences(email)).isEqualTo(new WeeklyPosPush.Preferences(false, true));
        first.runDue(due.plusSeconds(14 * 86400L));
        assertThat(first.enabled(email)).isFalse();
        verify(push, times(2)).deliver(request);
        second.disable(email, true);
        assertThat(first.preferences(email)).isEqualTo(new WeeklyPosPush.Preferences(false, false));
    }

    private void verifyResultPushes(JdbcClient jdbc) throws Exception {
        UUID owner = UUID.randomUUID();
        UUID store = UUID.randomUUID();
        UUID analysis = UUID.randomUUID();
        UUID plan = UUID.randomUUID();
        String email = "result-test@example.test";
        LocalDate end = LocalDate.parse("2026-11-22");
        jdbc.sql("INSERT INTO owners VALUES (:id, :email)").param("id", owner).param("email", email).update();
        jdbc.sql("INSERT INTO stores VALUES (:id, :owner, CURRENT_TIMESTAMP)").param("id", store).param("owner", owner).update();
        jdbc.sql("INSERT INTO sales_analyses VALUES (:id, :store)").param("id", analysis).param("store", store).update();
        jdbc.sql("INSERT INTO execution_plans VALUES (:id, :analysis, :end, 'PROMOTION', '{}')")
                .param("id", plan).param("analysis", analysis).param("end", end).update();
        var subscription = new AppleWebPush.Subscription("https://web.push.apple.com/result-test-fixture",
                new AppleWebPush.Keys("test-public-key", "test-auth-secret"));
        var push = mock(AppleWebPush.class);
        var archive = mock(PromotionArchivePush.class);
        var options = new WeeklyPosPush(jdbc, push, DayOfWeek.MONDAY, LocalTime.of(9, 0), "", 45);
        options.enable(email, subscription, true);
        assertThat(options.preferences(email)).isEqualTo(new WeeklyPosPush.Preferences(false, true));
        jdbc.sql("UPDATE weekly_pos_push_subscriptions SET result_enabled_at = :at WHERE owner_id = :id")
                .param("id", owner).param("at", OffsetDateTime.parse("2026-11-16T08:00:00+09:00")).update();
        var first = new ExecutionResultPush(jdbc, push, archive, "", 45);
        var second = new ExecutionResultPush(jdbc, push, archive, "", 45);
        var due = Instant.parse("2026-11-22T15:00:00Z");
        first.runDue(due.minusSeconds(1));
        verifyNoInteractions(archive, push);
        LocalDate missingStart = LocalDate.parse("2026-11-20");
        var pending = new PromotionArchivePush.Status("comparison", missingStart, end);
        when(archive.reconcile(plan, store, email, end.plusDays(1))).thenReturn(pending);
        var request = HttpRequest.newBuilder(URI.create(subscription.endpoint())).build();
        when(push.prepare(eq(subscription), any(), anyInt())).thenReturn(request);
        when(push.deliver(request)).thenReturn(201);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var one = pool.submit(() -> first.runDue(due));
            var two = pool.submit(() -> second.runDue(due));
            one.get();
            two.get();
        }
        verify(push, times(1)).deliver(request);
        verify(push).prepare(subscription, new AppleWebPush.Message("/stores?storeId=" + store
                + "&section=pos-files&date=" + end + "&kind=PRODUCT&focus=upload&missingStart=" + missingStart
                + "&resultPlanId=" + plan + "&resultAnalysisId=" + analysis, "result-pos-needed"), 3600);
        when(archive.reconcile(plan, store, email, end.plusDays(1)))
                .thenReturn(new PromotionArchivePush.Status("comparison", null, null));
        second.runDue(due.plusSeconds(60));
        first.runDue(due.plusSeconds(120));
        verify(push, times(2)).deliver(request);
        verify(push).prepare(subscription, new AppleWebPush.Message(
                "/results?id=" + plan + "&analysisId=" + analysis, "result-ready"), 3600);
        assertThat(jdbc.sql("SELECT outcome FROM execution_result_push_deliveries").query(String.class).list())
                .containsExactly("SENT", "SENT");
    }
}
