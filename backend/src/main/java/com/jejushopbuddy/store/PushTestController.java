package com.jejushopbuddy.store;

import com.interaso.webpush.VapidKeys;
import com.interaso.webpush.WebPush;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.Principal;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
class PushTestController {
    private static final Logger log = LoggerFactory.getLogger(PushTestController.class);
    private static final int DELAY_SECONDS = 15;
    private static final int TTL_SECONDS = 120;

    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final String publicKey;
    private final WebPush push;
    private final AtomicBoolean pending = new AtomicBoolean();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private VapidToken vapidToken;

    PushTestController(JdbcClient jdbc, ObjectMapper json,
                       @Value("${SHOP_BUDDY_WEB_PUSH_PUBLIC_KEY:}") String publicKey,
                       @Value("${SHOP_BUDDY_WEB_PUSH_PRIVATE_KEY:}") String privateKey,
                       @Value("${SHOP_BUDDY_WEB_PUSH_SUBJECT:}") String subject) {
        this.jdbc = jdbc;
        this.json = json;
        this.publicKey = publicKey;
        this.push = publicKey.isBlank() || privateKey.isBlank() || subject.isBlank()
                ? null : new WebPush(subject, VapidKeys.fromUncompressedBytes(publicKey, privateKey));
    }

    @GetMapping("/api/push/config")
    PushConfig config() {
        return new PushConfig(push == null ? null : publicKey);
    }

    @PostMapping("/api/push/test")
    ResponseEntity<?> test(@RequestBody Subscription subscription, Principal owner) {
        if (push == null) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "테스트 알림이 아직 설정되지 않았어요.");
        }
        URI endpoint = appleEndpoint(subscription.endpoint());
        Keys keys = subscription.keys();
        byte[] publicBytes = keys == null ? null : decodeKey(keys.p256dh(), 65);
        byte[] authBytes = keys == null ? null : decodeKey(keys.auth(), 16);
        if (endpoint == null || publicBytes == null || authBytes == null) {
            return error(HttpStatus.BAD_REQUEST, "아이폰 홈 화면에서 가게짝꿍을 열고 알림을 허용해 주세요.");
        }
        var store = jdbc.sql("""
                SELECT s.id FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE o.email = :email ORDER BY s.created_at DESC, s.id LIMIT 1
                """).param("email", owner.getName()).query(UUID.class).optional();
        if (store.isEmpty()) {
            return error(HttpStatus.BAD_REQUEST, "테스트 알림을 받으려면 먼저 매장을 등록해 주세요.");
        }
        LocalDate previousSunday = LocalDate.now(ZoneId.of("Asia/Seoul"))
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).minusDays(1);
        String path = "/stores?storeId=" + store.get() + "&section=pos-files&date=" + previousSunday + "&focus=upload";
        HttpRequest request;
        try {
            byte[] payload = push.getBody(json.writeValueAsBytes(new TestMessage(path)), publicBytes, authBytes);
            var builder = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(10))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(payload));
            push.getHeadersWithToken(tokenFor(endpoint), TTL_SECONDS, null, WebPush.Urgency.High)
                    .forEach(builder::header);
            request = builder.build();
        } catch (Exception failure) {
            log.warn("Web Push test preparation failed ({})", failure.getClass().getSimpleName());
            return error(HttpStatus.BAD_REQUEST, "테스트 알림을 준비하지 못했어요. 알림 권한을 확인해 주세요.");
        }
        if (!pending.compareAndSet(false, true)) {
            return error(HttpStatus.TOO_MANY_REQUESTS, "이미 테스트 알림을 준비하고 있어요. 잠시 기다려 주세요.");
        }
        scheduler.schedule(() -> deliver(request), DELAY_SECONDS, TimeUnit.SECONDS);
        return ResponseEntity.accepted().body(new TestAccepted(DELAY_SECONDS));
    }

    private synchronized String tokenFor(URI endpoint) {
        String audience = push.getAudience(endpoint.toASCIIString());
        Instant now = Instant.now();
        if (vapidToken == null || !vapidToken.audience().equals(audience) || !now.isBefore(vapidToken.refreshAt())) {
            vapidToken = new VapidToken(audience, now.plus(Duration.ofHours(1)), push.getToken(audience, 7200));
        }
        return vapidToken.value();
    }

    private void deliver(HttpRequest request) {
        try {
            int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
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

    static URI appleEndpoint(String raw) {
        if (raw == null || raw.length() > 2048) return null;
        try {
            URI endpoint = URI.create(raw);
            String host = endpoint.getHost();
            if (!"https".equals(endpoint.getScheme()) || host == null
                    || !host.toLowerCase(Locale.ROOT).endsWith(".push.apple.com")
                    || endpoint.getPort() != -1 || endpoint.getRawUserInfo() != null
                    || endpoint.getRawFragment() != null || endpoint.getRawPath().length() < 2) return null;
            return endpoint;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private static byte[] decodeKey(String value, int bytes) {
        if (value == null || value.length() > 88) return null;
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            return decoded.length == bytes ? decoded : null;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private static ResponseEntity<StoreController.ApiError> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(new StoreController.ApiError("PUSH_TEST", message, null));
    }

    @PreDestroy
    void stop() {
        scheduler.shutdownNow();
    }

    record PushConfig(String publicKey) {}
    record Subscription(String endpoint, Keys keys) {}
    record Keys(String p256dh, String auth) {}
    record TestAccepted(int delaySeconds) {}
    record TestMessage(String path) {}
    private record VapidToken(String audience, Instant refreshAt, String value) {}
}
