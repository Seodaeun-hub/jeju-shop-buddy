package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.PromotionReviewController.Review;
import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.Principal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

@RestController
class PromotionDraftController {
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;
    private final StoreProductPhotos photos;

    PromotionDraftController(JdbcClient jdbc, ObjectMapper json, StrategyAgentClient agent, StoreProductPhotos photos) {
        this.jdbc = jdbc;
        this.json = json;
        this.agent = agent;
        this.photos = photos;
    }

    @GetMapping("/api/plans/{planId}/promotion-photo")
    ResponseEntity<?> photo(@PathVariable UUID planId, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null || plan.review() == null) return notFound();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new Photo(photos.find(plan.storeId(), plan.review().productName())));
    }

    @Transactional
    @PostMapping("/api/plans/{planId}/promotion-draft")
    public ResponseEntity<?> save(@PathVariable UUID planId, @RequestBody Input input, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        var review = plan.review();
        if (review == null || !review.equals(input.review())) return changed();
        if (review.maxDiscountQuantity() == 0) return bad("할인 가능한 수량이 1개 이상이어야 해요.");
        if (input.publishDate() == null || input.publishTime() == null || input.publishDate().getYear() < 1900
                || input.publishDate().isAfter(plan.end()) || input.publishTime().getSecond() != 0
                || input.publishTime().getNano() != 0) return bad("게시 날짜와 시간을 확인해 주세요. 게시일은 행사 종료일까지 선택할 수 있어요.");
        if (!StoreProductPhotos.valid(input.photoDataUrl())) return bad("사용할 음식 사진을 다시 선택해 주세요.");

        String product = review.productName();
        String photo = input.photoDataUrl() != null ? input.photoDataUrl()
                : input.useSavedPhoto() ? photos.find(plan.storeId(), product) : null;
        if (plan.draft() != null && input.publishDate().equals(plan.draft().publishDate())
                && input.publishTime().equals(plan.draft().publishTime()) && java.util.Objects.equals(photo, plan.draft().photoDataUrl())) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(plan.draft());
        }
        var opening = agent.promotionOpening(product);
        String feature = won(review.discountWon()) + " 할인 · " + review.maxDiscountQuantity() + "개 한정";
        String detail = plan.start() + " ~ " + plan.end();
        String caption = opening.orElse("매장에서 준비한 메뉴 할인 소식을 전해요.") + "\n\n" + plan.storeName() + " · " + product
                + "\n" + won(review.priceWon()) + " → " + won(review.discountedPriceWon())
                + "\n" + feature + "\n행사 기간 " + detail;
        var draft = new Draft(plan.storeName(), product, feature, won(review.discountedPriceWon()), detail, caption,
                input.publishDate(), input.publishTime(), "Asia/Seoul", opening.isPresent() ? "GPT" : "TEMPLATE", photo, 1);
        int updated = jdbc.sql("""
                UPDATE execution_plans SET promotion_draft=CAST(:draft AS jsonb)
                WHERE id=:id AND promotion_review=CAST(:review AS jsonb)
                """).param("id", planId).param("draft", json.writeValueAsString(draft))
                .param("review", json.writeValueAsString(review)).update();
        if (updated == 0) return changed();
        if (input.photoDataUrl() != null) photos.save(plan.storeId(), product, photo);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(draft);
    }

    private Saved find(UUID id, String email) {
        return jdbc.sql("""
                SELECT s.id AS store_id, s.name, p.start_date, p.end_date, p.promotion_review, p.promotion_draft
                FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                WHERE p.id=:id AND p.strategy_code='PROMOTION' AND o.email=:email
                """).param("id", id).param("email", email)
                .query((rs, row) -> new Saved(rs.getObject("store_id", UUID.class), rs.getString("name"),
                        rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                        rs.getString("promotion_review") == null ? null : json.readValue(rs.getString("promotion_review"), Review.class),
                        rs.getString("promotion_draft") == null ? null : json.readValue(rs.getString("promotion_draft"), Draft.class)))
                .optional().orElse(null);
    }

    private static String won(long amount) { return String.format(Locale.KOREA, "%,d원", amount); }
    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("PROMOTION_PLAN_NOT_FOUND", "프로모션 검토를 찾을 수 없어요.", null));
    }
    private static ResponseEntity<ApiError> changed() {
        return ResponseEntity.status(409).body(new ApiError("PROMOTION_REVIEW_CHANGED", "저장된 할인 조건이 바뀌었어요. 다시 열어 확인해 주세요.", null));
    }
    private static ResponseEntity<ApiError> bad(String message) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_PROMOTION_DRAFT", message, null));
    }
    private record Saved(UUID storeId, String storeName, LocalDate start, LocalDate end, Review review, Draft draft) {}
    record Photo(String photoDataUrl) {}
    record Input(Review review, LocalDate publishDate, LocalTime publishTime, String photoDataUrl, boolean useSavedPhoto) {}
    record Draft(String storeName, String headline, String feature, String discountedPrice, String detail, String caption,
                 LocalDate publishDate, LocalTime publishTime, String timeZone, String copySource, String photoDataUrl, int templateVersion) {}
}
