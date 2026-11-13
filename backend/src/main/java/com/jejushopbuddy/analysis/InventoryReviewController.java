package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.math.BigDecimal;
import java.security.Principal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
class InventoryReviewController {
    private static final int MAX_ITEMS = 500;
    private static final BigDecimal MAX_QUANTITY = BigDecimal.valueOf(1_000_000_000);
    private static final Pattern QUANTITY = Pattern.compile("[0-9]+(\\.[0-9]{1,3})?");
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final KmaForecast weather;
    private final InventoryDemand demand;

    InventoryReviewController(JdbcClient jdbc, ObjectMapper json, KmaForecast weather, InventoryDemand demand) {
        this.jdbc = jdbc;
        this.json = json;
        this.weather = weather;
        this.demand = demand;
    }

    @GetMapping("/api/plans/{planId}/inventory-review/forecast")
    ResponseEntity<?> forecast(@PathVariable UUID planId, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                               LocalDate date, @RequestParam(required = false) String productName, Principal owner) {
        if (date.getYear() < 1900 || date.getYear() > 9999) return invalid("조회할 날짜를 확인해 주세요.");
        if (productName != null && !validText(productName, 255)) return invalid("확인할 POS 메뉴명을 입력해 주세요.");
        var location = findStore(planId, owner);
        if (location == null) return notFound();
        var point = productName == null ? null : weather.location(location.address(), location.name()).orElse(null);
        var forecast = productName == null ? weather.lookup(location.address(), location.name(), date)
                : point == null ? null : weather.lookup(point, date);
        var estimate = productName == null ? null : demand.estimate(location.id(), point, productName.strip(), date, forecast);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new WeatherReference(date, location.area(), forecast, forecast == null ? null : KmaForecast.SOURCE_URL, estimate));
    }

    @GetMapping("/api/plans/{planId}/inventory-review/recipes")
    ResponseEntity<?> recipes(@PathVariable UUID planId, @RequestParam String productName, Principal owner) {
        if (!validText(productName, 255)) return invalid("메뉴명을 확인해 주세요.");
        var store = findStore(planId, owner);
        if (store == null) return notFound();
        var recipes = jdbc.sql("""
                SELECT ingredient_name, unit, amount FROM store_inventory_recipes
                WHERE store_id = :store AND product_name = :product ORDER BY ingredient_name, unit
                """).param("store", store.id()).param("product", productName.strip())
                .query((rs, row) -> new Recipe(rs.getString("ingredient_name"), rs.getString("unit"),
                        rs.getBigDecimal("amount").stripTrailingZeros().toPlainString()))
                .list();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(recipes);
    }

    @PutMapping("/api/plans/{planId}/inventory-review/recipes")
    ResponseEntity<?> saveRecipe(@PathVariable UUID planId, @RequestParam String productName, @RequestBody Recipe input, Principal owner) {
        if (!validText(productName, 255) || input == null || !validText(input.ingredientName(), 50) || !validText(input.unit(), 12)) {
            return invalid("메뉴명, 재료명과 단위를 확인해 주세요.");
        }
        BigDecimal amount;
        try {
            amount = quantity(input.amount());
            if (amount == null || amount.signum() <= 0) throw new IllegalArgumentException();
        } catch (IllegalArgumentException error) {
            return invalid("한 개당 사용량을 0보다 큰 수로 소수점 셋째 자리까지 입력해 주세요.");
        }
        var store = findStore(planId, owner);
        if (store == null) return notFound();
        var saved = new Recipe(input.ingredientName().strip(), input.unit().strip(), amount.stripTrailingZeros().toPlainString());
        jdbc.sql("""
                INSERT INTO store_inventory_recipes (store_id, product_name, ingredient_name, unit, amount)
                VALUES (:store, :product, :ingredient, :unit, :amount)
                ON CONFLICT (store_id, product_name, ingredient_name, unit) DO UPDATE SET amount = EXCLUDED.amount
                """).param("store", store.id()).param("product", productName.strip()).param("ingredient", saved.ingredientName())
                .param("unit", saved.unit()).param("amount", amount).update();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(saved);
    }

    @PutMapping("/api/plans/{planId}/inventory-review")
    ResponseEntity<?> save(@PathVariable UUID planId, @RequestBody List<Input> input, Principal owner) {
        if (input == null || input.size() > MAX_ITEMS) return invalid("발주 검토표는 최대 500품목까지 저장할 수 있어요.");
        var ids = new HashSet<UUID>();
        var items = new ArrayList<Item>();
        for (var row : input) {
            if (row == null || row.id() == null || !ids.add(row.id())
                    || !validText(row.name(), 50) || !validText(row.unit(), 12)) {
                return invalid("품목명과 단위를 확인해 주세요.");
            }
            try {
                var stock = quantity(row.stock());
                var expectedUse = quantity(row.expectedUse());
                var incoming = quantity(row.incoming());
                quantity(row.finalOrder());
                var shortage = stock == null || expectedUse == null || incoming == null
                        ? null : expectedUse.subtract(stock).subtract(incoming).max(BigDecimal.ZERO);
                items.add(new Item(row.id(), row.name().strip(), row.unit().strip(), row.stock(), row.expectedUse(),
                        row.incoming(), row.finalOrder(), shortage));
            } catch (IllegalArgumentException error) {
                return invalid("수량은 0 이상 10억 이하로 소수점 셋째 자리까지 입력해 주세요.");
            }
        }
        int updated = jdbc.sql("""
                UPDATE execution_plans p SET inventory_review = CAST(:review AS jsonb)
                FROM sales_analyses a, stores s, owners o
                WHERE p.id = :planId AND p.strategy_code = 'INVENTORY'
                  AND p.analysis_id = a.id AND a.store_id = s.id AND s.owner_id = o.id AND o.email = :email
                """)
                .param("review", json.writeValueAsString(items))
                .param("planId", planId)
                .param("email", owner.getName())
                .update();
        if (updated == 0) return notFound();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(items);
    }

    private static boolean validText(String value, int maxLength) {
        return value != null && !value.isBlank() && value.length() <= maxLength && value.indexOf(0) < 0;
    }

    private static BigDecimal quantity(String value) {
        if (value == null || value.isEmpty()) return null;
        if (!QUANTITY.matcher(value).matches()) throw new IllegalArgumentException();
        var quantity = new BigDecimal(value);
        if (quantity.compareTo(MAX_QUANTITY) > 0) throw new IllegalArgumentException();
        return quantity;
    }

    private static ResponseEntity<ApiError> invalid(String message) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_INVENTORY_REVIEW", message, null));
    }

    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("INVENTORY_PLAN_NOT_FOUND", "발주 검토 계획을 찾을 수 없어요.", null));
    }

    private ForecastStore findStore(UUID planId, Principal owner) {
        return jdbc.sql("""
                SELECT s.id, s.name, s.address, area.name AS area_name
                FROM execution_plans p JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id JOIN owners o ON o.id = s.owner_id
                JOIN jeju_areas area ON area.code = s.area_code
                WHERE p.id = :id AND p.strategy_code = 'INVENTORY' AND o.email = :email
                """).param("id", planId).param("email", owner.getName())
                .query((rs, row) -> new ForecastStore(rs.getObject("id", UUID.class),
                        rs.getString("name"), rs.getString("address"), rs.getString("area_name")))
                .optional().orElse(null);
    }

    private record ForecastStore(UUID id, String name, String address, String area) {}
    record Recipe(String ingredientName, String unit, String amount) {}
    record WeatherReference(LocalDate date, String area, KmaForecast.Daily forecast, String sourceUrl, InventoryDemand.Estimate estimate) {}
    record Input(UUID id, String name, String unit, String stock, String expectedUse, String incoming, String finalOrder) {}
    record Item(UUID id, String name, String unit, String stock, String expectedUse, String incoming, String finalOrder,
                BigDecimal shortage) {
        Item {
            stock = stock == null ? "" : stock;
            expectedUse = expectedUse == null ? "" : expectedUse;
            incoming = incoming == null ? "" : incoming;
            finalOrder = finalOrder == null ? "" : finalOrder;
        }
    }
}
