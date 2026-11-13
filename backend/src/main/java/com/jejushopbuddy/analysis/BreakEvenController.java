package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.Principal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/stores/{storeId}/break-even")
class BreakEvenController {
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final Settings DEFAULT = new Settings(0L, 0L, 0L, 26, BigDecimal.ZERO, null);
    private final JdbcClient jdbc;

    BreakEvenController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    ResponseEntity<?> get(@PathVariable UUID storeId, Principal owner) {
        if (!owns(storeId, owner)) return notFound();
        var saved = jdbc.sql("""
                SELECT rent_won, payroll_won, other_won, operating_days, extra_variable_percent, ingredient_percent_override
                FROM store_break_even_settings WHERE store_id = :store
                """).param("store", storeId).query((rs, row) -> new Settings(rs.getLong("rent_won"),
                rs.getLong("payroll_won"), rs.getLong("other_won"), rs.getInt("operating_days"),
                rs.getBigDecimal("extra_variable_percent"), rs.getBigDecimal("ingredient_percent_override"))).optional();
        return ok(new Review(saved.orElse(DEFAULT), saved.isPresent(), evidence(storeId)));
    }

    @PutMapping
    ResponseEntity<?> put(@PathVariable UUID storeId, @RequestBody Settings settings, Principal owner) {
        if (!owns(storeId, owner)) return notFound();
        if (settings == null || !validWon(settings.rentWon()) || !validWon(settings.payrollWon())
                || !validWon(settings.otherWon()) || settings.operatingDays() == null || settings.operatingDays() < 1
                || settings.operatingDays() > 31 || !validPercent(settings.extraVariablePercent())
                || settings.ingredientPercentOverride() != null && !validPercent(settings.ingredientPercentOverride())) {
            return ResponseEntity.badRequest().body(new ApiError("INVALID_BREAK_EVEN", "고정비·영업일·추가 변동비율을 확인해 주세요.", null));
        }
        jdbc.sql("""
                INSERT INTO store_break_even_settings (store_id, rent_won, payroll_won, other_won, operating_days,
                    extra_variable_percent, ingredient_percent_override)
                VALUES (:store, :rent, :payroll, :other, :days, :extra, :ingredient)
                ON CONFLICT (store_id) DO UPDATE SET rent_won = EXCLUDED.rent_won, payroll_won = EXCLUDED.payroll_won,
                    other_won = EXCLUDED.other_won, operating_days = EXCLUDED.operating_days,
                    extra_variable_percent = EXCLUDED.extra_variable_percent,
                    ingredient_percent_override = EXCLUDED.ingredient_percent_override
                """).param("store", storeId).param("rent", settings.rentWon()).param("payroll", settings.payrollWon())
                .param("other", settings.otherWon()).param("days", settings.operatingDays())
                .param("extra", settings.extraVariablePercent()).param("ingredient", settings.ingredientPercentOverride()).update();
        return ok(new Review(settings, true, evidence(storeId)));
    }

    private Evidence evidence(UUID store) {
        return jdbc.sql("""
                WITH latest AS (
                    SELECT id, after_month FROM sales_analyses WHERE store_id = :store
                    ORDER BY after_month DESC, created_at DESC, id DESC LIMIT 1
                )
                SELECT a.after_month, m.amount,
                       COALESCE(SUM(p.after_revenue) FILTER (WHERE c.cost_won IS NOT NULL), 0) AS covered,
                       COALESCE(SUM(p.after_quantity::numeric * c.cost_won)
                           FILTER (WHERE p.after_revenue IS NOT NULL), 0) AS cost,
                       COUNT(*) FILTER (WHERE p.after_quantity > 0 AND (p.after_revenue IS NULL OR c.cost_won IS NULL)) AS missing
                FROM latest a JOIN analysis_monthly_sales m ON m.analysis_id = a.id AND m.sales_month = a.after_month
                LEFT JOIN analysis_product_sales p ON p.analysis_id = a.id
                LEFT JOIN store_menu_costs c ON c.store_id = :store AND c.product_name = p.product_name
                GROUP BY a.after_month, m.amount
                """).param("store", store).query((rs, row) -> {
            long sales = rs.getLong("amount");
            var covered = rs.getBigDecimal("covered");
            var cost = rs.getBigDecimal("cost");
            var ratio = sales > 0 && rs.getLong("missing") == 0 && covered.compareTo(BigDecimal.valueOf(sales)) == 0
                    ? cost.multiply(HUNDRED).divide(BigDecimal.valueOf(sales), 6, RoundingMode.HALF_UP) : null;
            return new Evidence(YearMonth.from(rs.getObject("after_month", LocalDate.class)).toString(),
                    sales, covered, rs.getLong("missing"), ratio);
        }).optional().orElse(null);
    }

    private boolean owns(UUID store, Principal owner) {
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE s.id = :store AND o.email = :email)
                """).param("store", store).param("email", owner.getName()).query(Boolean.class).single();
    }

    private static boolean validWon(Long amount) {
        return amount != null && amount >= 0 && amount <= 1_000_000_000_000L;
    }

    private static boolean validPercent(BigDecimal percent) {
        return percent != null && percent.signum() >= 0 && percent.compareTo(HUNDRED) < 0
                && percent.stripTrailingZeros().scale() <= 2;
    }

    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("STORE_NOT_FOUND", "매장을 찾을 수 없어요.", null));
    }

    private static ResponseEntity<Review> ok(Review review) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(review);
    }

    record Settings(Long rentWon, Long payrollWon, Long otherWon, Integer operatingDays,
                    BigDecimal extraVariablePercent, BigDecimal ingredientPercentOverride) {}
    record Evidence(String month, long salesWon, BigDecimal coveredRevenueWon, long missingProducts, BigDecimal ingredientPercent) {}
    record Review(Settings settings, boolean saved, Evidence evidence) {}
}
