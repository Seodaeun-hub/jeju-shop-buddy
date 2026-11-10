package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.security.Principal;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/stores/{storeId}/promotion-tone")
class StorePromotionToneController {
    private final JdbcClient jdbc;

    StorePromotionToneController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    ResponseEntity<?> get(@PathVariable UUID storeId, Principal owner) {
        return jdbc.sql("""
                SELECT s.promotion_tone, s.promotion_avoid_phrases
                FROM stores s JOIN owners o ON o.id=s.owner_id
                WHERE s.id=:id AND o.email=:email
                """).param("id", storeId).param("email", owner.getName())
                .query((rs, row) -> new Settings(Tone.parse(rs.getString("promotion_tone")), rs.getString("promotion_avoid_phrases")))
                .optional().<ResponseEntity<?>>map(settings -> ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(settings))
                .orElseGet(StorePromotionToneController::notFound);
    }

    @PutMapping
    ResponseEntity<?> put(@PathVariable UUID storeId, @RequestBody Settings input, Principal owner) {
        String avoid = input.avoidPhrases() == null ? "" : input.avoidPhrases().strip();
        if (input.tone() == null || avoid.length() > 500 || avoid.indexOf(0) >= 0) {
            return ResponseEntity.badRequest().body(new ApiError("INVALID_PROMOTION_TONE",
                    "말투를 선택하고 피하고 싶은 표현은 500자 이내로 입력해 주세요.", null));
        }
        int updated = jdbc.sql("""
                UPDATE stores s SET promotion_tone=:tone, promotion_avoid_phrases=:avoid
                FROM owners o WHERE s.id=:id AND o.id=s.owner_id AND o.email=:email
                """).param("tone", input.tone().name()).param("avoid", avoid)
                .param("id", storeId).param("email", owner.getName()).update();
        return updated == 0 ? notFound()
                : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Settings(input.tone(), avoid));
    }

    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("STORE_NOT_FOUND", "매장을 찾을 수 없어요.", null));
    }

    record Settings(Tone tone, String avoidPhrases) {}

    enum Tone {
        PLAIN, FRIENDLY, SHORT;

        static Tone parse(String value) {
            return value == null ? null : valueOf(value);
        }

        String caption(String product, String price, String discount, String limit, String period, String store, String avoidPhrases) {
            String compact = product + " " + price + " · " + limit;
            String[] alternatives = switch (this) {
                case PLAIN -> new String[]{
                        product + " 할인가는 " + price + "입니다.\n" + limit + "으로 판매합니다.",
                        "할인 판매 안내\n" + compact
                };
                case FRIENDLY -> new String[]{
                        product + " " + price + "에 준비했어요.\n이번 할인은 " + limit + "이에요.",
                        "이번엔 " + product + " " + price + "이에요.\n" + limit + "으로 진행해요."
                };
                case SHORT -> new String[]{compact};
            };
            String details = "\n" + discount + "\n\n" + period + " · " + store;
            for (String alternative : alternatives) {
                if (!containsAvoidedPhrase(alternative, avoidPhrases)) {
                    return alternative + details;
                }
            }
            return compact + details;
        }

        private static boolean containsAvoidedPhrase(String text, String avoidPhrases) {
            String normalized = text.toLowerCase(Locale.ROOT);
            for (String entry : avoidPhrases.split("[,\\r\\n]+")) {
                String phrase = entry.strip().toLowerCase(Locale.ROOT);
                if (!phrase.isEmpty() && normalized.contains(phrase)) return true;
            }
            return false;
        }
    }
}
