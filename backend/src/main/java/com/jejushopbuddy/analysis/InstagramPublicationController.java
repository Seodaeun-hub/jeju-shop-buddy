package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.Principal;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/** Keeps legacy publication receipts readable; external publishing has been retired. */
@RestController
class InstagramPublicationController {
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    InstagramPublicationController(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @GetMapping("/api/plans/{planId}/instagram-publication")
    ResponseEntity<?> status(@PathVariable UUID planId, Principal owner) {
        var snapshot = jdbc.sql("""
                SELECT p.instagram_publication
                FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                WHERE p.id=:id AND o.email=:email
                  AND (p.strategy_code='PROMOTION' OR (p.strategy_code='CUSTOM' AND p.strategy_snapshot @> '{"marketing":true}'))
                """).param("id", planId).param("email", owner.getName())
                .query((rs, row) -> new Snapshot(rs.getString("instagram_publication"))).optional();
        if (snapshot.isEmpty()) return error(404, "PROMOTION_PLAN_NOT_FOUND", "홍보 초안을 찾을 수 없어요.");
        String stored = snapshot.get().value();
        var publication = stored == null ? null : json.readValue(stored, Publication.class);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new Status(false, "", publication, true));
    }

    @PostMapping("/api/plans/{planId}/instagram-publication")
    ResponseEntity<ApiError> publish(@PathVariable UUID planId) {
        return automaticDisabled();
    }

    @DeleteMapping("/api/plans/{planId}/instagram-publication")
    ResponseEntity<ApiError> cancel(@PathVariable UUID planId) {
        return automaticDisabled();
    }

    @GetMapping("/instagram-media/{key}.jpg")
    ResponseEntity<Void> image(@PathVariable UUID key) {
        return ResponseEntity.status(410).cacheControl(CacheControl.noStore()).build();
    }

    private static ResponseEntity<ApiError> automaticDisabled() {
        return error(410, "INSTAGRAM_AUTOMATIC_PUBLICATION_REMOVED",
                "자동 게시·예약 기능이 종료됐어요. 문구 복사와 이미지 저장 후 인스타그램을 열어 직접 게시해 주세요.");
    }

    static ResponseEntity<ApiError> locked() {
        return error(409, "INSTAGRAM_PUBLICATION_LOCKED", "이전 인스타그램 게시 기록이 있는 계획의 할인 조건과 홍보물은 수정할 수 없어요.");
    }

    private static ResponseEntity<ApiError> error(int status, String code, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new ApiError(code, message, null));
    }

    record Publication(String state, String username, String mediaId, String permalink, String caption, String imageDataUrl,
                       OffsetDateTime scheduledAt, OffsetDateTime publishedAt, String accountId) {}
    record Status(boolean available, String username, Publication publication, boolean automaticPostingDisabled) {}
    private record Snapshot(String value) {}
}
