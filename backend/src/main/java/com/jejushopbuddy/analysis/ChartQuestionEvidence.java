package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.ExecutionResultWriter.Metric;
import com.jejushopbuddy.analysis.ExecutionResultWriter.Period;
import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesAnalysisController.ProductSale;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSlot;
import com.jejushopbuddy.analysis.SalesStrategies.Response;
import com.jejushopbuddy.analysis.StrategyAgentClient.GuideResponse;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@Component
class ChartQuestionEvidence {
    private static final int MAX_AGENT_FACTS = 200;
    private static final int MAX_TIME_FACTS = 120;
    private static final int MAX_ITEM_FACTS = 40;
    private static final Pattern ITEM_DECLINE = Pattern.compile("줄(?:었|어[든들])|감소|떨어(?:졌|진)|하락");
    private static final Pattern ITEM_INCREASE = Pattern.compile("늘(?:었|어[나난났날남])|증가|오른|올랐|상승");
    private static final Pattern ITEM_REVENUE = Pattern.compile("매출|실판매금액");
    private static final List<PosTimeBand> POS_TIME_BANDS = List.of(
            new PosTimeBand("오후 2시 전", 0, 14),
            new PosTimeBand("오후 2~5시", 14, 17),
            new PosTimeBand("오후 5시 이후", 17, 24));

    private final JdbcClient jdbc;
    private final SalesAnalysisReader analyses;
    private final ObjectMapper json;
    private final JejuMarketContext market;
    private final SalesStrategies strategies;
    private final StrategyAgentClient agent;
    private final StoreReviewService reviews;
    private final ExecutionPlanReader plans;
    private final ExecutionResultReader results;

    ChartQuestionEvidence(JdbcClient jdbc, SalesAnalysisReader analyses, ObjectMapper json,
                          JejuMarketContext market, SalesStrategies strategies,
                          StrategyAgentClient agent, StoreReviewService reviews, ExecutionPlanReader plans,
                          ExecutionResultReader results) {
        this.jdbc = jdbc;
        this.analyses = analyses;
        this.json = json;
        this.market = market;
        this.strategies = strategies;
        this.agent = agent;
        this.reviews = reviews;
        this.plans = plans;
        this.results = results;
    }

    Snapshot forAnalysis(AnalysisResponse analysis, String owner, UUID selectedPlan, String question, Set<String> focus) {
        var snapshot = new Snapshot(new LinkedHashMap<>(), new java.util.ArrayList<>());
        var store = market.forStore(analysis.storeId(), analysis.beforeMonth(), analysis.afterMonth());
        var context = store.context();
        snapshot.add(metric(analysis, "monthly", "MONTHLY_SALES", "매장 월별 매출", "해당 매장", "KRW",
                SalesStrategies.amountFor(analysis, analysis.beforeMonth()), SalesStrategies.amountFor(analysis, analysis.afterMonth()),
                "저장된 매장 매출", null));
        if (context.card() != null) {
            snapshot.add(metric(analysis, "market", "MARKET_CARD_SALES", "상권 카드 이용액",
                    store.area() + " · 같은 업종", "KRW", context.card().before(), context.card().after(),
                    "제주데이터허브", "https://data.edmgr.kr/dataView.do?id=jejudatahub-net-748"));
        }
        if (context.bsi() != null) {
            var sources = context.bsiSources();
            var source = sources.getLast();
            snapshot.add(metric(analysis, "bsi", "JEJU_BSI", "소상공인 경기 체감지수", "제주 전체", "INDEX",
                    context.bsi().before(), context.bsi().after(), source.label(), source.url()));
        }
        var fingerprint = agent.fingerprintFor(analysis);
        var recommendation = jdbc.sql("""
                SELECT snapshot FROM strategy_recommendations WHERE analysis_id = :id AND input_fingerprint = :fingerprint
                ORDER BY created_at DESC, id DESC LIMIT 1
                """).param("id", analysis.id()).param("fingerprint", fingerprint)
                .query((rs, row) -> json.readValue(rs.getString(1), Response.class)).optional()
                .orElseGet(() -> strategies.from(analysis));
        var timeReferences = new HashSet<String>();
        for (var strategy : recommendation.strategies()) {
            var evidence = fact("strategy-" + strategy.code(), "STRATEGY", strategy.title(),
                    "AGENT".equals(recommendation.recommendationSource()) ? "저장된 AI 추천" : "기본 대응 전략", null)
                    .put("code", strategy.code()).put("reason", strategy.reason());
            var ids = evidence.putArray("evidenceIds");
            for (var item : strategy.evidence()) {
                if ("TIME_SERIES".equals(item.source()) && item.label() != null) {
                    String id = timeId(item.label());
                    timeReferences.add(id);
                    ids.add(id);
                    continue;
                }
                snapshot.facts().values().stream().filter(value -> item.source().equals(value.path("metric").asString()))
                        .findFirst().ifPresent(value -> ids.add(value.path("id").asString()));
            }
            snapshot.add(evidence);
            snapshot.allow("OPEN_STRATEGY", strategy.code());
        }
        // Broader card consumption is available for questions without replacing exact strategy evidence.
        var reference = context.cardReference();
        if (context.card() == null && reference != null) {
            snapshot.add(metric(analysis, "market-reference", "MARKET_CARD_SALES", reference.scope(), reference.scope(),
                    "KRW", reference.before(), reference.after(), reference.source().label(), reference.source().url()));
        }
        jdbc.sql("""
                SELECT DISTINCT ON (strategy_code) strategy_code, snapshot
                FROM execution_guide_snapshots
                WHERE analysis_id = :id AND input_fingerprint = :fingerprint
                    AND snapshot->>'status' IN ('OK', 'CURATED_FALLBACK')
                ORDER BY strategy_code, created_at DESC, id DESC
                """).param("id", analysis.id()).param("fingerprint", fingerprint)
                .query((rs, row) -> new SavedGuide(rs.getString(1), json.readValue(rs.getString(2), GuideResponse.class)))
                .list().forEach(guide -> addGuide(snapshot, guide.code(), guide.guide()));

        var planIds = jdbc.sql("""
                SELECT id FROM execution_plans WHERE analysis_id = :id
                ORDER BY (id = CAST(:selected AS uuid)) DESC NULLS LAST, created_at DESC, id DESC LIMIT 20
                """).param("id", analysis.id()).param("selected", selectedPlan).query(UUID.class).list();
        for (var id : planIds) {
            plans.find(id, owner).ifPresent(plan -> {
                var strategy = plan.strategy();
                snapshot.add(fact("plan-" + id, "PLAN", strategy.title(), "저장된 실행 계획", null)
                        .put("planId", id.toString()).put("strategyCode", strategy.code())
                        .put("completed", plan.checklist().stream().filter(ExecutionPlanWriter.ChecklistItem::completed).count())
                        .put("total", plan.checklist().size()).put("startDate", plan.startDate().toString())
                        .put("endDate", plan.endDate().toString()));
                if (strategy.executionGuide() != null) addGuide(snapshot, strategy.code(), strategy.executionGuide());
                snapshot.allow("SELECT_PLAN", id.toString());
                snapshot.allow("OPEN_PLAN_RESULTS", id.toString());
                results.findLatest(id, owner).map(ExecutionResultReader.LatestResult::result).ifPresent(result -> {
                    var evidence = fact("result-" + result.id(), "RESULT", "실행 전후 비교", "저장된 실행 결과", null)
                            .put("planId", id.toString()).put("scope", result.scope());
                    evidence.set("before", period(result.before()));
                    evidence.set("after", period(result.after()));
                    if (result.comparison().amount() != null) evidence.set("dailyAverageSales", daily(result.comparison().amount(), "KRW"));
                    if (result.comparison().count() != null) evidence.set("dailyAveragePayments", daily(result.comparison().count(), "COUNT"));
                    snapshot.add(evidence);
                });
            });
        }
        addItemFacts(snapshot, analysis, question, focus);
        addTimeFacts(snapshot, analysis, analyses.findHourlySales(analysis.id(), owner).map(json::readTree).orElse(null),
                question, focus, timeReferences);
        snapshot.allow("ADD_TIME_SERIES", "AMOUNT");
        snapshot.allow("ADD_TIME_SERIES", "COUNT");
        snapshot.allow("OPEN_REVIEWS", "ALL");
        for (var topic : ReviewTopic.values()) snapshot.allow("OPEN_REVIEWS", topic.name());
        for (var entry : reviews.classified(analysis.storeId())) {
            var review = entry.review();
            for (var topic : entry.topics()) {
                if (snapshot.facts().size() >= MAX_AGENT_FACTS) return snapshot;
                snapshot.add(fact("review-" + review.id() + "-" + topic, "REVIEW", "매장 리뷰", "매장 등록 리뷰", null)
                        .put("date", review.date().toString()).put("topic", topic.name()).put("excerpt", review.text()));
            }
        }
        return snapshot;
    }

    private void addItemFacts(Snapshot snapshot, AnalysisResponse analysis, String question, Set<String> focus) {
        String normalizedQuestion = compact(question);
        boolean declining = ITEM_DECLINE.matcher(normalizedQuestion).find() && !ITEM_INCREASE.matcher(normalizedQuestion).find();
        var priority = Comparator.comparingInt((ProductSale item) -> {
            if (normalizedQuestion.contains(compact(item.productName()))) return 0;
            var id = itemId(item.productName());
            return !declining && (focus.contains(id + "-quantity") || focus.contains(id + "-revenue")) ? 1 : 2;
        });
        var revenueChange = Comparator.comparingLong((ProductSale item) ->
                item.beforeRevenue() != null && item.afterRevenue() != null
                        ? item.afterRevenue() - item.beforeRevenue() : (declining ? Long.MAX_VALUE : Long.MIN_VALUE));
        var quantityChange = Comparator.comparingLong((ProductSale item) -> item.after() - item.before());
        var changeOrder = declining
                ? (ITEM_REVENUE.matcher(normalizedQuestion).find()
                    ? revenueChange.thenComparing(quantityChange) : quantityChange.thenComparing(revenueChange))
                : revenueChange.reversed().thenComparing(quantityChange.reversed());
        int limit = Math.min(MAX_ITEM_FACTS, snapshot.remaining());
        analysis.productSales().stream().sorted(priority.thenComparing(changeOrder)).limit(limit / 2).forEach(item -> {
            var id = itemId(item.productName());
            snapshot.add(metric(analysis, id + "-quantity", "ITEM_SALES", item.productName(), "해당 매장", "QUANTITY",
                    item.before(), item.after(), "저장된 품목별 판매 자료", null));
            if (item.beforeRevenue() != null && item.afterRevenue() != null) {
                snapshot.add(metric(analysis, id + "-revenue", "ITEM_SALES", item.productName(), "해당 매장", "KRW",
                        item.beforeRevenue(), item.afterRevenue(), "저장된 품목별 판매 자료", null));
            }
        });
    }

    List<ObjectNode> concernTimeFacts(AnalysisResponse analysis, JsonNode hourly) {
        var snapshot = new Snapshot(new LinkedHashMap<>(), List.of());
        addTimeFacts(snapshot, analysis, hourly, analysis.concern(), Set.of(), Set.of());
        return List.copyOf(snapshot.facts().values());
    }

    private void addTimeFacts(Snapshot snapshot, AnalysisResponse analysis, JsonNode hourly, String question,
                              Set<String> focus, Set<String> references) {
        var series = analysis.timeSeries();
        if (hourly != null) {
            var before = hourly.path(analysis.beforeMonth());
            var after = hourly.path(analysis.afterMonth());
            if (before.isArray() && before.size() == 24 && after.isArray() && after.size() == 24) {
                addPosTimeFacts(snapshot, analysis, before, after);
            }
        }
        if (series == null || series.rows().isEmpty()) return;
        var byDrop = Comparator.comparingLong((TimeSlot slot) -> slot.after() - slot.before());
        var largestDrop = series.rows().stream().min(byDrop).orElseThrow();
        var largestIncrease = series.rows().stream().max(byDrop).orElseThrow();
        // Keep cited and named slots as well as the largest changes in both directions.
        var ordered = Comparator.comparingInt((TimeSlot slot) -> {
            if (slot.equals(largestDrop) || slot.equals(largestIncrease)) return 0;
            if (references.contains(timeId(slot.label()))) return 1;
            if (question.contains(slot.label()) || focus.contains(timeId(slot.label()))) return 2;
            return 3;
        }).thenComparing(byDrop);
        int limit = Math.min(MAX_TIME_FACTS, snapshot.remaining());
        var unit = "COUNT".equals(series.metric()) ? "COUNT" : "KRW";
        series.rows().stream().sorted(ordered).limit(limit).forEach(slot -> snapshot.add(
                metric(analysis, timeId(slot.label()), "TIME_SERIES", slot.label(), "해당 매장",
                        unit, slot.before(), slot.after(), "저장된 시간대별 자료", null)));
    }

    private void addPosTimeFacts(Snapshot snapshot, AnalysisResponse analysis, JsonNode before, JsonNode after) {
        var series = analysis.timeSeries();
        for (var band : POS_TIME_BANDS) {
            for (String field : List.of("count", "amount")) {
                if (snapshot.facts().size() >= MAX_AGENT_FACTS) return;
                String unit = "count".equals(field) ? "COUNT" : "KRW";
                boolean hasSavedSlot = series != null && ("COUNT".equals(series.metric()) == "count".equals(field))
                        && series.rows().stream().anyMatch(slot -> slot.label().equals(band.label()));
                if (hasSavedSlot) continue;
                var id = timeId(band.label()) + "-" + field;
                snapshot.add(metric(analysis, id, "TIME_SERIES", band.label(), "해당 매장", unit,
                        band.total(before, field), band.total(after, field), "저장된 결제 POS 시간대별 집계", null));
            }
        }
    }

    private static String compact(String value) {
        return value.replaceAll("\\s+", "");
    }

    private static String itemId(String name) {
        return "item-" + UUID.nameUUIDFromBytes(name.getBytes(StandardCharsets.UTF_8));
    }

    private static String timeId(String label) {
        return "time-" + UUID.nameUUIDFromBytes(label.getBytes(StandardCharsets.UTF_8));
    }

    private void addGuide(Snapshot snapshot, String code, GuideResponse guide) {
        if (snapshot.facts().containsKey("guide-" + code + "-0-0") || guide.sources().isEmpty()) return;
        int stepIndex = 0;
        boolean added = false;
        for (var step : guide.steps()) {
            int sourceIndex = 0;
            for (var source : guide.sources()) {
                if (!step.sourceIds().contains(source.id())) continue;
                snapshot.add(fact("guide-" + code + "-" + stepIndex + "-" + sourceIndex++, "GUIDE", source.title(),
                        source.publisher(), source.url()).put("strategyCode", code)
                        .put("action", step.text()).put("when", step.when()));
                added = true;
            }
            stepIndex++;
        }
        if (added && !snapshot.actions().contains(new Action("OPEN_EXECUTION_GUIDE", code))) snapshot.allow("OPEN_EXECUTION_GUIDE", code);
    }

    private ObjectNode metric(AnalysisResponse analysis, String id, String metric, String title, String scope,
                              String unit, Number before, Number after, String source, String url) {
        var value = fact(id, "METRIC", title, source, url).put("metric", metric)
                .put("scope", scope).put("unit", unit);
        if (!"ITEM_SALES".equals(metric)) value.put("chart", metric);
        value.set("before", json.valueToTree(before));
        value.set("after", json.valueToTree(after));
        value.putObject("period").put("before", analysis.beforeMonth()).put("after", analysis.afterMonth());
        return value;
    }

    private ObjectNode fact(String id, String kind, String label, String source, String url) {
        var value = json.createObjectNode().put("id", id).put("kind", kind).put("label", label);
        value.putObject("source").put("label", source).put("url", url);
        return value;
    }

    private ObjectNode period(Period period) {
        return json.createObjectNode().put("start", period.start().toString()).put("end", period.end().toString())
                .put("businessDays", period.days());
    }

    private ObjectNode daily(Metric metric, String unit) {
        return json.createObjectNode().put("before", metric.beforeDailyAverage()).put("after", metric.afterDailyAverage())
                .put("unit", unit).put("changePercent", metric.changeRatePercent());
    }

    record Action(String type, String targetId) {}
    private record PosTimeBand(String label, int startHour, int endHour) {
        long total(JsonNode hours, String field) {
            long total = 0;
            for (int hour = startHour; hour < endHour; hour++) total += hours.path(hour).path(field).asLong();
            return total;
        }
    }
    private record SavedGuide(String code, GuideResponse guide) {}
    record Snapshot(LinkedHashMap<String, ObjectNode> facts, List<Action> actions) {
        int remaining() { return Math.max(0, MAX_AGENT_FACTS - facts.size()); }
        void add(ObjectNode fact) { facts.put(fact.path("id").asString(), fact); }
        void allow(String type, String target) { actions.add(new Action(type, target)); }
    }
}
