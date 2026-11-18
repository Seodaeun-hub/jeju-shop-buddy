package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.PromotionReviewController.Review;
import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import com.jejushopbuddy.analysis.StorePromotionToneController.Tone;
import com.jejushopbuddy.time.BusinessDate;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.security.Principal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.LocalTime;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

@RestController
class PromotionDraftController {
    private static final int DRAFT_GENERATION_VERSION = 2;
    private static final int MAX_CAPTION_LENGTH = 2200;
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;
    private final StoreProductPhotos photos;
    private final PromotionWeather weather;
    private final BusinessDate dates;

    PromotionDraftController(JdbcClient jdbc, ObjectMapper json, StrategyAgentClient agent, StoreProductPhotos photos,
                             PromotionWeather weather, BusinessDate dates) {
        this.jdbc = jdbc;
        this.json = json;
        this.agent = agent;
        this.photos = photos;
        this.weather = weather;
        this.dates = dates;
    }

    @GetMapping("/api/plans/{planId}/promotion-photo")
    ResponseEntity<?> photo(@PathVariable UUID planId, @RequestParam(required = false) String subject, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null || (!plan.marketing() && plan.review() == null)) return notFound();
        String product = plan.marketing() ? cleanSubject(subject) : plan.review().productName();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new PhotoOptions(product == null ? null : photos.find(plan.storeId(), product), plan.defaultTone()));
    }

    @GetMapping("/api/plans/{planId}/promotion-local-events")
    ResponseEntity<?> localEvents(@PathVariable UUID planId, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(PromotionLocalEvent.forPlan(plan.start(), plan.end(), plan.start()));
    }

    @PostMapping("/api/plans/{planId}/promotion-review-points")
    ResponseEntity<?> researchReviews(@PathVariable UUID planId, @RequestBody ResearchInput input, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        if (plan.publicationLocked()) return InstagramPublicationController.locked();
        String product = plan.marketing() ? cleanSubject(input.subject())
                : plan.review() == null ? null : plan.review().productName();
        if (product == null) return bad("후기를 찾을 메뉴나 가게 소식을 선택해 주세요.");
        var saved = plan.research();
        var now = Instant.now();
        var referenceDate = dates.today();
        if (!Boolean.TRUE.equals(input.refresh()) && saved != null && saved.matches(product, referenceDate) && !saved.sources().isEmpty()
                && saved.searchedAt().isAfter(now.minus(6, ChronoUnit.HOURS))) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(saved);
        }
        var result = agent.promotionReviewPoints(new ReviewSearch(plan.storeName(), plan.address(), product, referenceDate));
        if (result.isEmpty()) {
            return ResponseEntity.status(503).body(new ApiError("PROMOTION_REVIEW_SEARCH_UNAVAILABLE",
                    "공개 후기를 불러오지 못했어요. 다시 찾거나 후기 없이 진행할 수 있어요.", null));
        }
        if (!referenceDate.equals(dates.today())) return changed();
        var research = new ResearchSnapshot(UUID.randomUUID(), product, now, result.get().sources(), result.get().points(), referenceDate);
        int updated = jdbc.sql("""
                UPDATE execution_plans SET promotion_review_research=CAST(:research AS jsonb)
                WHERE id=:id AND instagram_publication IS NULL
                  AND promotion_review IS NOT DISTINCT FROM CAST(:review AS jsonb)
                  AND promotion_review_research IS NOT DISTINCT FROM CAST(:previous AS jsonb)
                """).param("id", planId).param("research", json.writeValueAsString(research))
                .param("previous", plan.researchSnapshot())
                .param("review", plan.review() == null ? null : json.writeValueAsString(plan.review())).update();
        if (updated == 0) {
            var latest = find(planId, owner.getName());
            if (latest != null && !latest.publicationLocked() && latest.research() != null
                    && latest.research().matches(product, referenceDate) && Objects.equals(plan.review(), latest.review())) {
                return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(latest.research());
            }
            return changed();
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(research);
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
        String sourcePage = input.sourcePageUrl() == null ? null : input.sourcePageUrl().strip();
        if (sourcePage != null && (sourcePage.length() > 1000 || !sourcePage.startsWith("https://"))) {
            return bad("https://로 시작하는 매장 공개 페이지 주소를 입력해 주세요.");
        }

        String product = plan.marketing() ? cleanSubject(input.subject()) : review.productName();
        boolean sameSubject = plan.draft() != null && product.equals(plan.draft().headline());
        var previousEvent = sameSubject ? plan.draft().localEvent() : null;
        var event = previousEvent;
        if (input.localEventId() != null) {
            event = PromotionLocalEvent.forPlan(plan.start(), plan.end(), input.publishDate()).stream()
                    .filter(option -> option.id().equals(input.localEventId())).findFirst().orElse(null);
            if (event == null && !input.localEventId().isEmpty()) {
                return bad("게시 날짜와 실행 기간에 맞는 제주 행사를 다시 선택해 주세요.");
            }
        } else if (event != null && !event.applies(plan.start(), plan.end(), input.publishDate())) {
            event = null;
        }
        if (event != null) event = event.forCaption(plan.storeName(), product, review != null);
        String photo = input.photoDataUrl() != null ? input.photoDataUrl()
                : input.useSavedPhoto() ? photos.find(plan.storeId(), product) : null;
        if (photo == null && input.useSavedPhoto() && sameSubject) photo = plan.draft().photoDataUrl();
        var edits = input.channelEdits();
        var instagramEdit = edits != null && edits.instagram() != null ? edits.instagram() : input.caption();
        var naverEdit = edits == null ? null : edits.naver();
        var daangnEdit = edits == null ? null : edits.daangn();
        if (!validCopy(instagramEdit) || !validCopy(naverEdit) || !validCopy(daangnEdit)) {
            return bad("홍보 문구는 채널마다 1~2,200자로 작성해 주세요.");
        }
        boolean edited = instagramEdit != null || naverEdit != null || daangnEdit != null;
        boolean generateNewCopy = Boolean.TRUE.equals(input.generateNewCopy());
        var requestedPoints = input.reviewPointIds() == null ? List.<String>of() : input.reviewPointIds();
        ReviewSelection selected = null;
        if (!requestedPoints.isEmpty()) {
            var research = plan.research();
            if (edited || !generateNewCopy || requestedPoints.size() > 5 || research == null
                    || !research.id().equals(input.reviewResearchId()) || !product.equals(research.subject())) {
                return bad("현재 메뉴의 후기 포인트를 다시 선택해 주세요.");
            }
            if (!research.matches(product, dates.today())) {
                return bad("기준일이 바뀌었어요. 공개 후기를 다시 찾은 뒤 포인트를 선택해 주세요.");
            }
            var points = research.points().stream().filter(point -> requestedPoints.contains(point.id())).toList();
            if (points.size() != requestedPoints.size()) return bad("현재 메뉴의 후기 포인트를 다시 선택해 주세요.");
            selected = new ReviewSelection(research.sources(), points);
        }
        boolean generate = generateNewCopy || sourcePage != null || !sameSubject || (!edited && canUpgrade(plan, product));
        if (sourcePage != null && sameSubject && "EDITED".equals(plan.draft().copySource())) {
            return bad("직접 수정해 저장한 초안은 그대로 편집할 수 있어요. 새 공개 출처를 참고하려면 새 초안을 만들어 주세요.");
        }
        var previousContext = sameSubject ? plan.draft().weatherContext() : null;
        boolean sameDate = sameSubject && input.publishDate().equals(plan.draft().publishDate());
        boolean retryForecast = sameDate && PromotionWeather.shouldRefresh(previousContext, input.publishDate());
        if (sameDate && previousContext != null && !retryForecast
                && input.publishTime().equals(plan.draft().publishTime()) && Objects.equals(photo, plan.draft().photoDataUrl())
                && Objects.equals(event, previousEvent)
                && !edited && !generate) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(plan.draft());
        }
        String feature = review == null ? "가게 소식" : String.format(Locale.KOREA, "%,d개 한정", review.maxDiscountQuantity());
        String detail = plan.start() + " ~ " + plan.end();
        String price = review == null ? "" : won(review.discountedPriceWon());
        var tone = sameSubject && plan.draft().tone() != null ? plan.draft().tone()
                : Objects.requireNonNullElse(plan.defaultTone(), Tone.FRIENDLY);
        var context = sameDate && previousContext != null && !generateNewCopy && !retryForecast
                ? PromotionWeather.context(plan.area(), input.publishDate(), previousContext.forecast(),
                        previousContext.issuedAt(), plan.avoidPhrases())
                : weather.resolve(plan.address(), plan.storeName(), plan.area(), input.publishDate(), plan.avoidPhrases());
        var generated = generate ? generateChannels(plan, product, tone, photo, sourcePage, selected) : null;
        if (sourcePage != null && (generated == null || !generated.researched())) {
            return ResponseEntity.unprocessableEntity().body(new ApiError("PROMOTION_SOURCE_NOT_VERIFIED",
                    "같은 매장의 공개 소개를 확인하지 못했어요. 매장 이름과 주소가 표시되는 소개 링크를 확인해 주세요.", null));
        }
        if (selected != null && (generated == null || generated.basis() == Basis.BASIC)) {
            return ResponseEntity.status(503).body(new ApiError("PROMOTION_COPY_UNAVAILABLE",
                    "선택한 후기 포인트를 반영한 초안을 만들지 못했어요. 다시 시도해 주세요.", null));
        }
        boolean replace = generated != null
                && (generateNewCopy || !sameSubject || generated.basis() != Basis.BASIC);
        var channels = replace ? generated : plan.draft().channels();
        String source = replace ? channels.basis() == Basis.BASIC ? "TEMPLATE" : "GPT" : plan.draft().copySource();
        String caption = replace ? channels.drafts().instagram() : plan.draft().caption();
        if (channels == null) channels = legacyChannels(plan, product, caption);
        var copies = channels.drafts();
        if (edited) {
            copies = new ChannelCopy(Objects.requireNonNullElse(instagramEdit, caption).strip(),
                    Objects.requireNonNullElse(naverEdit, copies.naver()).strip(),
                    Objects.requireNonNullElse(daangnEdit, copies.daangn()).strip());
            source = "EDITED";
        }
        var oldLeads = previousContext == null ? new ChannelCopy("", "", "") : previousContext.leads();
        String offer = offer(plan, product);
        String previousFooter = PromotionLocalEvent.captionFooter(offer, replace ? null : previousEvent);
        String footer = PromotionLocalEvent.captionFooter(offer, event);
        var bodies = new ChannelCopy(captionWithoutContext(copies.instagram(), oldLeads.instagram(), previousFooter),
                captionWithoutContext(copies.naver(), oldLeads.naver(), previousFooter),
                captionWithoutContext(copies.daangn(), oldLeads.daangn(), previousFooter));
        var desired = context.leads();
        var leads = new ChannelCopy(fittingLead(bodies.instagram(), desired.instagram(), footer, instagramEdit != null),
                fittingLead(bodies.naver(), desired.naver(), footer, naverEdit != null),
                fittingLead(bodies.daangn(), desired.daangn(), footer, daangnEdit != null));
        copies = withOffer(new ChannelCopy(addWeather(bodies.instagram(), leads.instagram(), false),
                addWeather(bodies.naver(), leads.naver(), true), addWeather(bodies.daangn(), leads.daangn(), true)), footer);
        if (copies.instagram().length() > MAX_CAPTION_LENGTH || copies.naver().length() > MAX_CAPTION_LENGTH
                || copies.daangn().length() > MAX_CAPTION_LENGTH) {
            return bad("자동 안내와 할인 조건을 포함한 홍보 문구는 채널마다 2,200자까지 저장할 수 있어요.");
        }
        channels = new SavedChannels(channels.findings(), copies, channels.researched(), offer,
                channels.basis(), channels.sourceCheckVersion());
        var draft = new Draft(plan.storeName(), product, feature, price, detail, copies.instagram(),
                input.publishDate(), input.publishTime(), "Asia/Seoul", source, photo, 3, tone, channels,
                replace ? selected : sameSubject ? plan.draft().reviewSelection() : null, context.withLeads(leads), event);
        int updated = jdbc.sql("""
                UPDATE execution_plans SET promotion_draft=CAST(:draft AS jsonb)
                WHERE id=:id AND instagram_publication IS NULL
                  AND promotion_review IS NOT DISTINCT FROM CAST(:review AS jsonb)
                  AND promotion_draft IS NOT DISTINCT FROM CAST(:previous AS jsonb)
                  AND (CAST(:researchId AS text) IS NULL OR promotion_review_research->>'id' = CAST(:researchId AS text))
                """).param("id", planId).param("draft", json.writeValueAsString(draft))
                .param("review", review == null ? null : json.writeValueAsString(review))
                .param("previous", plan.draftSnapshot())
                .param("researchId", selected == null ? null : input.reviewResearchId().toString()).update();
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
        var channels = saved.channels();
        String source = "TEMPLATE";
        if (channels != null) {
            if (channels.researched() || (channels.basis() != null && channels.basis() != Basis.BASIC)) {
                var findings = channels.sourceCheckVersion() == null ? List.<ChannelFinding>of() : channels.findings();
                var rewritten = agent.promotionChannels(channelInput(plan, saved.headline(), input.tone(), findings,
                                saved.photoDataUrl(), null, saved.reviewSelection()))
                        .map(ChannelDrafts::drafts);
                if (rewritten.isEmpty()) {
                    return ResponseEntity.status(503).body(new ApiError("PROMOTION_COPY_UNAVAILABLE",
                            "말투를 바꾸지 못했어요. 저장된 초안은 그대로예요.", null));
                }
                caption = withOffer(rewritten.get().instagram(), channels.offer());
                source = "GPT";
            } else if (channels.offer() != null) {
                caption = withOffer(defaultCopy(plan, saved.headline(), input.tone()).instagram(), channels.offer());
            }
            var lead = saved.weatherContext() == null ? "" : saved.weatherContext().leads().instagram();
            String body = captionWithoutContext(caption, lead, channels.offer());
            caption = withOffer(addWeather(body, lead, false), PromotionLocalEvent.captionFooter(channels.offer(), saved.localEvent()));
            channels = new SavedChannels(channels.findings(),
                    new ChannelCopy(caption, channels.drafts().naver(), channels.drafts().daangn()), channels.researched(),
                    channels.offer(), channels.basis(), channels.sourceCheckVersion());
        }
        var draft = new Draft(saved.storeName(), saved.headline(), saved.feature(), saved.discountedPrice(),
                saved.detail(), caption, saved.publishDate(), saved.publishTime(), saved.timeZone(),
                source, saved.photoDataUrl(), saved.templateVersion(), input.tone(), channels, saved.reviewSelection(),
                saved.weatherContext(), saved.localEvent());
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

    private SavedChannels generateChannels(Saved plan, String product, Tone tone, String photo, String sourcePage, ReviewSelection selected) {
        var saved = plan.draft();
        var findings = sourcePage == null && saved != null && product.equals(saved.headline())
                && saved.channels() != null && saved.channels().researched()
                && Objects.requireNonNullElse(saved.channels().sourceCheckVersion(), 0) >= DRAFT_GENERATION_VERSION
                ? saved.channels().findings() : null;
        var result = agent.promotionChannels(channelInput(plan, product, tone, findings, photo, sourcePage, selected))
                .orElse(new ChannelDrafts(List.of(), null, false));
        if (sourcePage != null && !result.sourcePageUsed()) return null;
        boolean researched = result.drafts() != null && result.findings().stream().anyMatch(fact -> !"HOURS".equals(fact.kind()));
        Basis basis = result.drafts() == null ? Basis.BASIC
                : researched ? (photo == null ? Basis.WEB : Basis.WEB_AND_PHOTO)
                : (photo == null ? Basis.MENU : Basis.PHOTO);
        var copies = result.drafts() == null ? defaultCopy(plan, product, tone) : result.drafts();
        String offer = offer(plan, product);
        return new SavedChannels(result.findings(), withOffer(copies, offer), researched, offer, basis, DRAFT_GENERATION_VERSION);
    }

    private static boolean canUpgrade(Saved plan, String product) {
        var draft = plan.draft();
        if ("EDITED".equals(draft.copySource())) return false;
        var channels = draft.channels();
        if (channels != null && channels.basis() != null && Objects.requireNonNullElse(channels.sourceCheckVersion(), 0) < DRAFT_GENERATION_VERSION
                && "GPT".equals(draft.copySource())) return true;
        if (channels == null) return true;
        if (channels.researched() || (channels.basis() != null && channels.basis() != Basis.BASIC)) return false;
        var copies = channels.drafts();
        var context = draft.weatherContext();
        if (context != null || draft.localEvent() != null) {
            var leads = context == null ? new ChannelCopy("", "", "") : context.leads();
            String footer = PromotionLocalEvent.captionFooter(channels.offer(), draft.localEvent());
            copies = withOffer(new ChannelCopy(captionWithoutContext(copies.instagram(), leads.instagram(), footer),
                    captionWithoutContext(copies.naver(), leads.naver(), footer),
                    captionWithoutContext(copies.daangn(), leads.daangn(), footer)), channels.offer());
        }
        return copies.equals(withOffer(defaultCopy(plan, product, draft.tone()), channels.offer()));
    }

    private static ChannelInput channelInput(Saved plan, String product, Tone tone, List<ChannelFinding> findings, String photo, String sourcePage, ReviewSelection selected) {
        return new ChannelInput(plan.storeName(), plan.address(), product, tone == null ? Tone.FRIENDLY : tone,
                plan.avoidPhrases() == null ? "" : plan.avoidPhrases(), plan.review() != null, findings, photo, sourcePage,
                selected == null ? List.of() : selected.points().stream()
                        .map(point -> new ReviewFocus(point.sentence(), point.anchors())).toList());
    }

    private static ChannelCopy defaultCopy(Saved plan, String product, Tone tone) {
        Tone effective = tone == null ? Tone.FRIENDLY : tone;
        String instagram = effective.marketingCaption(product, plan.storeName(), plan.avoidPhrases());
        String naver = "[" + product + (plan.review() == null ? " 소식" : " 할인 행사") + "]\n" + plan.storeName();
        String greeting = "동네 이웃 여러분, " + plan.storeName() + "입니다.";
        String daangn = (Tone.containsAvoidedPhrase(greeting, plan.avoidPhrases()) ? plan.storeName() : greeting)
                + "\n" + product + (plan.review() == null ? " 소식을 전해요." : " 할인 소식을 전해요.");
        return new ChannelCopy(instagram, naver, daangn);
    }

    private static SavedChannels legacyChannels(Saved plan, String product, String caption) {
        var copies = defaultCopy(plan, product, plan.draft().tone());
        String offer = offer(plan, product);
        return new SavedChannels(List.of(), new ChannelCopy(caption, withOffer(copies.naver(), offer),
                withOffer(copies.daangn(), offer)), false, null, null, null);
    }

    private static String offer(Saved plan, String product) {
        var review = plan.review();
        if (review == null) return null;
        return product + " " + won(review.discountedPriceWon()) + " · " + discountLine(review)
                + " · " + String.format(Locale.KOREA, "%,d개 한정", review.maxDiscountQuantity())
                + "\n행사 기간 " + plan.start() + " ~ " + plan.end();
    }

    private static boolean validCopy(String value) {
        return value == null || (!value.isBlank() && value.strip().length() <= MAX_CAPTION_LENGTH);
    }

    static String fittingLead(String body, String lead, String offer, boolean edited) {
        // Older drafts can already fill the limit. Preserve their body and offer when the posting date changes.
        int footerLength = offer == null ? 0 : offer.length() + 2;
        return !edited && body.length() + lead.length() + 2 + footerLength > MAX_CAPTION_LENGTH ? "" : lead;
    }

    static String withWeather(String copy, String previousLead, String lead, String offer, boolean titled) {
        return withOffer(addWeather(captionWithoutContext(copy, previousLead, offer), lead, titled), offer);
    }

    private static String addWeather(String body, String lead, boolean titled) {
        if (lead.isBlank()) return body;
        if (!titled) return lead + "\n\n" + body;
        int titleEnd = body.indexOf('\n');
        if (titleEnd > 0 && titleEnd <= 65) {
            return body.substring(0, titleEnd + 1) + lead + "\n\n" + body.substring(titleEnd + 1);
        }
        return body + "\n\n" + lead;
    }

    private static String captionWithoutContext(String copy, String lead, String offer) {
        String footer = "\n\n" + offer;
        if (offer != null && copy.endsWith(footer)) copy = copy.substring(0, copy.length() - footer.length());
        if (lead.isBlank()) return copy;
        if (copy.startsWith(lead + "\n\n")) return copy.substring(lead.length() + 2);
        if (copy.endsWith("\n\n" + lead)) return copy.substring(0, copy.length() - lead.length() - 2);
        String middle = "\n" + lead + "\n\n";
        int position = copy.indexOf(middle);
        if (position < 0) return copy;
        return copy.substring(0, position) + "\n" + copy.substring(position + middle.length());
    }

    private static String withOffer(String body, String offer) {
        return offer == null || body.endsWith("\n\n" + offer) ? body : body + "\n\n" + offer;
    }

    private static ChannelCopy withOffer(ChannelCopy copy, String offer) {
        return new ChannelCopy(withOffer(copy.instagram(), offer), withOffer(copy.naver(), offer), withOffer(copy.daangn(), offer));
    }

    private Saved find(UUID id, String email) {
        return jdbc.sql("""
                SELECT s.id AS store_id, s.name, s.address, area.name AS area_name,
                       p.start_date, p.end_date, p.promotion_review, p.promotion_draft,
                       p.strategy_code='CUSTOM' AS marketing, p.promotion_review_research,
                       p.instagram_publication IS NOT NULL AS publication_locked,
                       s.promotion_tone, s.promotion_avoid_phrases
                FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                JOIN jeju_areas area ON area.code=s.area_code
                WHERE p.id=:id AND o.email=:email
                  AND (p.strategy_code='PROMOTION' OR (p.strategy_code='CUSTOM' AND p.strategy_snapshot @> '{"marketing":true}'))
                """).param("id", id).param("email", email)
                .query((rs, row) -> new Saved(rs.getObject("store_id", UUID.class), rs.getString("name"), rs.getString("address"),
                        rs.getString("area_name"),
                        rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                        rs.getString("promotion_review") == null ? null : json.readValue(rs.getString("promotion_review"), Review.class),
                        rs.getString("promotion_draft") == null ? null : json.readValue(rs.getString("promotion_draft"), Draft.class),
                        rs.getString("promotion_draft"), rs.getBoolean("publication_locked"), rs.getBoolean("marketing"),
                        Tone.parse(rs.getString("promotion_tone")), rs.getString("promotion_avoid_phrases"),
                        rs.getString("promotion_review_research") == null ? null
                                : json.readValue(rs.getString("promotion_review_research"), ResearchSnapshot.class),
                        rs.getString("promotion_review_research")))
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
    private record Saved(UUID storeId, String storeName, String address, String area, LocalDate start, LocalDate end, Review review, Draft draft,
                         String draftSnapshot, boolean publicationLocked, boolean marketing, Tone defaultTone, String avoidPhrases,
                         ResearchSnapshot research, String researchSnapshot) {}
    record Photo(String photoDataUrl) {}
    record PhotoOptions(String photoDataUrl, Tone defaultTone) {}
    record CaptionInput(Tone tone) {}
    record ResearchInput(String subject, Boolean refresh) {}
    record ReviewSearch(String storeName, String address, String subject, LocalDate referenceDate) {}
    record ReviewSource(String id, String url, String title, String dateLabel) {}
    record ReviewPoint(String id, String sentence, List<String> anchors, List<String> sourceIds) {}
    record ReviewResearch(List<ReviewSource> sources, List<ReviewPoint> points) {}
    record ResearchSnapshot(UUID id, String subject, Instant searchedAt, List<ReviewSource> sources, List<ReviewPoint> points,
                            LocalDate referenceDate) {
        boolean matches(String product, LocalDate date) {
            return product.equals(subject) && date.equals(referenceDate);
        }
    }
    record ReviewSelection(List<ReviewSource> sources, List<ReviewPoint> points) {}
    record ReviewFocus(String sentence, List<String> anchors) {}
    record Input(Review review, String subject, LocalDate publishDate, LocalTime publishTime, String photoDataUrl,
                 boolean useSavedPhoto, String caption, ChannelCopy channelEdits, String sourcePageUrl,
                 Boolean generateNewCopy, UUID reviewResearchId, List<String> reviewPointIds, String localEventId) {}
    record ChannelInput(String storeName, String address, String subject, Tone tone, String avoidPhrases, boolean promotion,
                        @JsonInclude(JsonInclude.Include.NON_NULL) List<ChannelFinding> savedFindings,
                        @JsonInclude(JsonInclude.Include.NON_NULL) String photoDataUrl,
                        @JsonInclude(JsonInclude.Include.NON_NULL) String sourcePageUrl, List<ReviewFocus> reviewPoints) {}
    record ChannelFinding(String kind, String text, String url) {}
    record ChannelCopy(String instagram, String naver, String daangn) {}
    record ChannelDrafts(List<ChannelFinding> findings, ChannelCopy drafts, boolean sourcePageUsed) {}
    enum Basis { WEB, WEB_AND_PHOTO, PHOTO, MENU, BASIC }
    record SavedChannels(List<ChannelFinding> findings, ChannelCopy drafts, boolean researched, String offer,
                         @JsonInclude(JsonInclude.Include.NON_NULL) Basis basis,
                         @JsonInclude(JsonInclude.Include.NON_NULL) Integer sourceCheckVersion) {}
    record Draft(String storeName, String headline, String feature, String discountedPrice, String detail, String caption,
                 LocalDate publishDate, LocalTime publishTime, String timeZone, String copySource, String photoDataUrl, int templateVersion,
                 @JsonInclude(JsonInclude.Include.NON_NULL) Tone tone,
                 @JsonInclude(JsonInclude.Include.NON_NULL) SavedChannels channels,
                 @JsonInclude(JsonInclude.Include.NON_NULL) ReviewSelection reviewSelection,
                 @JsonInclude(JsonInclude.Include.NON_NULL) PromotionWeather.Context weatherContext,
                 @JsonInclude(JsonInclude.Include.NON_NULL) PromotionLocalEvent localEvent) {}
}
