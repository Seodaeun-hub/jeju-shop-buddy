package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.PromotionReviewController.Review;
import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import com.jejushopbuddy.analysis.StorePromotionToneController.Tone;
import com.fasterxml.jackson.annotation.JsonInclude;
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
    ResponseEntity<?> photo(@PathVariable UUID planId, @RequestParam(required = false) String subject, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null || (!plan.marketing() && plan.review() == null)) return notFound();
        String product = plan.marketing() ? cleanSubject(subject) : plan.review().productName();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new PhotoOptions(product == null ? null : photos.find(plan.storeId(), product), plan.defaultTone()));
    }

    @Transactional
    @PostMapping("/api/plans/{planId}/promotion-draft")
    public ResponseEntity<?> save(@PathVariable UUID planId, @RequestBody Input input, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        if (plan.publicationLocked()) return InstagramPublicationController.locked();
        var review = plan.review();
        if (plan.marketing()) {
            if (input.review() != null || cleanSubject(input.subject()) == null) {
                return bad("소개할 메뉴나 가게 소식을 80자 이내의 한 줄로 적어 주세요.");
            }
        } else {
            if (review == null || !review.equals(input.review())) return changed();
            if (review.maxDiscountQuantity() == 0) return bad("할인 가능한 수량이 1개 이상이어야 해요.");
        }
        if (input.publishDate() == null || input.publishTime() == null || input.publishDate().getYear() < 1900
                || input.publishDate().isAfter(plan.end()) || input.publishTime().getSecond() != 0
                || input.publishTime().getNano() != 0) return bad("게시 날짜와 시간을 확인해 주세요. 게시일은 계획 종료일까지 선택할 수 있어요.");
        if (!StoreProductPhotos.valid(input.photoDataUrl())) return bad("사용할 음식 사진을 다시 선택해 주세요.");

        String product = plan.marketing() ? cleanSubject(input.subject()) : review.productName();
        String discount = review == null ? "" : discountLine(review);
        boolean sameSubject = plan.draft() != null && product.equals(plan.draft().headline());
        String photo = input.photoDataUrl() != null ? input.photoDataUrl()
                : input.useSavedPhoto() ? photos.find(plan.storeId(), product) : null;
        if (photo == null && input.useSavedPhoto() && sameSubject) photo = plan.draft().photoDataUrl();
        String edited = input.caption() == null ? null : input.caption().strip();
        if (edited != null && (edited.isEmpty() || edited.length() > 2200)) return bad("홍보 문구는 1~2,200자로 작성해 주세요.");
        if (sameSubject && input.publishDate().equals(plan.draft().publishDate())
                && input.publishTime().equals(plan.draft().publishTime()) && java.util.Objects.equals(photo, plan.draft().photoDataUrl())
                && (edited == null || edited.equals(plan.draft().caption()))
                && (edited != null || "EDITED".equals(plan.draft().copySource()) || plan.draft().caption().contains(discount))) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(plan.draft());
        }
        if (edited == null && sameSubject && "EDITED".equals(plan.draft().copySource())) {
            edited = plan.draft().caption();
        }
        String feature = review == null ? "가게 소식" : String.format(Locale.KOREA, "%,d개 한정", review.maxDiscountQuantity());
        String detail = plan.start() + " ~ " + plan.end();
        String price = review == null ? "" : won(review.discountedPriceWon());
        String caption = edited;
        Tone tone = plan.draft() == null ? plan.defaultTone() : plan.draft().tone();
        String source = "EDITED";
        if (caption == null && tone != null) {
            caption = plan.marketing()
                    ? tone.marketingCaption(product, plan.storeName(), plan.avoidPhrases())
                    : tone.caption(product, price, discount, feature, detail, plan.storeName(), plan.avoidPhrases());
            source = "TEMPLATE";
        }
        if (caption == null) {
            var opening = agent.promotionOpening(product);
            if (plan.marketing()) {
                opening = opening.filter(line -> !Tone.containsAvoidedPhrase(line, plan.avoidPhrases()));
                caption = opening.map(line -> product + "\n" + line + "\n\n" + plan.storeName())
                        .orElseGet(() -> Tone.PLAIN.marketingCaption(product, plan.storeName(), plan.avoidPhrases()));
            } else {
                caption = product + " " + price + " · " + feature
                        + "\n" + discount + opening.map(line -> "\n" + line).orElse("")
                        + "\n\n" + detail + " · " + plan.storeName();
            }
            source = opening.isPresent() ? "GPT" : "TEMPLATE";
        }
        var draft = new Draft(plan.storeName(), product, feature, price, detail, caption,
                input.publishDate(), input.publishTime(), "Asia/Seoul", source, photo, 3, tone);
        int updated = jdbc.sql("""
                UPDATE execution_plans SET promotion_draft=CAST(:draft AS jsonb)
                WHERE id=:id AND instagram_publication IS NULL
                  AND promotion_review IS NOT DISTINCT FROM CAST(:review AS jsonb)
                  AND promotion_draft IS NOT DISTINCT FROM CAST(:previous AS jsonb)
                """).param("id", planId).param("draft", json.writeValueAsString(draft))
                .param("review", review == null ? null : json.writeValueAsString(review))
                .param("previous", plan.draftSnapshot()).update();
        if (updated == 0) {
            var latest = find(planId, owner.getName());
            return latest != null && latest.publicationLocked() ? InstagramPublicationController.locked() : changed();
        }
        if (input.photoDataUrl() != null) photos.save(plan.storeId(), product, photo);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(draft);
    }

    @PostMapping("/api/plans/{planId}/promotion-draft/caption")
    ResponseEntity<?> regenerate(@PathVariable UUID planId, @RequestBody CaptionInput input, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        if (plan.publicationLocked()) return InstagramPublicationController.locked();
        if (input.tone() == null) return bad("이번 게시물에 사용할 말투를 선택해 주세요.");
        var saved = plan.draft();
        if (saved == null || (!plan.marketing() && plan.review() == null)) return changed();

        var review = plan.review();
        String caption = plan.marketing()
                ? input.tone().marketingCaption(saved.headline(), saved.storeName(), plan.avoidPhrases())
                : input.tone().caption(review.productName(), won(review.discountedPriceWon()), discountLine(review),
                        String.format(Locale.KOREA, "%,d개 한정", review.maxDiscountQuantity()),
                        saved.detail(), saved.storeName(), plan.avoidPhrases());
        var draft = new Draft(saved.storeName(), saved.headline(), saved.feature(), saved.discountedPrice(),
                saved.detail(), caption, saved.publishDate(), saved.publishTime(), saved.timeZone(),
                "TEMPLATE", saved.photoDataUrl(), saved.templateVersion(), input.tone());
        int updated = jdbc.sql("""
                UPDATE execution_plans SET promotion_draft=CAST(:draft AS jsonb)
                WHERE id=:id AND instagram_publication IS NULL AND promotion_draft=CAST(:previous AS jsonb)
                """).param("id", planId).param("draft", json.writeValueAsString(draft))
                .param("previous", plan.draftSnapshot()).update();
        if (updated == 0) {
            var latest = find(planId, owner.getName());
            return latest != null && latest.publicationLocked() ? InstagramPublicationController.locked() : changed();
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(draft);
    }

    private Saved find(UUID id, String email) {
        return jdbc.sql("""
                SELECT s.id AS store_id, s.name, p.start_date, p.end_date, p.promotion_review, p.promotion_draft,
                       p.strategy_code='CUSTOM' AS marketing,
                       p.instagram_publication IS NOT NULL AS publication_locked,
                       s.promotion_tone, s.promotion_avoid_phrases
                FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                WHERE p.id=:id AND o.email=:email
                  AND (p.strategy_code='PROMOTION' OR (p.strategy_code='CUSTOM' AND p.strategy_snapshot @> '{"marketing":true}'))
                """).param("id", id).param("email", email)
                .query((rs, row) -> new Saved(rs.getObject("store_id", UUID.class), rs.getString("name"),
                        rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                        rs.getString("promotion_review") == null ? null : json.readValue(rs.getString("promotion_review"), Review.class),
                        rs.getString("promotion_draft") == null ? null : json.readValue(rs.getString("promotion_draft"), Draft.class),
                        rs.getString("promotion_draft"), rs.getBoolean("publication_locked"), rs.getBoolean("marketing"),
                        Tone.parse(rs.getString("promotion_tone")), rs.getString("promotion_avoid_phrases")))
                .optional().orElse(null);
    }

    private static String discountLine(Review review) {
        return "개당 " + won(review.discountWon()) + " 할인";
    }

    private static String cleanSubject(String value) {
        if (value == null) return null;
        String subject = value.strip();
        return subject.isEmpty() || subject.length() > 80 || subject.codePoints().anyMatch(Character::isISOControl) ? null : subject;
    }

    private static String won(long amount) { return String.format(Locale.KOREA, "%,d원", amount); }
    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("PROMOTION_PLAN_NOT_FOUND", "홍보물을 만들 수 있는 계획을 찾을 수 없어요.", null));
    }
    private static ResponseEntity<ApiError> changed() {
        return ResponseEntity.status(409).body(new ApiError("PROMOTION_REVIEW_CHANGED", "홍보 초안이나 실행 조건이 바뀌었어요. 다시 열어 확인해 주세요.", null));
    }
    private static ResponseEntity<ApiError> bad(String message) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_PROMOTION_DRAFT", message, null));
    }
    private record Saved(UUID storeId, String storeName, LocalDate start, LocalDate end, Review review, Draft draft,
                         String draftSnapshot, boolean publicationLocked, boolean marketing, Tone defaultTone, String avoidPhrases) {}
    record Photo(String photoDataUrl) {}
    record PhotoOptions(String photoDataUrl, Tone defaultTone) {}
    record CaptionInput(Tone tone) {}
    record Input(Review review, String subject, LocalDate publishDate, LocalTime publishTime, String photoDataUrl,
                 boolean useSavedPhoto, String caption) {}
    record Draft(String storeName, String headline, String feature, String discountedPrice, String detail, String caption,
                 LocalDate publishDate, LocalTime publishTime, String timeZone, String copySource, String photoDataUrl, int templateVersion,
                 @JsonInclude(JsonInclude.Include.NON_NULL) Tone tone) {}
}
