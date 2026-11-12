package com.jejushopbuddy.store;

import jakarta.annotation.PreDestroy;
import java.net.http.HttpRequest;
import java.security.Principal;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
class PushController {
    private static final Logger log = LoggerFactory.getLogger(PushController.class);
    private static final int DELAY_SECONDS = 15;

    private final JdbcClient jdbc;
    private final AppleWebPush push;
    private final WeeklyPosPush weekly;
    private final AtomicBoolean pending = new AtomicBoolean();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    PushController(JdbcClient jdbc, AppleWebPush push, WeeklyPosPush weekly) {
        this.jdbc = jdbc;
        this.push = push;
        this.weekly = weekly;
    }

    @GetMapping("/api/push/config")
    PushConfig config(Principal owner) {
        String key = push.publicKey();
        return new PushConfig(key, key != null && weekly.enabled(owner.getName()), weekly.label());
    }

    @PutMapping("/api/push/weekly-subscription")
    ResponseEntity<?> subscribe(@RequestBody AppleWebPush.Subscription subscription, Principal owner) {
        if (push.publicKey() == null) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "주간 POS 알림이 아직 설정되지 않았어요.");
        }
        if (!AppleWebPush.valid(subscription)) return invalidSubscription();
        if (latestStore(owner).isEmpty()) return missingStore();
        try {
            weekly.enable(owner.getName(), subscription);
        } catch (DuplicateKeyException alreadyInUse) {
            return error(HttpStatus.CONFLICT, "다른 계정에서 이 아이폰의 주간 POS 알림을 끈 뒤 다시 시도해 주세요.");
        }
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/push/weekly-subscription")
    ResponseEntity<Void> unsubscribe(Principal owner) {
        weekly.disable(owner.getName());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/api/push/test")
    ResponseEntity<?> test(@RequestBody AppleWebPush.Subscription subscription, Principal owner) {
        if (push.publicKey() == null) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "테스트 알림이 아직 설정되지 않았어요.");
        }
        if (!AppleWebPush.valid(subscription)) return invalidSubscription();
        var store = latestStore(owner);
        if (store.isEmpty()) return missingStore();
        HttpRequest request;
        try {
            var message = new AppleWebPush.Message(WeeklyPosPush.posPath(store.get(), WeeklyPosPush.weekStart(Instant.now())), "test");
            request = push.prepare(subscription, message, 120);
        } catch (RuntimeException failure) {
            log.warn("Web Push test preparation failed ({})", failure.getClass().getSimpleName());
            return error(HttpStatus.BAD_REQUEST, "테스트 알림을 준비하지 못했어요. 알림 권한을 확인해 주세요.");
        }
        if (!pending.compareAndSet(false, true)) {
            return error(HttpStatus.TOO_MANY_REQUESTS, "이미 테스트 알림을 준비하고 있어요. 잠시 기다려 주세요.");
        }
        scheduler.schedule(() -> deliver(request), DELAY_SECONDS, TimeUnit.SECONDS);
        return ResponseEntity.accepted().body(new TestAccepted(DELAY_SECONDS));
    }

    private java.util.Optional<UUID> latestStore(Principal owner) {
        return jdbc.sql("""
                SELECT s.id FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE o.email = :email ORDER BY s.created_at DESC, s.id LIMIT 1
                """).param("email", owner.getName()).query(UUID.class).optional();
    }

    private void deliver(HttpRequest request) {
        try {
            int status = push.deliver(request);
            if (status >= 200 && status < 300) {
                log.info("Apple accepted Web Push test ({})", status);
            } else {
                log.warn("Apple declined Web Push test ({})", status);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch (Exception failure) {
            log.warn("Web Push test failed ({})", failure.getClass().getSimpleName());
        } finally {
            pending.set(false);
        }
    }

    private static ResponseEntity<StoreController.ApiError> invalidSubscription() {
        return error(HttpStatus.BAD_REQUEST, "아이폰 홈 화면에서 가게짝꿍을 열고 알림을 허용해 주세요.");
    }

    private static ResponseEntity<StoreController.ApiError> missingStore() {
        return error(HttpStatus.BAD_REQUEST, "알림을 받으려면 먼저 매장을 등록해 주세요.");
    }

    private static ResponseEntity<StoreController.ApiError> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(new StoreController.ApiError("PUSH", message, null));
    }

    @PreDestroy
    void stop() {
        scheduler.shutdownNow();
    }

    record PushConfig(String publicKey, boolean weeklyEnabled, String weeklySchedule) {}
    record TestAccepted(int delaySeconds) {}
}
