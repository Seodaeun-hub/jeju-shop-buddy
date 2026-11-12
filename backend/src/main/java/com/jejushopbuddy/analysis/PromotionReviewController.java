package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
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

    @GetMapping("/api/plans/{planId}/promotion-review/defaults")
    ResponseEntity<?> defaults(@PathVariable UUID planId, Principal owner) {
        var storeId = jdbc.sql("""
                SELECT a.store_id FROM execution_plans p JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id JOIN owners o ON o.id = s.owner_id
                WHERE p.id = :id AND p.strategy_code = 'PROMOTION' AND o.email = :email
                """).param("id", planId).param("email", owner.getName()).query(UUID.class).optional();
        if (storeId.isEmpty()) return ResponseEntity.notFound().build();
        var history = jdbc.sql("""
                SELECT product_name, cost_won, budget_won
                FROM (
                    SELECT DISTINCT ON (p.promotion_review ->> 'productName')
                        p.promotion_review ->> 'productName' AS product_name,
                        (p.promotion_review ->> 'costWon')::bigint AS cost_won,
                        (p.promotion_review ->> 'budgetWon')::bigint AS budget_won,
                        COALESCE(p.promotion_review_saved_at, p.created_at) AS saved_at, p.id
                    FROM execution_plans p JOIN sales_analyses a ON a.id = p.analysis_id
                    WHERE a.store_id = :storeId AND p.id <> :id AND p.promotion_review IS NOT NULL
                    ORDER BY p.promotion_review ->> 'productName', saved_at DESC, p.id DESC
                ) latest ORDER BY saved_at DESC, id DESC
                """).param("storeId", storeId.get()).param("id", planId)
                .query((rs, row) -> new DefaultsRow(rs.getString("product_name"),
                        rs.getLong("cost_won"), rs.getLong("budget_won"))).list();
        Long budget = history.isEmpty() ? null : history.getFirst().budgetWon();
        var costs = history.stream().map(row -> new ProductCost(row.productName(), row.costWon())).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Defaults(budget, costs));
    }

    private record DefaultsRow(String productName, long costWon, long budgetWon) {}
    record ProductCost(String productName, long costWon) {}
    record Defaults(Long budgetWon, List<ProductCost> costs) {}

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
                    promotion_review_saved_at = clock_timestamp(),
                    promotion_draft = CASE WHEN p.promotion_review = CAST(:review AS jsonb)
                                          THEN p.promotion_draft ELSE NULL END
                FROM sales_analyses a, stores s, owners o
                WHERE p.id = :planId AND p.strategy_code = 'PROMOTION' AND p.instagram_publication IS NULL
                  AND p.manual_promotion_publication IS NULL
                  AND p.analysis_id = a.id AND a.store_id = s.id AND s.owner_id = o.id AND o.email = :email
                """)
                .param("review", json.writeValueAsString(review))
                .param("planId", planId)
                .param("email", owner.getName())
                .update();
        if (updated == 0) {
            var lock = jdbc.sql("""
                    SELECT CASE WHEN p.instagram_publication IS NOT NULL THEN 'INSTAGRAM'
                                WHEN p.manual_promotion_publication IS NOT NULL THEN 'MANUAL'
                                ELSE '' END AS publication_lock
                    FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                    JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                    WHERE p.id=:id AND p.strategy_code='PROMOTION' AND o.email=:email
                    """).param("id", planId).param("email", owner.getName()).query(String.class).optional().orElse("");
            if ("INSTAGRAM".equals(lock)) return InstagramPublicationController.locked();
            if ("MANUAL".equals(lock)) return ResponseEntity.status(409)
                    .body(new ApiError("PROMOTION_REVIEW_LOCKED", "게시 기록이 있는 행사의 할인 조건은 새 계획에서 바꿔 주세요.", null));
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
