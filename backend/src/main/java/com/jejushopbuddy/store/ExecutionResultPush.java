package com.jejushopbuddy.store;

import com.jejushopbuddy.analysis.PromotionArchivePush;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class ExecutionResultPush {
    private static final Logger log = LoggerFactory.getLogger(ExecutionResultPush.class);
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private final JdbcClient jdbc;
    private final AppleWebPush push;
    private final PromotionArchivePush archive;
    private final UUID testPlan;
    private final int testDelaySeconds;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    ExecutionResultPush(JdbcClient jdbc, AppleWebPush push, PromotionArchivePush archive,
                        @Value("${SHOP_BUDDY_RESULT_PUSH_TEST_PLAN_ID:}") String testPlan,
                        @Value("${SHOP_BUDDY_RESULT_PUSH_TEST_DELAY_SECONDS:45}") int testDelaySeconds) {
        this.jdbc = jdbc;
        this.push = push;
        this.archive = archive;
        this.testPlan = testPlan.isBlank() ? null : UUID.fromString(testPlan);
        this.testDelaySeconds = testDelaySeconds;
    }

    @PostConstruct
    void start() {
        if (push.publicKey() != null) {
            scheduler.scheduleWithFixedDelay(this::poll, 0, testPlan == null ? 60 : 5, TimeUnit.SECONDS);
        }
    }

    @PreDestroy
    void stop() {
        scheduler.shutdownNow();
    }

    private void poll() {
        try {
            runDue(Instant.now());
        } catch (RuntimeException failure) {
            log.warn("Execution result push scan failed ({})", failure.getClass().getSimpleName());
        }
    }

    void runDue(Instant now) {
        var seoul = now.atZone(SEOUL);
        LocalDate today = seoul.toLocalDate();
        var recipients = jdbc.sql("""
                SELECT p.id AS plan_id, p.analysis_id, s.id AS store_id, p.end_date, o.email, o.id AS owner_id,
                       sub.registered_at, sub.result_enabled_at, sub.endpoint, sub.p256dh, sub.auth_secret,
                       (p.strategy_code = 'PROMOTION' OR COALESCE(
                         p.strategy_code = 'CUSTOM' AND p.strategy_snapshot @> '{"marketing":true}', false)) AS promotion
                FROM weekly_pos_push_subscriptions sub JOIN owners o ON o.id = sub.owner_id
                JOIN stores s ON s.owner_id = o.id JOIN sales_analyses a ON a.store_id = s.id
                JOIN execution_plans p ON p.analysis_id = a.id
                WHERE p.end_date < :today AND sub.result_enabled_at <= :enabledBefore
                  AND (CASE WHEN CAST(:testPlan AS uuid) IS NULL
                        THEN p.end_date >= (sub.result_enabled_at AT TIME ZONE 'Asia/Seoul')::date
                        ELSE p.id = :testPlan END)
                  AND (p.strategy_code = 'PROMOTION' OR (p.strategy_code = 'CUSTOM' AND p.strategy_snapshot @> '{"marketing":true}')
                        OR NOT EXISTS (SELECT 1 FROM execution_results r WHERE r.plan_id = p.id))
                ORDER BY p.end_date, p.id
                """).param("today", today).param("testPlan", testPlan)
                .param("enabledBefore", seoul.minusSeconds(testPlan == null ? 0 : testDelaySeconds).toOffsetDateTime())
                .query((rs, row) -> new Recipient(rs.getObject("plan_id", UUID.class), rs.getObject("analysis_id", UUID.class),
                        rs.getObject("store_id", UUID.class), rs.getObject("owner_id", UUID.class), rs.getString("email"),
                        rs.getObject("end_date", LocalDate.class), rs.getBoolean("promotion"),
                        rs.getObject("registered_at", OffsetDateTime.class), rs.getObject("result_enabled_at", OffsetDateTime.class),
                        new AppleWebPush.Subscription(rs.getString("endpoint"),
                                new AppleWebPush.Keys(rs.getString("p256dh"), rs.getString("auth_secret")))))
                .list();
        for (var recipient : recipients) {
            if (Thread.currentThread().isInterrupted()) return;
            try {
                var notice = notice(recipient, today);
                if (notice != null && claim(recipient, notice.key())) send(recipient, notice);
            } catch (RuntimeException failure) {
                log.warn("Execution result notification could not be prepared ({})", failure.getClass().getSimpleName());
            }
        }
    }

    private Notice notice(Recipient to, LocalDate today) {
        String resultPath = "/results?id=" + to.planId() + "&analysisId=" + to.analysisId();
        if (!to.promotion()) return new Notice("due:" + to.endDate(), new AppleWebPush.Message(resultPath, "result-due"));
        var status = archive.reconcile(to.planId(), to.storeId(), to.email(), today);
        if (status == null) return null;
        if (status.gapStart() == null) return new Notice("ready:" + status.basis(), new AppleWebPush.Message(resultPath, "result-ready"));
        String path = "/stores?storeId=" + to.storeId() + "&section=pos-files&date=" + status.gapEnd()
                + "&kind=PRODUCT&focus=upload&missingStart=" + status.gapStart()
                + "&resultPlanId=" + to.planId() + "&resultAnalysisId=" + to.analysisId();
        return new Notice("missing:" + status.gapStart() + ":" + status.gapEnd() + ":" + status.basis(),
                new AppleWebPush.Message(path, "result-pos-needed"));
    }

    private boolean claim(Recipient to, String key) {
        return jdbc.sql("""
                INSERT INTO execution_result_push_deliveries (plan_id, notice_key)
                SELECT p.id, :key FROM execution_plans p JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id JOIN weekly_pos_push_subscriptions sub ON sub.owner_id = s.owner_id
                WHERE p.id = :plan AND sub.owner_id = :owner AND sub.registered_at = :registered
                  AND sub.result_enabled_at = :enabled
                  AND (:promotion OR NOT EXISTS (SELECT 1 FROM execution_results r WHERE r.plan_id = p.id))
                ON CONFLICT (plan_id, notice_key) DO NOTHING
                """).param("key", key).param("plan", to.planId()).param("owner", to.ownerId())
                .param("registered", to.registered()).param("enabled", to.enabled())
                .param("promotion", to.promotion()).update() == 1;
    }

    private void send(Recipient to, Notice notice) {
        String outcome = "FAILED";
        try {
            int status = push.deliver(push.prepare(to.subscription(), notice.message(), 3600));
            if (status >= 200 && status < 300) {
                outcome = "SENT";
                log.info("Apple accepted execution result push (kind {}, status {})", notice.message().kind(), status);
            } else if (status == 404 || status == 410) {
                outcome = "EXPIRED";
                jdbc.sql("DELETE FROM weekly_pos_push_subscriptions WHERE owner_id = :owner AND registered_at = :registered")
                        .param("owner", to.ownerId()).param("registered", to.registered()).update();
            } else {
                log.warn("Apple declined execution result push (status {})", status);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch (Exception failure) {
            log.warn("Execution result push failed ({})", failure.getClass().getSimpleName());
        } finally {
            jdbc.sql("UPDATE execution_result_push_deliveries SET outcome = :outcome WHERE plan_id = :plan AND notice_key = :key")
                    .param("outcome", outcome).param("plan", to.planId()).param("key", notice.key()).update();
        }
    }

    private record Recipient(UUID planId, UUID analysisId, UUID storeId, UUID ownerId, String email,
                             LocalDate endDate, boolean promotion, OffsetDateTime registered, OffsetDateTime enabled,
                             AppleWebPush.Subscription subscription) {}
    private record Notice(String key, AppleWebPush.Message message) {}
}
