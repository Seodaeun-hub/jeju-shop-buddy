package com.jejushopbuddy.store;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class WeeklyPosPush {
    private static final Logger log = LoggerFactory.getLogger(WeeklyPosPush.class);
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    private final JdbcClient jdbc;
    private final AppleWebPush push;
    private final DayOfWeek day;
    private final LocalTime time;
    private final UUID localTestStore;
    private final int localTestDelay;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    WeeklyPosPush(JdbcClient jdbc, AppleWebPush push,
                  @Value("${SHOP_BUDDY_WEEKLY_POS_DAY:MONDAY}") DayOfWeek day,
                  @Value("${SHOP_BUDDY_WEEKLY_POS_TIME:09:00}") LocalTime time,
                  @Value("${SHOP_BUDDY_WEEKLY_POS_TEST_STORE_ID:}") String localTestStore,
                  @Value("${SHOP_BUDDY_WEEKLY_POS_TEST_DELAY_SECONDS:45}") int localTestDelay) {
        this.jdbc = jdbc;
        this.push = push;
        this.day = day;
        this.time = time;
        this.localTestStore = localTestStore.isBlank() ? null : UUID.fromString(localTestStore);
        if (this.localTestStore != null && localTestDelay < 15) {
            throw new IllegalArgumentException("Weekly POS test delay must allow time to close the app");
        }
        this.localTestDelay = localTestDelay;
    }

    @PostConstruct
    void start() {
        if (push.publicKey() != null) {
            scheduler.scheduleWithFixedDelay(this::poll, 0, localTestStore == null ? 30 : 5, TimeUnit.SECONDS);
        }
    }

    @PreDestroy
    void stop() {
        scheduler.shutdownNow();
    }

    String label() {
        return "매주 " + day.getDisplayName(java.time.format.TextStyle.FULL, Locale.KOREAN)
                + " " + time.format(TIME) + " (한국 시간)";
    }

    boolean enabled(String email) {
        return preferences(email).weekly();
    }

    Preferences preferences(String email) {
        return jdbc.sql("""
                SELECT weekly_enabled, result_enabled_at IS NOT NULL AS results
                FROM weekly_pos_push_subscriptions s JOIN owners o ON o.id = s.owner_id
                WHERE o.email = :email
                """).param("email", email).query((rs, row) ->
                        new Preferences(rs.getBoolean("weekly_enabled"), rs.getBoolean("results")))
                .optional().orElse(new Preferences(false, false));
    }

    void enable(String email, AppleWebPush.Subscription subscription) {
        enable(email, subscription, false);
    }

    void enable(String email, AppleWebPush.Subscription subscription, boolean results) {
        jdbc.sql("""
                INSERT INTO weekly_pos_push_subscriptions (owner_id, endpoint, p256dh, auth_secret, weekly_enabled, result_enabled_at)
                SELECT id, :endpoint, :p256dh, :auth, NOT :results, CASE WHEN :results THEN CURRENT_TIMESTAMP END
                FROM owners WHERE email = :email
                ON CONFLICT (owner_id) DO UPDATE SET
                    endpoint = EXCLUDED.endpoint, p256dh = EXCLUDED.p256dh, auth_secret = EXCLUDED.auth_secret,
                    weekly_enabled = weekly_pos_push_subscriptions.weekly_enabled OR EXCLUDED.weekly_enabled,
                    result_enabled_at = COALESCE(weekly_pos_push_subscriptions.result_enabled_at, EXCLUDED.result_enabled_at),
                    registered_at = CASE WHEN
                        (weekly_pos_push_subscriptions.endpoint, weekly_pos_push_subscriptions.p256dh,
                         weekly_pos_push_subscriptions.auth_secret) IS DISTINCT FROM
                        (EXCLUDED.endpoint, EXCLUDED.p256dh, EXCLUDED.auth_secret)
                        OR (EXCLUDED.weekly_enabled AND NOT weekly_pos_push_subscriptions.weekly_enabled)
                        THEN EXCLUDED.registered_at ELSE weekly_pos_push_subscriptions.registered_at END
                """).param("email", email).param("endpoint", subscription.endpoint())
                .param("p256dh", subscription.keys().p256dh()).param("auth", subscription.keys().auth())
                .param("results", results).update();
    }

    void disable(String email) {
        disable(email, false);
    }

    @Transactional
    public void disable(String email, boolean results) {
        jdbc.sql("""
                UPDATE weekly_pos_push_subscriptions s
                SET weekly_enabled = weekly_enabled AND :results,
                    result_enabled_at = CASE WHEN :results THEN NULL ELSE result_enabled_at END
                FROM owners o WHERE o.id = s.owner_id AND o.email = :email
                """).param("email", email).param("results", results).update();
        jdbc.sql("""
                DELETE FROM weekly_pos_push_subscriptions s USING owners o
                WHERE o.id = s.owner_id AND o.email = :email AND NOT weekly_enabled AND result_enabled_at IS NULL
                """).param("email", email).update();
    }

    private void poll() {
        try {
            runDue(Instant.now());
        } catch (RuntimeException failure) {
            log.warn("Weekly POS push scan failed ({})", failure.getClass().getSimpleName());
        }
    }

    void runDue(Instant now) {
        var seoul = now.atZone(SEOUL);
        if (localTestStore == null && (seoul.getDayOfWeek() != day || seoul.toLocalTime().isBefore(time))) return;
        LocalDate week = weekStart(now);
        OffsetDateTime registeredBefore = localTestStore == null
                ? seoul.toLocalDate().atTime(time).atZone(SEOUL).toOffsetDateTime()
                : seoul.minusSeconds(localTestDelay).toOffsetDateTime();
        var recipients = jdbc.sql("""
                SELECT sub.owner_id, sub.endpoint, sub.p256dh, sub.auth_secret, sub.registered_at, store.id AS store_id
                FROM weekly_pos_push_subscriptions sub
                JOIN LATERAL (
                    SELECT id FROM stores
                    WHERE owner_id = sub.owner_id AND (CAST(:testStore AS uuid) IS NULL OR id = :testStore)
                    ORDER BY created_at DESC, id LIMIT 1
                ) store ON true
                WHERE sub.weekly_enabled AND sub.registered_at <= :registeredBefore
                AND NOT EXISTS (
                    SELECT 1 FROM weekly_pos_push_deliveries d
                    WHERE d.owner_id = sub.owner_id AND d.week_start = :week
                )
                """).param("testStore", localTestStore).param("registeredBefore", registeredBefore).param("week", week)
                .query((rs, row) -> new Recipient(rs.getObject("owner_id", UUID.class), rs.getObject("store_id", UUID.class),
                        rs.getObject("registered_at", OffsetDateTime.class),
                        new AppleWebPush.Subscription(rs.getString("endpoint"),
                                new AppleWebPush.Keys(rs.getString("p256dh"), rs.getString("auth_secret")))))
                .list();
        for (Recipient recipient : recipients) {
            if (Thread.currentThread().isInterrupted()) return;
            if (claim(recipient, week)) send(recipient, week);
        }
    }

    private boolean claim(Recipient recipient, LocalDate week) {
        return jdbc.sql("""
                INSERT INTO weekly_pos_push_deliveries (owner_id, week_start)
                SELECT owner_id, :week FROM weekly_pos_push_subscriptions
                WHERE owner_id = :owner AND registered_at = :registeredAt AND weekly_enabled
                ON CONFLICT (owner_id, week_start) DO NOTHING
                """).param("week", week).param("owner", recipient.ownerId())
                .param("registeredAt", recipient.registeredAt()).update() == 1;
    }

    private void send(Recipient recipient, LocalDate week) {
        String outcome = "FAILED";
        try {
            var message = new AppleWebPush.Message(posPath(recipient.storeId(), week), "weekly-pos");
            int status = push.deliver(push.prepare(recipient.subscription(), message, 3600));
            if (status >= 200 && status < 300) {
                outcome = "SENT";
                log.info("Apple accepted weekly POS push (week {}, status {})", week, status);
            } else if (status == 404 || status == 410) {
                outcome = "EXPIRED";
                jdbc.sql("""
                        DELETE FROM weekly_pos_push_subscriptions WHERE owner_id = :owner AND registered_at = :registeredAt
                        """).param("owner", recipient.ownerId()).param("registeredAt", recipient.registeredAt()).update();
                log.info("Expired weekly POS push subscription removed (status {})", status);
            } else {
                log.warn("Apple declined weekly POS push (status {})", status);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch (Exception failure) {
            log.warn("Weekly POS push failed ({})", failure.getClass().getSimpleName());
        } finally {
            jdbc.sql("""
                    UPDATE weekly_pos_push_deliveries SET outcome = :outcome WHERE owner_id = :owner AND week_start = :week
                    """).param("outcome", outcome).param("owner", recipient.ownerId()).param("week", week).update();
        }
    }

    static LocalDate weekStart(Instant now) {
        return now.atZone(SEOUL).toLocalDate().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    static String posPath(UUID storeId, LocalDate week) {
        return "/stores?storeId=" + storeId + "&section=pos-files&date=" + week.minusDays(1) + "&focus=upload";
    }

    record Preferences(boolean weekly, boolean results) {}
    private record Recipient(UUID ownerId, UUID storeId, OffsetDateTime registeredAt, AppleWebPush.Subscription subscription) {}
}
