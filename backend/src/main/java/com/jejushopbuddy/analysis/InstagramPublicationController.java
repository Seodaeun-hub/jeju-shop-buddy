package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.imageio.ImageIO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
class InstagramPublicationController {
    private static final Logger LOG = LoggerFactory.getLogger(InstagramPublicationController.class);
    private static final String GRAPH = "https://graph.facebook.com/v25.0/";
    private static final String JPEG_PREFIX = "data:image/jpeg;base64,";
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ConcurrentHashMap<UUID, byte[]> images = new ConcurrentHashMap<>();
    private final String token;
    private final String accountId;
    private final String username;
    private final String imageBase;
    private final boolean enabled;

    InstagramPublicationController(JdbcClient jdbc, ObjectMapper json,
            @Value("${SHOP_BUDDY_INSTAGRAM_ACCESS_TOKEN:}") String token,
            @Value("${SHOP_BUDDY_INSTAGRAM_ACCOUNT_ID:}") String accountId,
            @Value("${SHOP_BUDDY_INSTAGRAM_USERNAME:}") String username,
            @Value("${SHOP_BUDDY_INSTAGRAM_TEST_STORE_ID:}") String storeId,
            @Value("${SHOP_BUDDY_INSTAGRAM_IMAGE_BASE_URL:}") String imageBase) {
        this.jdbc = jdbc;
        this.json = json;
        this.token = token;
        this.accountId = accountId;
        this.username = username;
        this.imageBase = imageBase.strip().replaceFirst("/+$", "");
        this.enabled = !token.isBlank() && accountId.matches("[0-9]+") && username.matches("[A-Za-z0-9._]+")
                && storeId.matches("[0-9a-fA-F-]{36}") && this.imageBase.matches("https://[A-Za-z0-9.-]+");
        this.storeId = enabled ? UUID.fromString(storeId) : null;
    }

    private final UUID storeId;

    @GetMapping("/api/plans/{planId}/instagram-publication")
    ResponseEntity<?> status(@PathVariable UUID planId, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return error(404, "PROMOTION_PLAN_NOT_FOUND", "홍보 초안을 찾을 수 없어요.");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Status(
                enabled && plan.storeId().equals(storeId), username, plan.publication()));
    }

    @PostMapping("/api/plans/{planId}/instagram-publication")
    ResponseEntity<?> publish(@PathVariable UUID planId, @RequestBody Input input, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return error(404, "PROMOTION_PLAN_NOT_FOUND", "홍보 초안을 찾을 수 없어요.");
        if (!enabled || !plan.storeId().equals(storeId)) {
            return error(409, "INSTAGRAM_NOT_CONNECTED", "이 매장에 테스트용 인스타그램 계정이 연결되어 있지 않아요.");
        }
        if (plan.publication() != null) return ResponseEntity.ok(plan.publication());
        if (plan.draft() == null || !json.readTree(plan.draft()).path("caption").asText().equals(input.caption())
                || !username.equals(input.username())) {
            return error(409, "INSTAGRAM_DRAFT_CHANGED", "초안이나 게시 계정이 바뀌었어요. 다시 열어 확인해 주세요.");
        }
        byte[] image = decodeImage(input.image());
        if (image == null) return error(400, "INVALID_INSTAGRAM_IMAGE", "게시할 홍보 이미지를 다시 만들어 주세요.");

        var pending = new Publication("PUBLISHING", username, null, null, input.caption(), input.image());
        int reserved = jdbc.sql("""
                UPDATE execution_plans SET instagram_publication=CAST(:pending AS jsonb)
                WHERE id=:id AND instagram_publication IS NULL AND promotion_draft=CAST(:draft AS jsonb)
                """).param("pending", json.writeValueAsString(pending)).param("id", planId).param("draft", plan.draft()).update();
        if (reserved == 0) return error(409, "INSTAGRAM_PUBLICATION_CHANGED", "게시 상태가 바뀌었어요. 새로고침해 확인해 주세요.");

        UUID imageKey = UUID.randomUUID();
        images.put(imageKey, image);
        boolean publishRequested = false;
        try {
            String profile = get(accountId + "?fields=username").path("username").asText();
            if (!username.equals(profile)) throw new IOException("Instagram account does not match");
            String container = post(accountId + "/media", "image_url=" + encode(imageBase + "/instagram-media/" + imageKey + ".jpg")
                    + "&caption=" + encode(input.caption())).path("id").asText();
            if (!container.matches("[0-9]+")) throw new IOException("Missing Instagram container ID");
            awaitReady(container);
            publishRequested = true;
            String mediaId = post(accountId + "/media_publish", "creation_id=" + encode(container)).path("id").asText();
            if (!mediaId.matches("[0-9]+")) throw new IOException("Missing Instagram media ID");
            var published = new Publication("PUBLISHED", username, mediaId, permalink(mediaId), pending.caption(), pending.imageDataUrl());
            save(planId, published);
            return ResponseEntity.ok(published);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            return failed(planId, pending, publishRequested, failure);
        } catch (IOException failure) {
            return failed(planId, pending, publishRequested, failure);
        } finally {
            images.remove(imageKey);
        }
    }

    @GetMapping(value = "/instagram-media/{key}.jpg", produces = MediaType.IMAGE_JPEG_VALUE)
    ResponseEntity<byte[]> image(@PathVariable UUID key) {
        byte[] bytes = images.get(key);
        return bytes == null ? ResponseEntity.notFound().build()
                : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(bytes);
    }

    private ResponseEntity<?> failed(UUID planId, Publication pending, boolean publishRequested, Exception failure) {
        LOG.warn("Instagram publication for {}: {}", planId, failure.getMessage());
        if (publishRequested) {
            save(planId, new Publication("VERIFY_REQUIRED", username, null, null, pending.caption(), pending.imageDataUrl()));
            return error(502, "INSTAGRAM_VERIFY_REQUIRED", "게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 인스타그램 피드를 먼저 확인해 주세요.");
        }
        save(planId, null);
        return error(502, "INSTAGRAM_PUBLISH_FAILED", "인스타그램에 게시를 요청하기 전에 연결에 실패했어요. 잠시 후 다시 시도해 주세요.");
    }

    private void awaitReady(String container) throws IOException, InterruptedException {
        for (int attempt = 0; attempt < 5; attempt++) {
            String state = get(container + "?fields=status_code").path("status_code").asText();
            if ("FINISHED".equals(state)) return;
            if (!"IN_PROGRESS".equals(state)) throw new IOException("Unexpected Instagram container status");
            if (attempt < 4) Thread.sleep(1200);
        }
        throw new IOException("Instagram container was not ready");
    }

    private String permalink(String mediaId) {
        try {
            String link = get(mediaId + "?fields=permalink").path("permalink").asText();
            if (link.matches("https://www\\.instagram\\.com/p/[A-Za-z0-9_-]+/?")) return link;
        } catch (IOException failure) {
            LOG.warn("Instagram permalink lookup failed for {}", mediaId);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
        }
        return null;
    }

    private JsonNode get(String path) throws IOException, InterruptedException {
        return send(HttpRequest.newBuilder(URI.create(GRAPH + path)).GET());
    }

    private JsonNode post(String path, String data) throws IOException, InterruptedException {
        return send(HttpRequest.newBuilder(URI.create(GRAPH + path)).header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(data)));
    }

    private JsonNode send(HttpRequest.Builder request) throws IOException, InterruptedException {
        HttpResponse<String> result;
        try {
            result = http.send(request.header("Authorization", "Bearer " + token).timeout(Duration.ofSeconds(12)).build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException failure) {
            throw new IOException("Instagram request timed out or could not connect");
        }
        JsonNode data;
        try {
            data = json.readTree(result.body());
        } catch (RuntimeException failure) {
            throw new IOException("Invalid Instagram response");
        }
        if (result.statusCode() < 200 || result.statusCode() >= 300 || data == null) {
            int code = data == null ? 0 : data.path("error").path("code").asInt();
            int subcode = data == null ? 0 : data.path("error").path("error_subcode").asInt();
            throw new IOException("Instagram HTTP " + result.statusCode() + " (" + code + "/" + subcode + ")");
        }
        return data;
    }

    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private static byte[] decodeImage(String image) {
        if (image == null || !image.startsWith(JPEG_PREFIX) || image.length() > 1_100_000) return null;
        try {
            byte[] bytes = Base64.getDecoder().decode(image.substring(JPEG_PREFIX.length()));
            try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = ImageIO.getImageReaders(input);
                if (!readers.hasNext()) return null;
                var reader = readers.next();
                try {
                    reader.setInput(input);
                    return "JPEG".equalsIgnoreCase(reader.getFormatName())
                            && reader.getWidth(0) == 1080 && reader.getHeight(0) == 1080 ? bytes : null;
                } finally {
                    reader.dispose();
                }
            }
        } catch (IOException | IllegalArgumentException failure) {
            return null;
        }
    }

    private Plan find(UUID planId, String email) {
        return jdbc.sql("""
                SELECT s.id AS store_id, p.promotion_draft, p.instagram_publication
                FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                WHERE p.id=:id AND p.strategy_code='PROMOTION' AND o.email=:email
                """).param("id", planId).param("email", email)
                .query((rs, row) -> {
                    String publication = rs.getString("instagram_publication");
                    return new Plan(rs.getObject("store_id", UUID.class), rs.getString("promotion_draft"),
                            publication == null ? null : json.readValue(publication, Publication.class));
                }).optional().orElse(null);
    }

    private void save(UUID planId, Publication publication) {
        jdbc.sql("UPDATE execution_plans SET instagram_publication=CAST(:value AS jsonb) WHERE id=:id")
                .param("id", planId).param("value", publication == null ? null : json.writeValueAsString(publication)).update();
    }

    private static ResponseEntity<ApiError> error(int status, String code, String message) {
        return ResponseEntity.status(status).body(new ApiError(code, message, null));
    }

    record Input(String username, String caption, String image) {}
    static ResponseEntity<ApiError> locked() {
        return error(409, "INSTAGRAM_PUBLICATION_LOCKED", "인스타그램 게시가 시작된 계획의 할인 조건과 홍보물은 수정할 수 없어요.");
    }

    record Publication(String state, String username, String mediaId, String permalink, String caption, String imageDataUrl) {}
    record Status(boolean available, String username, Publication publication) {}
    private record Plan(UUID storeId, String draft, Publication publication) {}
}
