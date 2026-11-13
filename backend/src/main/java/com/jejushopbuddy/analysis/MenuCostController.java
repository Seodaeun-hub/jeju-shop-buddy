package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.Principal;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/stores/{storeId}/menu-costs")
class MenuCostController {
    private static final Pattern AMOUNT = Pattern.compile("[0-9]{1,10}(\\.[0-9]{1,3})?");
    private static final BigDecimal MAX_AMOUNT = BigDecimal.valueOf(1_000_000_000);
    private static final long MAX_WON = 9_007_199_254_740_991L;
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;

    MenuCostController(JdbcClient jdbc, ObjectMapper json, StrategyAgentClient agent) {
        this.jdbc = jdbc;
        this.json = json;
        this.agent = agent;
    }

    @PostMapping("/receipt")
    ResponseEntity<?> receipt(@PathVariable UUID storeId, @RequestBody ReceiptInput input, Principal owner) {
        if (!owns(storeId, owner)) return notFound();
        if (input == null || !validReceiptImage(input.imageDataUrl())) {
            return invalid("3MB 이하의 JPG 또는 PNG 영수증 사진을 선택해 주세요.");
        }
        var draft = agent.receipt(input).filter(value -> value.lines() != null)
                .map(value -> new ReceiptDraft(value.lines().stream()
                        .filter(line -> line != null && validText(line.name(), 100)).limit(30).toList()));
        if (draft.isEmpty()) {
            return ResponseEntity.status(503).body(new ApiError("RECEIPT_UNAVAILABLE",
                    "영수증 사진을 읽지 못했어요. 다시 시도하거나 단가를 직접 입력해 주세요.", null));
        }
        return ok(draft.get());
    }

    private static boolean validReceiptImage(String image) {
        if (image == null || image.length() > 4_200_000) return false;
        boolean jpeg = image.startsWith("data:image/jpeg;base64,");
        if (!jpeg && !image.startsWith("data:image/png;base64,")) return false;
        try {
            byte[] bytes = Base64.getDecoder().decode(image.substring(image.indexOf(',') + 1));
            if (bytes.length == 0 || bytes.length > 3 * 1024 * 1024) return false;
            try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                if (stream == null) return false;
                var readers = ImageIO.getImageReaders(stream);
                if (!readers.hasNext()) return false;
                var reader = readers.next();
                try {
                    if (!reader.getFormatName().equalsIgnoreCase(jpeg ? "JPEG" : "PNG")) return false;
                    reader.setInput(stream);
                    return reader.getWidth(0) > 0 && reader.getHeight(0) > 0
                            && (long) reader.getWidth(0) * reader.getHeight(0) <= 16_000_000;
                } finally {
                    reader.dispose();
                }
            }
        } catch (IOException | IllegalArgumentException failure) {
            return false;
        }
    }

    @GetMapping
    ResponseEntity<?> get(@PathVariable UUID storeId, @RequestParam(required = false) String productName, Principal owner) {
        if (!owns(storeId, owner)) return notFound();
        if (productName == null) {
            var menu = jdbc.sql("""
                    SELECT i.product_name FROM analysis_product_sales i
                    JOIN sales_analyses a ON a.id = i.analysis_id WHERE a.store_id = :store
                    UNION SELECT product_name FROM store_product_photos WHERE store_id = :store
                    UNION SELECT product_name FROM store_inventory_recipes WHERE store_id = :store
                    UNION SELECT product_name FROM store_menu_costs WHERE store_id = :store
                    ORDER BY product_name
                    """).param("store", storeId).query(String.class).list();
            return ok(menu);
        }
        if (!validText(productName, 255)) return invalid("메뉴명을 확인해 주세요.");
        String product = productName.strip();
        var price = jdbc.sql("""
                SELECT i.price_won FROM analysis_product_sales i
                JOIN sales_analyses a ON a.id = i.analysis_id
                WHERE a.store_id = :store AND i.product_name = :product AND i.price_won IS NOT NULL
                ORDER BY a.after_month DESC, a.created_at DESC, a.id DESC LIMIT 1
                """).param("store", storeId).param("product", product).query(Long.class).optional().orElse(null);
        var saved = jdbc.sql("""
                SELECT ingredients, cost_won FROM store_menu_costs WHERE store_id = :store AND product_name = :product
                """).param("store", storeId).param("product", product).query((rs, row) ->
                new Cost(product, List.of(json.readValue(rs.getString("ingredients"), Ingredient[].class)),
                        rs.getLong("cost_won"), price)).optional();
        if (saved.isPresent()) return ok(saved.get());
        var ingredients = jdbc.sql("""
                SELECT ingredient_name, unit, amount FROM store_inventory_recipes
                WHERE store_id = :store AND product_name = :product ORDER BY ingredient_name, unit
                """).param("store", storeId).param("product", product)
                .query((rs, row) -> new Ingredient(rs.getString("ingredient_name"), rs.getString("unit"),
                        rs.getBigDecimal("amount").stripTrailingZeros().toPlainString(), null)).list();
        return ok(new Cost(product, ingredients, null, price));
    }

    @PutMapping
    ResponseEntity<?> save(@PathVariable UUID storeId, @RequestParam String productName,
                           @RequestBody List<Ingredient> ingredients, Principal owner) {
        if (!owns(storeId, owner)) return notFound();
        if (!validText(productName, 255)) return invalid("메뉴명을 확인해 주세요.");
        String product = productName.strip();
        Cost cost;
        try {
            cost = calculate(product, ingredients);
        } catch (IllegalArgumentException failure) {
            return invalid(failure.getMessage());
        }
        jdbc.sql("""
                INSERT INTO store_menu_costs (store_id, product_name, ingredients, cost_won)
                VALUES (:store, :product, CAST(:ingredients AS jsonb), :cost)
                ON CONFLICT (store_id, product_name)
                DO UPDATE SET ingredients = EXCLUDED.ingredients, cost_won = EXCLUDED.cost_won
                """).param("store", storeId).param("product", product)
                .param("ingredients", json.writeValueAsString(cost.ingredients())).param("cost", cost.costWon()).update();
        return ok(cost);
    }

    static Cost calculate(String product, List<Ingredient> ingredients) {
        if (ingredients == null || ingredients.isEmpty() || ingredients.size() > 100) {
            throw new IllegalArgumentException("재료를 1개 이상, 최대 100개까지 입력해 주세요.");
        }
        var seen = new HashSet<IngredientKey>();
        var normalized = ingredients.stream().map(ingredient -> {
            if (ingredient == null || !validText(ingredient.ingredientName(), 50) || !validText(ingredient.unit(), 12)
                    || ingredient.amount() == null || !AMOUNT.matcher(ingredient.amount()).matches()
                    || ingredient.unitPriceWon() == null || ingredient.unitPriceWon() < 0 || ingredient.unitPriceWon() > MAX_WON) {
                throw new IllegalArgumentException("재료명, 단위, 사용량, 단가를 확인해 주세요.");
            }
            var amount = new BigDecimal(ingredient.amount());
            if (amount.signum() <= 0 || amount.compareTo(MAX_AMOUNT) > 0) {
                throw new IllegalArgumentException("사용량은 0보다 크고 10억 이하로 입력해 주세요.");
            }
            String name = ingredient.ingredientName().strip();
            String unit = ingredient.unit().strip();
            if (!seen.add(new IngredientKey(name, unit))) {
                throw new IllegalArgumentException("같은 이름과 단위의 재료가 두 번 들어갔어요.");
            }
            return new Ingredient(name, unit, amount.stripTrailingZeros().toPlainString(), ingredient.unitPriceWon());
        }).toList();
        var total = normalized.stream()
                .map(row -> new BigDecimal(row.amount()).multiply(BigDecimal.valueOf(row.unitPriceWon())))
                .reduce(BigDecimal.ZERO, BigDecimal::add).setScale(0, RoundingMode.HALF_UP);
        if (total.compareTo(BigDecimal.valueOf(MAX_WON)) > 0) {
            throw new IllegalArgumentException("합산 원가가 저장 가능한 금액을 넘었어요.");
        }
        return new Cost(product, normalized, total.longValueExact(), null);
    }

    private boolean owns(UUID store, Principal owner) {
        return jdbc.sql("""
                SELECT s.id FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE s.id = :store AND o.email = :email
                """).param("store", store).param("email", owner.getName()).query(UUID.class).optional().isPresent();
    }

    private static boolean validText(String value, int maxLength) {
        return value != null && !value.isBlank() && value.strip().length() <= maxLength && value.indexOf(0) < 0;
    }

    private static <T> ResponseEntity<T> ok(T body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }

    private static ResponseEntity<ApiError> invalid(String message) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_MENU_COST", message, null));
    }

    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("STORE_NOT_FOUND", "매장을 찾을 수 없어요.", null));
    }

    private record IngredientKey(String name, String unit) {}
    record Ingredient(String ingredientName, String unit, String amount, Long unitPriceWon) {}
    record Cost(String productName, List<Ingredient> ingredients, Long costWon, Long priceWon) {}
    record ReceiptInput(String imageDataUrl) {}
    record ReceiptLine(String name, String unit, String quantity, Long totalWon) {}
    record ReceiptDraft(List<ReceiptLine> lines) {}
}
