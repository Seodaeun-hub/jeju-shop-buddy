package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.Principal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/plans/{planId}/promotion-impact")
class PromotionImpactController {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    PromotionImpactController(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @GetMapping
    ResponseEntity<?> get(@PathVariable UUID planId, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(comparison(plan));
    }

    @PutMapping
    ResponseEntity<?> save(@PathVariable UUID planId, @RequestBody Upload upload, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        var result = comparison(plan);
        if (result.before() == null || upload.phase() == null) return invalid("게시 완료된 프로모션의 비교 기간을 확인해 주세요.");
        var period = upload.phase() == Phase.BEFORE ? result.before() : result.after();
        if (!period.start().equals(upload.start()) || !period.end().equals(upload.end())
                || !period.end().isBefore(LocalDate.now(SEOUL))) {
            return invalid("화면에 표시된 기간이 끝난 뒤 해당 기간의 POS를 올려 주세요.");
        }
        if (!validTotal(upload.quantity()) || !validTotal(upload.amount())
                || upload.recordedDays() == null || upload.recordedDays() < 1
                || upload.recordedDays() > ChronoUnit.DAYS.between(period.start(), period.end()) + 1) {
            return invalid("상품 주문 시트의 판매량, 실판매금액과 기록된 날짜를 확인해 주세요.");
        }
        var totals = new Totals(upload.quantity(), upload.amount(), upload.recordedDays());
        var saved = jdbc.sql("""
                UPDATE execution_plans p
                SET promotion_impact = COALESCE(p.promotion_impact, '{}'::jsonb)
                                     || jsonb_build_object(CAST(:phase AS text), CAST(:totals AS jsonb))
                FROM sales_analyses a, stores s, owners o
                WHERE p.id=:id AND p.strategy_code='PROMOTION' AND p.analysis_id=a.id
                  AND a.store_id=s.id AND s.owner_id=o.id AND o.email=:email
                  AND p.instagram_publication->>'state'='PUBLISHED'
                  AND p.instagram_publication->>'publishedAt'=:published
                  AND p.promotion_review->>'productName'=:product
                RETURNING p.promotion_impact
                """).param("phase", upload.phase() == Phase.BEFORE ? "before" : "after")
                .param("totals", json.writeValueAsString(totals)).param("id", planId).param("email", owner.getName())
                .param("published", plan.publishedAt()).param("product", plan.product())
                .query(String.class).optional();
        if (saved.isEmpty()) return ResponseEntity.status(409)
                .body(new ApiError("PROMOTION_IMPACT_CHANGED", "게시 상태가 바뀌었어요. 새로고침해 주세요.", null));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(comparison(
                new Plan(plan.product(), plan.start(), plan.end(), plan.state(), plan.publishedAt(), saved.get())));
    }

    private Plan find(UUID id, String email) {
        return jdbc.sql("""
                SELECT p.promotion_review->>'productName' AS product, p.start_date, p.end_date,
                       p.instagram_publication->>'state' AS state, p.instagram_publication->>'publishedAt' AS published,
                       p.promotion_impact
                FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                WHERE p.id=:id AND p.strategy_code='PROMOTION' AND o.email=:email
                """).param("id", id).param("email", email)
                .query((rs, row) -> new Plan(rs.getString("product"), rs.getObject("start_date", LocalDate.class),
                        rs.getObject("end_date", LocalDate.class), rs.getString("state"), rs.getString("published"),
                        rs.getString("promotion_impact"))).optional().orElse(null);
    }

    private Comparison comparison(Plan plan) {
        if (plan.product() == null || !"PUBLISHED".equals(plan.state())) {
            return unavailable(plan, "인스타그램 게시가 완료되면 홍보 품목의 POS를 비교할 수 있어요.");
        }
        if (plan.publishedAt() == null) {
            return unavailable(plan, "게시 시각이 저장된 홍보물에서 전후 기간을 계산할 수 있어요.");
        }
        var firstFullDay = OffsetDateTime.parse(plan.publishedAt()).atZoneSameInstant(SEOUL).toLocalDate().plusDays(1);
        var afterStart = firstFullDay.isAfter(plan.start()) ? firstFullDay : plan.start();
        if (afterStart.isAfter(plan.end())) {
            return unavailable(plan, "게시 다음 날부터 행사 종료일까지 비교할 날짜가 없어요.");
        }
        long shift = (ChronoUnit.DAYS.between(plan.start(), plan.end()) / 7 + 1) * 7;
        var snapshot = plan.snapshot() == null ? new Snapshot(null, null) : json.readValue(plan.snapshot(), Snapshot.class);
        return new Comparison(plan.product(), new Period(afterStart.minusDays(shift), plan.end().minusDays(shift)),
                new Period(afterStart, plan.end()), snapshot.before(), snapshot.after(),
                plan.end().isBefore(LocalDate.now(SEOUL)), null);
    }

    private static Comparison unavailable(Plan plan, String message) {
        return new Comparison(plan.product(), null, null, null, null, false, message);
    }

    private static boolean validTotal(Long value) {
        return value != null && value >= 0 && value <= MAX_SAFE_INTEGER;
    }

    private static ResponseEntity<ApiError> invalid(String message) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_PROMOTION_IMPACT", message, null));
    }

    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("PROMOTION_PLAN_NOT_FOUND", "프로모션 계획을 찾을 수 없어요.", null));
    }

    enum Phase { BEFORE, AFTER }
    record Upload(Phase phase, LocalDate start, LocalDate end, Long quantity, Long amount, Integer recordedDays) {}
    record Totals(long quantity, long amount, int recordedDays) {}
    record Period(LocalDate start, LocalDate end) {}
    record Snapshot(Totals before, Totals after) {}
    record Comparison(String productName, Period before, Period after, Totals beforeTotals, Totals afterTotals,
                      boolean afterReady, String message) {}
    private record Plan(String product, LocalDate start, LocalDate end, String state, String publishedAt, String snapshot) {}
}
