package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.Principal;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/stores/{storeId}/menu-photos")
class MenuPhotoController {
    private final JdbcClient jdbc;
    private final StoreProductPhotos photos;

    MenuPhotoController(JdbcClient jdbc, StoreProductPhotos photos) {
        this.jdbc = jdbc;
        this.photos = photos;
    }

    @GetMapping
    ResponseEntity<?> get(@PathVariable UUID storeId, @RequestParam(required = false) String productName, Principal owner) {
        if (!owns(storeId, owner)) return notFound();
        if (productName != null) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(new PromotionDraftController.Photo(photos.find(storeId, productName)));
        }
        var menu = jdbc.sql("""
                WITH menu AS (
                    SELECT i.product_name FROM analysis_product_sales i
                    JOIN sales_analyses a ON a.id=i.analysis_id WHERE a.store_id=:store
                    UNION SELECT product_name FROM store_product_photos WHERE store_id=:store
                )
                SELECT m.product_name, f.product_name IS NOT NULL AS has_photo FROM menu m
                LEFT JOIN store_product_photos f ON f.store_id=:store AND f.product_name=m.product_name
                ORDER BY m.product_name
                """).param("store", storeId)
                .query((rs, row) -> new Menu(rs.getString("product_name"), rs.getBoolean("has_photo"))).list();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(menu);
    }

    @PutMapping
    ResponseEntity<?> put(@PathVariable UUID storeId, @RequestBody Input input, Principal owner) {
        if (!owns(storeId, owner)) return notFound();
        String productName = input.productName() == null ? "" : input.productName().strip();
        if (productName.isEmpty() || productName.length() > 255 || productName.indexOf(0) >= 0
                || !StoreProductPhotos.valid(input.photoDataUrl())) {
            return ResponseEntity.badRequest().body(new ApiError("INVALID_MENU_PHOTO", "메뉴명과 사진을 확인해 주세요.", null));
        }
        photos.save(storeId, productName, input.photoDataUrl());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new PromotionDraftController.Photo(input.photoDataUrl()));
    }

    private boolean owns(UUID id, Principal owner) {
        return jdbc.sql("SELECT s.id FROM stores s JOIN owners o ON o.id=s.owner_id WHERE s.id=:id AND o.email=:email")
                .param("id", id).param("email", owner.getName()).query(UUID.class).optional().isPresent();
    }

    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("STORE_NOT_FOUND", "매장을 찾을 수 없어요.", null));
    }

    record Menu(String productName, boolean hasPhoto) {}
    record Input(String productName, String photoDataUrl) {}
}
