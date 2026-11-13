package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesStrategies.Evidence;
import com.jejushopbuddy.analysis.SalesStrategies.Response;
import com.jejushopbuddy.analysis.SalesStrategies.Suggestion;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Service
final class StrategyAgentClient {
    private static final Logger LOG = LoggerFactory.getLogger(StrategyAgentClient.class);
    private static final String VERSION = "1.0";
    private static final Map<String, String> TITLES = Map.of(
            "OUTREACH", "주문 안내 점검하기", "PROMOTION", "시간대 한정 혜택 검토하기", "INVENTORY", "발주량 검토하기");
    private static final Map<String, String> INPUT_LABELS = Map.of(
            "TIME_SERIES", "시간대별 매출 또는 결제 건수",
            "ITEM_PRICE_AND_ORDER_COST", "메뉴별 판매가와 주문당 비용",
            "DISCOUNT_BUDGET", "할인 예산 한도",
            "ON_HAND_STOCK", "품목별 현재 재고",
            "EXPECTED_USAGE", "다음 입고까지 예상 사용량",
            "INCOMING_STOCK", "입고 예정량");

    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(1)).build();
    private final ObjectMapper json;
    private final JejuMarketContext market;
    private final String baseUrl;

    StrategyAgentClient(ObjectMapper json, JejuMarketContext market,
                        @Value("${shop-buddy.strategy-agent-url:}") String baseUrl) {
        this.json = json;
        this.market = market;
        this.baseUrl = baseUrl.strip().replaceFirst("/+$", "");
    }

    Optional<Generated> recommend(AnalysisResponse analysis) {
        if (baseUrl.isEmpty()) return Optional.empty();
        try {
            var input = input(analysis);
            var facts = new LinkedHashMap<String, Fact>();
            input.evidence().forEach(fact -> facts.put(fact.id(), fact));
            String fingerprint = fingerprint(json.writeValueAsString(input));
            var request = new AgentRequest(VERSION, analysis.id(), fingerprint, input);
            return post("/internal/strategy-recommendations", request, AgentResponse.class)
                    .map(result -> new Generated(fingerprint, mapResponse(analysis, fingerprint, input.strategies(), facts, result,
                            market.forStore(analysis.storeId(), analysis.beforeMonth(), analysis.afterMonth()).context().bsiSources())));
        } catch (JacksonException | IllegalArgumentException error) {
            LOG.debug("Strategy Agent unavailable or invalid ({})", error.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    Optional<GuideResponse> executionGuide(AnalysisResponse analysis, Suggestion strategy, String channel) {
        if (baseUrl.isEmpty()) return Optional.empty();
        var store = market.forStore(analysis.storeId(), analysis.beforeMonth(), analysis.afterMonth());
        var focus = strategy.evidence().stream()
                .filter(item -> "TIME_SERIES".equals(item.source()) && hasText(item.label())
                        && item.before().compareTo(item.after()) > 0)
                .max(Comparator.comparing(item -> item.before().subtract(item.after())))
                .map(item -> new GuideFocus(item.label(), item.metric())).orElse(null);
        var request = new GuideRequest(VERSION, strategy.code(), store.industryCode(), channel, focus, "UNKNOWN");
        return post("/internal/execution-guide", request, GuideResponse.class).filter(StrategyAgentClient::validGuide);
    }

    Optional<tools.jackson.databind.JsonNode> chartQuestion(Object payload) {
        return baseUrl.isEmpty() ? Optional.empty()
                : post("/internal/chart-questions", payload, tools.jackson.databind.JsonNode.class);
    }

    Optional<tools.jackson.databind.JsonNode> concernCheck(Object payload) {
        return baseUrl.isEmpty() ? Optional.empty()
                : post("/internal/concern-check", payload, tools.jackson.databind.JsonNode.class);
    }

    Optional<StoreNoticeController.Draft> storeNotice(StoreNoticeController.AgentInput input) {
        if (baseUrl.isEmpty()) return Optional.empty();
        return post("/internal/store-notice", input, StoreNoticeController.Draft.class)
                .filter(draft -> hasText(draft.title()) && hasText(draft.message()));
    }

    Optional<MenuCostController.ReceiptDraft> receipt(MenuCostController.ReceiptInput input) {
        return baseUrl.isEmpty() ? Optional.empty()
                : post("/internal/receipt", input, MenuCostController.ReceiptDraft.class, Duration.ofSeconds(35));
    }

    Optional<String> nextPromotionExplanation(PromotionImpactController.ExplanationInput input) {
        if (baseUrl.isEmpty()) return Optional.empty();
        return post("/internal/next-promotion-explanation", input, NextPromotionResponse.class)
                .map(NextPromotionResponse::explanation).map(String::strip)
                .filter(line -> !line.isBlank() && line.length() <= 360
                        && !line.matches("(?s).*[\\p{N}\\p{Cntrl}].*"));
    }

    private record NextPromotionResponse(String explanation) {}

    Optional<PromotionDraftController.ReviewResearch> promotionReviewPoints(PromotionDraftController.ReviewSearch input) {
        if (baseUrl.isEmpty()) return Optional.empty();
        return post("/internal/promotion-review-points", input, PromotionDraftController.ReviewResearch.class, Duration.ofSeconds(105))
                .filter(result -> result.sources() != null && result.points() != null
                        && result.sources().size() <= 5 && result.points().size() <= 5);
    }

    Optional<PromotionDraftController.ChannelDrafts> promotionChannels(PromotionDraftController.ChannelInput input) {
        if (baseUrl.isEmpty()) return Optional.empty();
        return post("/internal/promotion-channels", input, PromotionDraftController.ChannelDrafts.class, Duration.ofSeconds(105))
                .filter(result -> result.findings() != null && (result.drafts() == null || (hasText(result.drafts().instagram())
                        && hasText(result.drafts().naver()) && hasText(result.drafts().daangn()))));
    }

    private <T> Optional<T> post(String path, Object payload, Class<T> type) {
        return post(path, payload, type, Duration.ofSeconds(13));
    }

    private <T> Optional<T> post(String path, Object payload, Class<T> type, Duration timeout) {
        try {
            var request = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(timeout)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload)))
                    .build();
            var response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) {
                LOG.debug("Strategy Agent returned HTTP {} for {}", response.statusCode(), path);
                return Optional.empty();
            }
            return Optional.ofNullable(json.readValue(response.body(), type));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (IOException | JacksonException | IllegalArgumentException error) {
            LOG.debug("Strategy Agent unavailable for {} ({})", path, error.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    private static boolean validGuide(GuideResponse guide) {
        if (!VERSION.equals(guide.schemaVersion()) || guide.status() == null
                || !Set.of("OK", "NO_RELEVANT_GUIDE", "CURATED_FALLBACK").contains(guide.status())
                || guide.steps() == null || guide.sources() == null) return false;
        var sourceIds = new HashSet<String>();
        for (var source : guide.sources()) {
            if (source == null || !hasText(source.id()) || !sourceIds.add(source.id())
                    || !hasText(source.title()) || !hasText(source.url())) return false;
            try {
                var url = URI.create(source.url());
                if (!"https".equals(url.getScheme()) || !"help.naver.com".equals(url.getHost())
                        || url.getUserInfo() != null) return false;
            } catch (IllegalArgumentException error) {
                return false;
            }
        }
        var cited = new HashSet<String>();
        for (var step : guide.steps()) {
            if (step == null || !hasText(step.text()) || step.sourceIds() == null) return false;
            boolean official = "OFFICIAL_GUIDE".equals(step.kind());
            if ((!official && !"STORE_CHECK".equals(step.kind())) || official == step.sourceIds().isEmpty()
                    || !sourceIds.containsAll(step.sourceIds())) return false;
            cited.addAll(step.sourceIds());
        }
        return sourceIds.equals(cited) && ("NO_RELEVANT_GUIDE".equals(guide.status()) == sourceIds.isEmpty());
    }

    String fingerprintFor(AnalysisResponse analysis) {
        return fingerprint(json.writeValueAsString(input(analysis)));
    }

    private Input input(AnalysisResponse analysis) {
        var store = market.forStore(analysis.storeId(), analysis.beforeMonth(), analysis.afterMonth());
        var context = store.context();
        return new Input(new Store(store.area(), store.industryCode()),
                new Period(analysis.beforeMonth(), analysis.afterMonth()),
                analysis.concern() == null ? "" : analysis.concern(),
                new Availability("AVAILABLE", availability(analysis.timeSeries()),
                        availability(context.card()), availability(context.bsi())),
                List.copyOf(facts(analysis, context).values()), candidates(analysis.timeSeries() != null));
    }

    private static Map<String, Fact> facts(AnalysisResponse analysis, JejuMarketContext.Context context) {
        var facts = new LinkedHashMap<String, Fact>();
        facts.put("e1", new Fact("e1", "MONTHLY_SALES", "STORE", "STORE_RECORDED", null, "KRW",
                BigDecimal.valueOf(SalesStrategies.amountFor(analysis, analysis.beforeMonth())),
                BigDecimal.valueOf(SalesStrategies.amountFor(analysis, analysis.afterMonth()))));
        if (analysis.timeSeries() != null) {
            var series = analysis.timeSeries();
            String unit = series.metric().equals("COUNT") ? "COUNT" : "KRW";
            for (int i = 0; i < series.rows().size(); i++) {
                var slot = series.rows().get(i);
                String id = i == 0 ? "e2" : "e2-" + (i + 1);
                facts.put(id, new Fact(id, "TIME_SERIES", "STORE", "STORE_RECORDED", slot.label(), unit,
                        BigDecimal.valueOf(slot.before()), BigDecimal.valueOf(slot.after())));
            }
        }
        if (context.card() != null) {
            facts.put("e3", new Fact("e3", "MARKET_CARD_SALES", "AREA_AND_INDUSTRY", "JEJU_DATAHUB",
                    null, "KRW", context.card().before(), context.card().after()));
        }
        if (context.bsi() != null) {
            facts.put("e4", new Fact("e4", "JEJU_BSI", "JEJU", "SEMAS_BSI", null, "INDEX",
                    context.bsi().before(), context.bsi().after()));
        }
        return facts;
    }

    private static List<Candidate> candidates(boolean hasTimeSeries) {
        var promotion = new ArrayList<String>();
        if (!hasTimeSeries) promotion.add("TIME_SERIES");
        promotion.addAll(List.of("ITEM_PRICE_AND_ORDER_COST", "DISCOUNT_BUDGET"));
        return List.of(new Candidate("OUTREACH", "AVAILABLE", List.of()),
                new Candidate("PROMOTION", "NEEDS_INPUT", promotion),
                new Candidate("INVENTORY", "NEEDS_INPUT", List.of("ON_HAND_STOCK", "EXPECTED_USAGE", "INCOMING_STOCK")),
                new Candidate("CUSTOM", "AVAILABLE", List.of()));
    }

    private static Response mapResponse(AnalysisResponse analysis, String fingerprint, List<Candidate> candidates,
                                        Map<String, Fact> facts, AgentResponse response, List<JejuMarketContext.Source> bsiSources) {
        require(response != null && VERSION.equals(response.schemaVersion()) && analysis.id().equals(response.analysisId())
                && fingerprint.equals(response.inputFingerprint()) && "OK".equals(response.status())
                && response.requiredInputs() != null && response.requiredInputs().isEmpty()
                && response.recommendations() != null && !response.recommendations().isEmpty()
                && response.recommendations().size() <= 12);
        var contextIds = facts.values().stream().filter(fact -> fact.type().equals("JEJU_BSI")).map(Fact::id).toList();
        require(contextIds.equals(response.contextEvidenceIds()));
        var seen = new HashSet<String>();
        var customTitles = new HashSet<String>();
        var suggestions = new ArrayList<Suggestion>();
        for (var card : response.recommendations()) {
            require(card != null && ("CUSTOM".equals(card.strategyCode()) || seen.add(card.strategyCode())));
            var candidate = candidates.stream().filter(item -> item.code().equals(card.strategyCode()))
                    .findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown strategy"));
            require(candidate.status().equals(card.status()) || (suggestions.isEmpty()
                    && "AVAILABLE".equals(candidate.status()) && "RECOMMENDED".equals(card.status())));
            require(candidate.missingInputs().equals(card.missingInputs()) && hasText(card.reason())
                    && hasText(card.nextAction()) && hasText(card.followUp()) && card.evidenceIds() != null
                    && !card.evidenceIds().isEmpty() && new HashSet<>(card.evidenceIds()).size() == card.evidenceIds().size());
            var evidence = card.evidenceIds().stream().map(id -> {
                var fact = facts.get(id);
                require(fact != null && allowedEvidence(candidate.code(), fact.type()));
                return fact.toEvidence();
            }).toList();
            boolean custom = candidate.code().equals("CUSTOM");
            var steps = card.steps() == null ? List.<String>of() : card.steps();
            if (custom) {
                require(singleLine(card.title(), 80) && customTitles.add(card.title().strip())
                        && steps.size() >= 2 && steps.size() <= 4 && new HashSet<>(steps).size() == steps.size()
                        && steps.stream().allMatch(step -> singleLine(step, 150)));
            }
            suggestions.add(new Suggestion(candidate.code(), custom ? card.title().strip() : TITLES.get(candidate.code()),
                    card.status(), card.reason(),
                    evidence, candidate.missingInputs().stream().map(INPUT_LABELS::get).toList(),
                    card.followUp(), null, null, card.nextAction(), null, null, null, custom ? steps : null,
                    custom && Boolean.TRUE.equals(card.marketing()) ? Boolean.TRUE : null));
        }
        return new Response(analysis.id(), analysis.beforeMonth(), analysis.afterMonth(), List.copyOf(suggestions),
                "AGENT", contextIds.stream().map(facts::get).map(fact ->
                        new Evidence(fact.type(), fact.unit(), fact.label(), fact.before(), fact.after(), bsiSources)).toList());
    }

    private static boolean allowedEvidence(String code, String type) {
        return switch (code) {
            case "OUTREACH", "CUSTOM" -> Set.of("MONTHLY_SALES", "TIME_SERIES", "MARKET_CARD_SALES").contains(type);
            case "PROMOTION" -> Set.of("MONTHLY_SALES", "TIME_SERIES").contains(type);
            default -> "MONTHLY_SALES".equals(type);
        };
    }

    private static void require(boolean valid) {
        if (!valid) throw new IllegalArgumentException("Invalid strategy recommendation");
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static boolean singleLine(String value, int limit) {
        return hasText(value) && value.length() <= limit && value.codePoints().noneMatch(Character::isISOControl);
    }

    private static String availability(Object value) {
        return value == null ? "MISSING" : "AVAILABLE";
    }

    private static String fingerprint(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private record Store(String area, String industryCode) {}
    private record Period(String beforeMonth, String afterMonth) {}
    private record Availability(String monthlySales, String timeSeries, String marketCardSales, String jejuBsi) {}
    private record Candidate(String code, String status, List<String> missingInputs) {}
    private record Change(String unit, BigDecimal value) {}
    private record Fact(String id, String type, String scope, String source, String label, String unit,
                        BigDecimal before, BigDecimal after) {
        @com.fasterxml.jackson.annotation.JsonProperty
        Change change() {
            var difference = after.subtract(before);
            if (unit.equals("INDEX")) return new Change("INDEX_POINT", difference);
            return new Change("PERCENT", before.signum() == 0 ? null
                    : difference.movePointRight(2).divide(before, 2, RoundingMode.HALF_UP));
        }

        Evidence toEvidence() {
            return new Evidence(type, unit.equals("KRW") ? "AMOUNT" : unit, label, before, after);
        }
    }
    private record Input(Store store, Period period, String concern, Availability availability,
                         List<Fact> evidence, List<Candidate> strategies) {}
    private record AgentRequest(String schemaVersion, UUID analysisId, String inputFingerprint,
                                @com.fasterxml.jackson.annotation.JsonUnwrapped Input input) {}
    private record AgentResponse(String schemaVersion, UUID analysisId, String inputFingerprint, String status,
                                 List<String> contextEvidenceIds, List<String> requiredInputs, List<AgentCard> recommendations) {}
    private record AgentCard(String strategyCode, String status, String reason, List<String> evidenceIds,
                             List<String> missingInputs, String nextAction, String followUp, String title, List<String> steps,
                             Boolean marketing) {}

    record Generated(String inputFingerprint, Response response) {}

    private record GuideFocus(String label, String metric) {}
    private record GuideRequest(String schemaVersion, String strategyCode, String industryCode, String channel,
                                @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
                                GuideFocus focus, String naverReservationOrOrder) {}
    record GuideResponse(String schemaVersion, String status, String message, List<GuideStep> steps,
                         List<GuideSource> sources, UUID guideId, String channel) {
        GuideResponse withSnapshot(UUID id, String channel) {
            return new GuideResponse(schemaVersion, status, message, steps, sources, id, channel);
        }
    }
    record GuideStep(String kind, String text, String when, List<String> sourceIds) {}
    record GuideSource(String id, String title, String publisher, String url, int revision) {}
}
