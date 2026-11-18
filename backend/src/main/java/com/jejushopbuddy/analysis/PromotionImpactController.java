package com.jejushopbuddy.analysis;

import com.jejushopbuddy.time.BusinessDate;

import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/plans/{planId}/promotion-impact")
class PromotionImpactController {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final String MATCH_PUBLICATION = """
                AND p.manual_promotion_publication IS NOT DISTINCT FROM CAST(:manual AS jsonb)
                AND (CASE WHEN p.instagram_publication->>'state'='PUBLISHED'
                          THEN p.instagram_publication->>'publishedAt' END) IS NOT DISTINCT FROM CAST(:published AS text)
            """;
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;
    private final ExecutionPlanReader plans;
    private final ExecutionPlanWriter planWriter;
    private final BusinessDate dates;

    PromotionImpactController(JdbcClient jdbc, ObjectMapper json, StrategyAgentClient agent,
                              ExecutionPlanReader plans, ExecutionPlanWriter planWriter, BusinessDate dates) {
        this.jdbc = jdbc;
        this.json = json;
        this.agent = agent;
        this.plans = plans;
        this.planWriter = planWriter;
        this.dates = dates;
    }

    @GetMapping
    ResponseEntity<?> get(@PathVariable UUID planId, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(comparison(plan));
    }

    @GetMapping("/publication")
    ResponseEntity<?> manualPublication(@PathVariable UUID planId, Principal owner) {
        var plan = find(planId, owner.getName());
        return plan == null ? notFound() : publicationStatus(plan);
    }

    @PutMapping("/publication")
    ResponseEntity<?> saveManualPublication(@PathVariable UUID planId, @RequestBody PublicationInput input, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        var day = input.publishedDate();
        if (input.channel() == null || day == null || day.getYear() < 1900
                || day.isAfter(dates.today()) || day.isAfter(plan.end())) {
            return invalid("게시 채널과 실제 게시일을 확인해 주세요. 오늘과 행사 종료일을 넘길 수 없어요.");
        }
        if (plan.draftProduct() == null || plan.product() == null) {
            return invalid("비교할 메뉴로 홍보 초안을 먼저 저장해 주세요.");
        }
        String product = plan.comparisonProduct();
        if (!plan.discountPromotion() && input.productName() != null) {
            product = input.productName().strip();
        }
        if (product.isBlank() || product.length() > 255 || product.codePoints().anyMatch(Character::isISOControl)) {
            return invalid("상품 주문 POS에 적힌 품목명을 한 줄로 입력해 주세요.");
        }
        var records = new EnumMap<Channel, PublicationReference>(Channel.class);
        for (var record : plan.manualPublications().values()) {
            records.put(record.channel(), new PublicationReference(record.channel(), record.publishedDate(), product));
        }
        records.put(input.channel(), new PublicationReference(input.channel(), day, product));
        if (records.equals(plan.manualPublications())) return publicationStatus(plan);

        // Stamp older totals before changing the dates that were used to calculate them.
        var basis = savedBasis(plan, readSnapshot(plan));
        int updated = jdbc.sql("""
                UPDATE execution_plans p SET manual_promotion_publication=CAST(:records AS jsonb),
                    promotion_impact=CASE WHEN p.promotion_impact IS NULL OR CAST(:basis AS jsonb) IS NULL
                        THEN p.promotion_impact
                        ELSE jsonb_set(p.promotion_impact, '{basis}', CAST(:basis AS jsonb)) END
                FROM sales_analyses a, stores s, owners o
                WHERE p.id=:id AND p.analysis_id=a.id AND a.store_id=s.id AND s.owner_id=o.id AND o.email=:email
                  AND p.promotion_draft->>'headline'=:draftProduct
                  AND p.promotion_impact IS NOT DISTINCT FROM CAST(:snapshot AS jsonb)
                """ + MATCH_PUBLICATION)
                .param("records", json.writeValueAsString(records)).param("id", planId).param("email", owner.getName())
                .param("basis", basis == null ? null : json.writeValueAsString(basis))
                .param("draftProduct", plan.draftProduct()).param("snapshot", plan.snapshot())
                .param("manual", plan.manualSnapshot()).param("published", plan.instagramPublishedAt()).update();
        if (updated == 0) return ResponseEntity.status(409)
                .body(new ApiError("PROMOTION_PUBLICATION_CHANGED", "게시 기록이나 POS 집계가 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요.", null));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ManualPublicationStatus(records, product));
    }

    private static ResponseEntity<ManualPublicationStatus> publicationStatus(Plan plan) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new ManualPublicationStatus(plan.manualPublications(), plan.comparisonProduct()));
    }

    @PutMapping
    ResponseEntity<?> save(@PathVariable UUID planId, @RequestBody Upload upload, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        var result = comparison(plan);
        if (result.before() == null || upload.phase() == null) return invalid("홍보 게시 기록과 비교 기간을 확인해 주세요.");
        var period = upload.phase() == Phase.BEFORE ? result.before() : result.after();
        if ((upload.productName() != null && !result.productName().equals(upload.productName()))
                || !period.start().equals(upload.start()) || !period.end().equals(upload.end())
                || !period.end().isBefore(dates.today())) {
            return invalid("화면에 표시된 기간이 끝난 뒤 해당 기간의 POS를 올려 주세요.");
        }
        if (Boolean.TRUE.equals(upload.onlyIfMissing())
                && (upload.phase() == Phase.BEFORE ? result.beforeTotals() : result.afterTotals()) != null) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
        }
        if (!validTotal(upload.quantity()) || !validTotal(upload.amount())
                || upload.recordedDays() == null || upload.recordedDays() < 0
                || (upload.recordedDays() == 0 && (upload.quantity() != 0 || upload.amount() != 0))
                || upload.recordedDays() > ChronoUnit.DAYS.between(period.start(), period.end()) + 1) {
            return invalid("상품 주문 시트의 판매량, 실판매금액과 기록된 날짜를 확인해 주세요.");
        }
        var totals = new Totals(upload.quantity(), upload.amount(), upload.recordedDays());
        var saved = saveTotals(planId, owner.getName(), plan, result, upload.phase(), totals);
        if (saved == null) return ResponseEntity.status(409)
                .body(new ApiError("PROMOTION_IMPACT_CHANGED", "게시 상태가 바뀌었어요. 새로고침해 주세요.", null));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(comparison(saved));
    }

    private Plan saveTotals(UUID planId, String email, Plan plan, Comparison result, Phase phase, Totals totals) {
        var basis = new ComparisonBasis(result.productName(), result.before(), result.after());
        boolean keepTotals = basis.equals(savedBasis(plan, readSnapshot(plan)));
        var saved = jdbc.sql("""
                UPDATE execution_plans p
                SET promotion_impact = (CASE
                    WHEN NOT :keepTotals THEN '{}'::jsonb
                    WHEN p.promotion_impact->CAST(:phase AS text) = CAST(:totals AS jsonb) THEN p.promotion_impact
                    ELSE p.promotion_impact - 'actuals'
                END) || jsonb_build_object('basis', CAST(:basis AS jsonb), CAST(:phase AS text), CAST(:totals AS jsonb))
                FROM sales_analyses a, stores s, owners o
                WHERE p.id=:id AND p.analysis_id=a.id
                  AND a.store_id=s.id AND s.owner_id=o.id AND o.email=:email
                """ + MATCH_PUBLICATION + """
                  AND p.promotion_impact IS NOT DISTINCT FROM CAST(:snapshot AS jsonb)
                RETURNING p.promotion_impact
                """).param("phase", phase == Phase.BEFORE ? "before" : "after")
                .param("totals", json.writeValueAsString(totals)).param("id", planId).param("email", email)
                .param("basis", json.writeValueAsString(basis)).param("keepTotals", keepTotals).param("snapshot", plan.snapshot())
                .param("published", plan.instagramPublishedAt()).param("manual", plan.manualSnapshot())
                .query(String.class).optional();
        return saved.map(plan::withSnapshot).orElse(null);
    }

    ArchiveStatus reconcileArchivedPos(UUID planId, String email, LocalDate today, Supplier<List<ProductPosArchive.Days>> files) {
        var plan = find(planId, email);
        if (plan == null) return null;
        var result = comparison(plan, today);
        if (!result.afterReady() || result.before() == null) return null;
        var basis = new ComparisonBasis(result.productName(), result.before(), result.after());
        if (result.beforeTotals() != null && result.afterTotals() != null) return new ArchiveStatus(basis, null);
        var archive = files.get();
        Period firstGap = null;
        for (Phase phase : Phase.values()) {
            if ((phase == Phase.BEFORE ? result.beforeTotals() : result.afterTotals()) != null) continue;
            var period = phase == Phase.BEFORE ? result.before() : result.after();
            var summary = ProductPosArchive.summarize(archive, result.productName(), period);
            if (summary.gap() != null) {
                if (firstGap == null) firstGap = summary.gap();
                continue;
            }
            plan = saveTotals(planId, email, plan, result, phase, summary.totals());
            if (plan == null) return null;
            result = comparison(plan, today);
        }
        return new ArchiveStatus(basis, firstGap);
    }

    @GetMapping("/next-explanation")
    ResponseEntity<?> nextExplanation(@PathVariable UUID planId, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        var result = comparison(plan);
        if (result.advice() == null) return invalid("행사 전후 POS를 모두 저장해 주세요.");
        var input = new ExplanationInput(result.beforeTotals(), result.afterTotals(), result.advice(),
                result.actuals(), result.profit());
        var explanation = agent.nextPromotionExplanation(input).orElse(null);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Explanation(input, explanation));
    }

    @PutMapping("/actuals")
    ResponseEntity<?> saveActuals(@PathVariable UUID planId, @RequestBody ActualsInput input, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        var current = comparison(plan);
        if (current.advice() == null) return invalid("행사 전후 POS를 모두 저장해 주세요.");
        var actuals = new Actuals(wholeValue(input.discountedQuantity()), wholeValue(input.beforeUnitCost()),
                wholeValue(input.afterUnitCost()));
        if (!validTotal(actuals.discountedQuantity()) || actuals.discountedQuantity() > current.afterTotals().quantity()) {
            return invalid("할인 적용 수량은 행사 후 판매량 이내로 입력해 주세요.");
        }
        if (!validTotal(actuals.beforeUnitCost()) || !validTotal(actuals.afterUnitCost())
                || profit(current.beforeTotals(), current.afterTotals(), actuals) == null) {
            return invalid("행사 전후 개당 원가와 계산 가능한 금액 범위를 확인해 주세요.");
        }
        var saved = jdbc.sql("""
                UPDATE execution_plans p
                SET promotion_impact = jsonb_set(p.promotion_impact, '{actuals}', CAST(:actuals AS jsonb))
                FROM sales_analyses a, stores s, owners o
                WHERE p.id=:id AND p.strategy_code='PROMOTION' AND p.analysis_id=a.id
                  AND a.store_id=s.id AND s.owner_id=o.id AND o.email=:email
                """ + MATCH_PUBLICATION + """
                  AND p.promotion_impact->'before'=CAST(:before AS jsonb)
                  AND p.promotion_impact->'after'=CAST(:after AS jsonb)
                RETURNING p.promotion_impact
                """).param("id", planId).param("email", owner.getName())
                .param("published", plan.instagramPublishedAt()).param("manual", plan.manualSnapshot())
                .param("before", json.writeValueAsString(current.beforeTotals()))
                .param("after", json.writeValueAsString(current.afterTotals()))
                .param("actuals", json.writeValueAsString(actuals)).query(String.class).optional();
        if (saved.isEmpty()) return ResponseEntity.status(409)
                .body(new ApiError("PROMOTION_IMPACT_CHANGED", "POS 집계가 바뀌었어요. 새로고침해 주세요.", null));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(comparison(
                plan.withSnapshot(saved.get())));
    }

    @PutMapping("/next-plan/{requestId}")
    ResponseEntity<?> createNextPlan(@PathVariable UUID planId, @PathVariable UUID requestId,
                                     @RequestBody NextPlanInput input, Principal owner) {
        String email = owner.getName();
        var source = find(planId, email);
        if (source == null) return notFound();
        UUID id = UUID.nameUUIDFromBytes(("promotion-follow-up:" + planId + ":" + requestId).getBytes(StandardCharsets.UTF_8));
        var existing = plans.find(id, email);
        if (existing.isPresent()) return ResponseEntity.ok(existing.get());

        var advice = comparison(source).advice();
        if (advice == null || (advice.action() != NextAction.KEEP_TERMS && advice.action() != NextAction.REVIEW_TERMS)
                || input.action() != advice.action()) {
            return invalid("현재 다음 행사 제안을 다시 확인해 주세요.");
        }
        var original = plans.find(planId, email).orElse(null);
        if (original == null || original.promotionReview() == null) return notFound();
        var review = original.promotionReview();
        Long discount = wholeValue(input.discountWon());
        Long quantity = wholeValue(input.maxDiscountQuantity());
        if (!validTotal(discount) || discount == 0 || discount > review.priceWon()
                || !validTotal(quantity) || quantity == 0 || quantity > MAX_SAFE_INTEGER / discount) {
            return invalid("할인액과 할인 수량 한도를 확인해 주세요.");
        }
        boolean changed = discount != review.discountWon() || quantity != review.maxDiscountQuantity();
        if (advice.action() == NextAction.KEEP_TERMS && changed) {
            return invalid("유지 검토에서는 기존 할인 조건을 사용해 주세요.");
        }
        if (advice.action() == NextAction.REVIEW_TERMS && !changed) {
            return invalid("개당 할인액이나 할인 수량 한도를 바꿔 주세요.");
        }
        if (input.startDate() == null || input.startDate().isBefore(dates.today())
                || input.startDate().isAfter(LocalDate.of(9999, 11, 30))) {
            return invalid("오늘 이후의 행사 시작일을 확인해 주세요.");
        }

        long price = review.priceWon() - discount;
        var nextReview = new PromotionReviewController.Review(review.productName(), review.priceWon(), review.costWon(),
                discount, changed ? discount * quantity : review.budgetWon(), price, price - review.costWon(), quantity);
        String reason = changed ? "이전 행사 결과의 할인 조건 재검토 제안을 바탕으로 조정한 계획이에요."
                : "이전 행사 결과의 할인 조건 유지 검토 제안을 바탕으로 만든 계획이에요.";
        var strategy = new SalesStrategies.Suggestion("PROMOTION", "다음 행사 할인 계획", "RECOMMENDED", reason,
                List.of(), List.of(), "행사 종료 후 판매량과 품목 매출총이익을 비교해요.");
        var created = planWriter.createNextPromotion(id, original, email, input.startDate(), strategy, nextReview);
        return ResponseEntity.created(URI.create("/api/plans/" + created.id())).body(created);
    }

    @PutMapping("/next-checklist")
    ResponseEntity<?> saveNextChecklist(@PathVariable UUID planId, @RequestBody ChecklistUpdate update, Principal owner) {
        var plan = find(planId, owner.getName());
        if (plan == null) return notFound();
        var comparison = comparison(plan);
        if (comparison.advice() == null) return invalid("행사 전후 POS를 모두 저장해 주세요.");
        if ((update.item() == null) != (update.completed() == null)) return invalid("점검 항목과 완료 여부를 확인해 주세요.");

        var changes = update.item() == null ? Map.of() : Map.of(update.item().name(), update.completed());
        var saved = jdbc.sql("""
                UPDATE execution_plans p
                SET promotion_impact = jsonb_set(p.promotion_impact, '{nextChecklist}',
                    COALESCE(p.promotion_impact->'nextChecklist', '{}'::jsonb) || CAST(:changes AS jsonb))
                FROM sales_analyses a, stores s, owners o
                WHERE p.id=:id AND p.strategy_code='PROMOTION' AND p.analysis_id=a.id
                  AND a.store_id=s.id AND s.owner_id=o.id AND o.email=:email
                """ + MATCH_PUBLICATION + """
                  AND p.promotion_impact->'before' IS NOT NULL AND p.promotion_impact->'after' IS NOT NULL
                  AND (:create OR p.promotion_impact->'nextChecklist' IS NOT NULL)
                RETURNING p.promotion_impact
                """)
                .param("changes", json.writeValueAsString(changes)).param("id", planId)
                .param("email", owner.getName()).param("create", update.item() == null)
                .param("published", plan.instagramPublishedAt()).param("manual", plan.manualSnapshot())
                .query(String.class).optional();
        if (saved.isEmpty()) return invalid("먼저 다음 행사 점검표를 만들어 주세요.");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(comparison(
                plan.withSnapshot(saved.get())));
    }

    private Plan find(UUID id, String email) {
        return jdbc.sql("""
                SELECT CASE WHEN p.strategy_code='PROMOTION' THEN p.promotion_review->>'productName'
                           ELSE p.promotion_draft->>'headline' END AS product,
                       p.promotion_draft->>'headline' AS draft_product,
                       p.strategy_code='PROMOTION' AS discount_promotion, p.start_date, p.end_date,
                       CASE WHEN p.instagram_publication->>'state'='PUBLISHED'
                            THEN p.instagram_publication->>'publishedAt' END AS published,
                       p.manual_promotion_publication, p.promotion_impact
                FROM execution_plans p JOIN sales_analyses a ON a.id=p.analysis_id
                JOIN stores s ON s.id=a.store_id JOIN owners o ON o.id=s.owner_id
                WHERE p.id=:id AND o.email=:email
                  AND (p.strategy_code='PROMOTION' OR (p.strategy_code='CUSTOM' AND p.strategy_snapshot @> '{"marketing":true}'))
                """).param("id", id).param("email", email)
                .query((rs, row) -> {
                    String manual = rs.getString("manual_promotion_publication");
                    var records = new EnumMap<Channel, PublicationReference>(Channel.class);
                    PublicationReference legacyManual = null;
                    if (manual != null) {
                        var tree = json.readTree(manual);
                        if (tree.has("channel")) {
                            legacyManual = json.treeToValue(tree, PublicationReference.class);
                            records.put(legacyManual.channel(), legacyManual);
                        } else {
                            for (Channel channel : Channel.values()) {
                                var entry = tree.get(channel.name());
                                if (entry != null) records.put(channel, json.treeToValue(entry, PublicationReference.class));
                            }
                        }
                    }
                    return new Plan(rs.getString("product"), rs.getString("draft_product"),
                            rs.getBoolean("discount_promotion"), rs.getObject("start_date", LocalDate.class),
                            rs.getObject("end_date", LocalDate.class), rs.getString("published"),
                            records, legacyManual, manual, rs.getString("promotion_impact"));
                }).optional().orElse(null);
    }

    private Comparison comparison(Plan plan) {
        return comparison(plan, dates.today());
    }

    private Comparison comparison(Plan plan, LocalDate today) {
        var publications = plan.publications();
        var first = publications.stream().min(Comparator.comparing(ChannelPublication::publishedDate)).orElse(null);
        if (first == null || plan.comparisonProduct() == null) {
            return unavailable(plan, publications, first, "인스타그램에 게시하거나 채널 카드에서 실제 게시일을 기록해 주세요.");
        }
        var basis = comparisonBasis(plan, plan.comparisonProduct(), first.publishedDate(), true);
        if (basis == null) {
            return unavailable(plan, publications, first, "첫 게시 다음 날부터 행사 종료일까지 비교할 날짜가 없어요.");
        }
        var stored = readSnapshot(plan);
        boolean periodsChanged = stored != null && !basis.equals(savedBasis(plan, stored));
        var snapshot = stored == null || periodsChanged ? new Snapshot(null, null, null, null, null) : stored;
        var profit = profit(snapshot.before(), snapshot.after(), snapshot.actuals());
        String message = periodsChanged ? "비교 기간이나 품목이 바뀌었어요. 새 기준에 맞는 POS를 올려 주세요." : null;
        return new Comparison(basis.productName(), first, publications, basis.before(), basis.after(),
                snapshot.before(), snapshot.after(), plan.end().isBefore(today), message,
                plan.discountPromotion() ? advice(snapshot.before(), snapshot.after(), snapshot.actuals(), profit) : null,
                snapshot.nextChecklist(), snapshot.actuals(), profit);
    }

    private Snapshot readSnapshot(Plan plan) {
        return plan.snapshot() == null ? null : json.readValue(plan.snapshot(), Snapshot.class);
    }

    private static ComparisonBasis savedBasis(Plan plan, Snapshot snapshot) {
        if (snapshot == null) return null;
        if (snapshot.basis() != null) return snapshot.basis();
        var manual = plan.legacyManual();
        if (manual != null) return comparisonBasis(plan, manual.productName(), manual.publishedDate(), true);
        var instagram = plan.instagramDate();
        return instagram == null ? null : comparisonBasis(plan, plan.product(), instagram, false);
    }

    private static ComparisonBasis comparisonBasis(Plan plan, String product, LocalDate publishedDate, boolean requirePrePosting) {
        var firstFullDay = publishedDate.plusDays(1);
        var afterStart = firstFullDay.isAfter(plan.start()) ? firstFullDay : plan.start();
        if (afterStart.isAfter(plan.end())) return null;
        long shift = (ChronoUnit.DAYS.between(plan.start(), plan.end()) / 7 + 1) * 7;
        if (requirePrePosting) {
            long daysThroughEnd = ChronoUnit.DAYS.between(publishedDate, plan.end()) + 1;
            shift = Math.max(shift, Math.ceilDiv(daysThroughEnd, 7) * 7);
        }
        return new ComparisonBasis(product,
                new Period(afterStart.minusDays(shift), plan.end().minusDays(shift)), new Period(afterStart, plan.end()));
    }

    private static Advice advice(Totals before, Totals after, Actuals actuals, Profit profit) {
        if (before == null || after == null) return null;
        NextAction action;
        if (before.recordedDays() != after.recordedDays() || before.quantity() == 0) {
            action = NextAction.CHECK_DATA;
        } else if (profit != null) {
            action = profit.changeWon() > 0 && actuals.discountedQuantity() > 0
                    ? NextAction.KEEP_TERMS : NextAction.REVIEW_TERMS;
        } else {
            action = after.amount() > before.amount() && after.quantity() > before.quantity()
                    ? NextAction.RETEST : NextAction.REVIEW_TERMS;
        }
        return new Advice(action, averagePrice(before), averagePrice(after));
    }

    private static Profit profit(Totals before, Totals after, Actuals actuals) {
        if (actuals == null || before == null || after == null) return null;
        if (actuals.beforeUnitCost() > MAX_SAFE_INTEGER / Math.max(1, before.quantity())
                || actuals.afterUnitCost() > MAX_SAFE_INTEGER / Math.max(1, after.quantity())) return null;
        long beforeProfit = before.amount() - before.quantity() * actuals.beforeUnitCost();
        long afterProfit = after.amount() - after.quantity() * actuals.afterUnitCost();
        long change = afterProfit - beforeProfit;
        return Math.abs(change) <= MAX_SAFE_INTEGER ? new Profit(beforeProfit, afterProfit, change) : null;
    }

    private static BigDecimal averagePrice(Totals totals) {
        return totals.quantity() == 0 ? null : BigDecimal.valueOf(totals.amount())
                .divide(BigDecimal.valueOf(totals.quantity()), 2, RoundingMode.HALF_UP);
    }

    private static Comparison unavailable(Plan plan, List<ChannelPublication> publications, ChannelPublication first, String message) {
        return new Comparison(plan.comparisonProduct(), first, publications, null, null, null, null,
                false, message, null, null, null, null);
    }

    private static Long wholeValue(BigDecimal value) {
        if (value == null) return null;
        try {
            return value.longValueExact();
        } catch (ArithmeticException error) {
            return null;
        }
    }

    private static boolean validTotal(Long value) {
        return value != null && value >= 0 && value <= MAX_SAFE_INTEGER;
    }

    private static ResponseEntity<ApiError> invalid(String message) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_PROMOTION_IMPACT", message, null));
    }

    private static ResponseEntity<ApiError> notFound() {
        return ResponseEntity.status(404).body(new ApiError("PROMOTION_PLAN_NOT_FOUND", "프로모션 계획을 찾을 수 없어요.", null));
    }

    enum Channel { INSTAGRAM, NAVER, DAANGN }
    record PublicationInput(Channel channel, LocalDate publishedDate, String productName) {}
    record PublicationReference(Channel channel, LocalDate publishedDate, String productName) {}
    record ChannelPublication(Channel channel, LocalDate publishedDate, boolean automatic) {}
    record ManualPublicationStatus(Map<Channel, PublicationReference> publications, String productName) {}
    enum Phase { BEFORE, AFTER }
    record Upload(Phase phase, LocalDate start, LocalDate end, Long quantity, Long amount, Integer recordedDays,
                  String productName, Boolean onlyIfMissing) {}
    record Totals(long quantity, long amount, int recordedDays) {}
    record Period(LocalDate start, LocalDate end) {}
    enum NextAction { RETEST, KEEP_TERMS, REVIEW_TERMS, CHECK_DATA }
    enum ChecklistItem { DISCOUNT_QUANTITY, ACTUAL_COST, UPLOAD_POS }
    record ChecklistUpdate(ChecklistItem item, Boolean completed) {}
    record Advice(NextAction action, BigDecimal beforeAveragePrice, BigDecimal afterAveragePrice) {}
    record NextPlanInput(NextAction action, LocalDate startDate, BigDecimal discountWon, BigDecimal maxDiscountQuantity) {}
    record ActualsInput(BigDecimal discountedQuantity, BigDecimal beforeUnitCost, BigDecimal afterUnitCost) {}
    record Actuals(Long discountedQuantity, Long beforeUnitCost, Long afterUnitCost) {}
    record Profit(long beforeWon, long afterWon, long changeWon) {}
    record ExplanationInput(Totals before, Totals after, Advice advice, Actuals actuals, Profit profit) {}
    record Explanation(ExplanationInput input, String explanation) {}
    record ComparisonBasis(String productName, Period before, Period after) {}
    record ArchiveStatus(ComparisonBasis basis, Period gap) {}
    record Snapshot(Totals before, Totals after, Map<ChecklistItem, Boolean> nextChecklist, Actuals actuals, ComparisonBasis basis) {}
    record Comparison(String productName, ChannelPublication publication, List<ChannelPublication> publications,
                      Period before, Period after, Totals beforeTotals, Totals afterTotals,
                      boolean afterReady, String message, Advice advice,
                      Map<ChecklistItem, Boolean> nextChecklist, Actuals actuals, Profit profit) {}
    private record Plan(String product, String draftProduct, boolean discountPromotion, LocalDate start, LocalDate end,
                        String instagramPublishedAt, Map<Channel, PublicationReference> manualPublications,
                        PublicationReference legacyManual, String manualSnapshot, String snapshot) {
        String comparisonProduct() {
            return manualPublications.values().stream().findFirst().map(PublicationReference::productName).orElse(product);
        }

        LocalDate instagramDate() {
            if (instagramPublishedAt == null) return null;
            return OffsetDateTime.parse(instagramPublishedAt).atZoneSameInstant(SEOUL).toLocalDate();
        }

        List<ChannelPublication> publications() {
            var values = new ArrayList<ChannelPublication>();
            var instagram = instagramDate();
            if (instagram != null) values.add(new ChannelPublication(Channel.INSTAGRAM, instagram, true));
            for (var entry : manualPublications.values()) {
                values.add(new ChannelPublication(entry.channel(), entry.publishedDate(), false));
            }
            return values;
        }

        Plan withSnapshot(String updated) {
            return new Plan(product, draftProduct, discountPromotion, start, end, instagramPublishedAt,
                    manualPublications, legacyManual, manualSnapshot, updated);
        }
    }
}
