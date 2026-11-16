package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

@RestController
class StoreQrMenuController {
    private static final String ADMIN = "/api/stores/{storeId}/qr-menu";
    private static final String PUBLIC = "/api/public/menus/{publicId}";
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;

    StoreQrMenuController(JdbcClient jdbc, ObjectMapper json, StrategyAgentClient agent) {
        this.jdbc = jdbc;
        this.json = json;
        this.agent = agent;
    }

    @GetMapping(ADMIN)
    ResponseEntity<?> get(@PathVariable UUID storeId, Principal owner) {
        String name = storeName(storeId, owner);
        if (name == null) return missingStore();
        var items = catalog(storeId);
        var saved = jdbc.sql("""
                SELECT public_id, publication FROM store_qr_menus WHERE store_id=:store AND publication IS NOT NULL
                """).param("store", storeId).query((rs, row) -> {
            var snapshot = json.readValue(rs.getString("publication"), Publication.class);
            return new Published(rs.getObject("public_id", UUID.class), snapshot.version(),
                    snapshot.items().stream().map(PublishedItem::translation).toList());
        }).optional().orElse(null);
        return ok(new Editor(name, version(name, items), items, saved));
    }

    @PostMapping(ADMIN + "/translations")
    ResponseEntity<?> draft(@PathVariable UUID storeId, @RequestBody DraftInput input, Principal owner) {
        String name = storeName(storeId, owner);
        if (name == null) return missingStore();
        var items = catalog(storeId);
        var version = version(name, items);
        if (!version.equals(input.version())) return changed();
        if (items.isEmpty() || items.size() > 60) {
            return error(400, "INVALID_MENU_COUNT", "AI 번역은 메뉴 1~60개에 사용할 수 있어요.");
        }
        var result = agent.translateMenu(new AgentInput(items.stream().map(Item::name).toList()))
                .filter(draft -> valid(draft.items(), items.size()));
        if (result.isEmpty()) {
            return error(503, "MENU_TRANSLATION_UNAVAILABLE", "번역 초안을 만들지 못했어요. 다시 시도하거나 직접 입력해 주세요.");
        }
        return ok(new Translated(sorted(result.get().items())));
    }

    @PutMapping(ADMIN)
    ResponseEntity<?> publish(@PathVariable UUID storeId, @RequestBody PublishInput input, Principal owner) {
        String name = storeName(storeId, owner);
        if (name == null) return missingStore();
        var items = catalog(storeId);
        var version = version(name, items);
        if (!version.equals(input.version())) return changed();
        if (!Boolean.TRUE.equals(input.confirmed()) || items.isEmpty() || !valid(input.translations(), items.size())) {
            return error(400, "UNCONFIRMED_QR_MENU", "세 언어의 메뉴 이름을 확인하고 공개에 동의해 주세요.");
        }
        var translations = sorted(input.translations());
        var rows = new ArrayList<PublishedItem>(items.size());
        for (int index = 0; index < items.size(); index++) rows.add(new PublishedItem(items.get(index), translations.get(index)));
        var publicId = jdbc.sql("""
                INSERT INTO store_qr_menus (store_id, public_id, publication)
                VALUES (:store, :id, CAST(:publication AS jsonb))
                ON CONFLICT (store_id) DO UPDATE SET publication=EXCLUDED.publication
                RETURNING public_id
                """).param("store", storeId).param("id", UUID.randomUUID())
                .param("publication", json.writeValueAsString(new Publication(name, version, rows))).query(UUID.class).single();
        return ok(new Published(publicId, version, translations));
    }

    @DeleteMapping(ADMIN)
    ResponseEntity<?> unpublish(@PathVariable UUID storeId, Principal owner) {
        if (storeName(storeId, owner) == null) return missingStore();
        jdbc.sql("UPDATE store_qr_menus SET publication=NULL WHERE store_id=:store")
                .param("store", storeId).update();
        return ResponseEntity.noContent().build();
    }

    @GetMapping(PUBLIC)
    ResponseEntity<?> menu(@PathVariable UUID publicId) {
        var publication = jdbc.sql("SELECT publication FROM store_qr_menus WHERE public_id=:id AND publication IS NOT NULL")
                .param("id", publicId).query(String.class).optional()
                .map(snapshot -> json.readValue(snapshot, Publication.class)).orElse(null);
        if (publication == null) return missingMenu();
        var products = publication.items().stream().map(entry -> new GuestItem(entry.item().name(), entry.item().priceWon(),
                entry.item().photoDataUrl() != null, entry.translation())).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Robots-Tag", "noindex, nofollow")
                .body(new GuestMenu(publication.storeName(), publication.version(), products));
    }

    @GetMapping(PUBLIC + "/photos/{index}")
    ResponseEntity<?> photo(@PathVariable UUID publicId, @PathVariable int index, @RequestParam String version) {
        if (index < 0) return missingMenu();
        String photo = jdbc.sql("""
                SELECT publication->'items'->CAST(:idx AS integer)->'item'->>'photoDataUrl'
                FROM store_qr_menus WHERE public_id=:id AND publication->>'version'=:version
                """).param("id", publicId).param("idx", index).param("version", version)
                .query((rs, row) -> rs.getString(1)).optional().orElse(null);
        if (photo == null) return missingMenu();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_JPEG)
                .body(Base64.getDecoder().decode(photo.substring(photo.indexOf(',') + 1)));
    }

    private String storeName(UUID storeId, Principal owner) {
        return jdbc.sql("SELECT s.name FROM stores s JOIN owners o ON o.id=s.owner_id WHERE s.id=:store AND o.email=:email")
                .param("store", storeId).param("email", owner.getName()).query(String.class).optional().orElse(null);
    }

    private List<Item> catalog(UUID storeId) {
        return jdbc.sql("""
                WITH sales AS (
                    SELECT DISTINCT ON (p.product_name) p.product_name, p.price_won
                    FROM analysis_product_sales p JOIN sales_analyses a ON a.id=p.analysis_id
                    WHERE a.store_id=:store
                    ORDER BY p.product_name, (p.price_won IS NULL), a.after_month DESC, a.created_at DESC, a.id DESC
                ), photos AS (
                    SELECT product_name, photo_data_url FROM store_product_photos WHERE store_id=:store
                )
                SELECT COALESCE(s.product_name,f.product_name) AS name, s.price_won, f.photo_data_url
                FROM sales s FULL JOIN photos f ON s.product_name=f.product_name ORDER BY name
                """).param("store", storeId)
                .query((rs, row) -> new Item(rs.getString("name"), rs.getObject("price_won", Long.class),
                        rs.getString("photo_data_url"))).list();
    }

    private String version(String name, List<Item> items) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(json.writeValueAsBytes(new Catalog(name, items))));
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static boolean valid(List<Translation> translations, int count) {
        if (translations == null || translations.size() != count) return false;
        boolean[] seen = new boolean[count];
        for (var item : translations) {
            if (item == null || item.index() == null || item.index() < 0 || item.index() >= count || seen[item.index()]
                    || !validLabel(item.en()) || !validLabel(item.zh()) || !validLabel(item.ja())) return false;
            seen[item.index()] = true;
        }
        return true;
    }

    private static boolean validLabel(String text) {
        return text != null && !text.isBlank() && text.length() <= 255 && text.codePoints().noneMatch(Character::isISOControl);
    }

    private static List<Translation> sorted(List<Translation> items) {
        return items.stream().sorted(Comparator.comparingInt(Translation::index))
                .map(item -> new Translation(item.index(), item.en().strip(), item.zh().strip(), item.ja().strip())).toList();
    }

    private static ResponseEntity<ApiError> missingStore() {
        return error(404, "STORE_NOT_FOUND", "매장을 찾을 수 없어요.");
    }

    private static ResponseEntity<ApiError> missingMenu() {
        return error(404, "PUBLIC_MENU_NOT_FOUND", "공개된 메뉴판을 찾을 수 없어요.");
    }

    private static ResponseEntity<ApiError> changed() {
        return error(409, "QR_MENU_CHANGED", "메뉴나 가격·사진이 바뀌었어요. 목록을 다시 불러와 확인해 주세요.");
    }

    private static ResponseEntity<ApiError> error(int status, String code, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new ApiError(code, message, null));
    }

    private static ResponseEntity<?> ok(Object value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }

    record AgentInput(List<String> names) {}
    record DraftInput(String version) {}
    record Translation(Integer index, String en, String zh, String ja) {}
    record Translated(List<Translation> items) {}
    record PublishInput(String version, Boolean confirmed, List<Translation> translations) {}
    private record Catalog(String name, List<Item> items) {}
    private record Item(String name, Long priceWon, String photoDataUrl) {}
    private record PublishedItem(Item item, Translation translation) {}
    private record Publication(String storeName, String version, List<PublishedItem> items) {}
    private record Published(UUID publicId, String version, List<Translation> translations) {}
    private record Editor(String storeName, String version, List<Item> items, Published published) {}
    private record GuestMenu(String storeName, String version, List<GuestItem> items) {}
    private record GuestItem(String name, Long priceWon, boolean hasPhoto, Translation translation) {}
}
