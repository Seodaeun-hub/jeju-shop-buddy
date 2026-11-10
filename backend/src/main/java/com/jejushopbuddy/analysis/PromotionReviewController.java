package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.Principal;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
class PromotionReviewController {
    private static final long MAX_WON = 9_007_199_254_740_991L;
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    PromotionReviewController(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @PutMapping("/api/plans/{planId}/promotion-review")
    ResponseEntity<?> save(@PathVariable UUID planId, @RequestBody JsonNode input, Principal owner) {
        var name = input.path("productName");
        String productName = name.isString() ? name.stringValue().strip() : "";
        if (productName.isEmpty() || productName.length() > 255 || productName.indexOf(0) >= 0) {
            return invalid("검토할 품목명을 입력해 주세요.", "productName");
        }
        long price = won(input.path("priceWon"));
        long cost = won(input.path("costWon"));
        long discount = won(input.path("discountWon"));
        long budget = won(input.path("budgetWon"));
        if (price <= 0) return invalid("판매가는 1원 이상의 정수로 입력해 주세요.", "priceWon");
        if (cost < 0) return invalid("원가는 0원 이상의 정수로 입력해 주세요.", "costWon");
        if (discount <= 0 || discount > price) {
            return invalid("개당 할인액은 1원 이상, 판매가 이하로 입력해 주세요.", "discountWon");
        }
        if (budget < 0) return invalid("할인 예산은 0원 이상의 정수로 입력해 주세요.", "budgetWon");

        long discountedPrice = price - discount;
        var review = new Review(productName, price, cost, discount, budget, discountedPrice,
                discountedPrice - cost, budget / discount);
        int updated = jdbc.sql("""
                UPDATE execution_plans p SET promotion_review = CAST(:review AS jsonb),
                    promotion_draft = CASE WHEN p.promotion_review = CAST(:review AS jsonb)
                                          THEN p.promotion_draft ELSE NULL END
                FROM sales_analyses a, stores s, owners o
                WHERE p.id = :planId AND p.strategy_code = 'PROMOTION' AND p.instagram_publication IS NULL
                  AND p.analysis_id = a.id AND a.store_id = s.id AND s.owner_id = o.id AND o.email = :email
                """)
                .param("review", json.writeValueAsString(review))
                .param("planId", planId)
                .param("email", owner.getName())
                .update();
        if (updated == 0) {
            boolean locked = jdbc.sql("""
                    SELECT EXISTS (
                        SELECT 1 FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                        JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                        WHERE p.id=:id AND p.strategy_code='PROMOTION' AND p.instagram_publication IS NOT NULL AND o.email=:email
                    )
                    """).param("id", planId).param("email", owner.getName()).query(Boolean.class).single();
            if (locked) return InstagramPublicationController.locked();
            return ResponseEntity.status(404)
                    .body(new ApiError("PROMOTION_PLAN_NOT_FOUND", "프로모션 계획을 찾을 수 없어요.", null));
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(review);
    }

    private static long won(JsonNode value) {
        if (!value.isIntegralNumber() || !value.canConvertToLong()) return -1;
        long amount = value.longValue();
        return amount >= 0 && amount <= MAX_WON ? amount : -1;
    }

    private static ResponseEntity<ApiError> invalid(String message, String field) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_PROMOTION_REVIEW", message, field));
    }

    record Review(String productName, long priceWon, long costWon, long discountWon, long budgetWon,
                  long discountedPriceWon, long marginPerItemWon, long maxDiscountQuantity) {}
}
