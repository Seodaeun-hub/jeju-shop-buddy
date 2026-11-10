package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.ExecutionResultWriter.Metric;
import com.jejushopbuddy.analysis.ExecutionResultWriter.Period;
import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesStrategies.Response;
import com.jejushopbuddy.analysis.StrategyAgentClient.GuideResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@Component
class ChartQuestionEvidence {
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final JejuMarketContext market;
    private final SalesStrategies strategies;
    private final StrategyAgentClient agent;
    private final StoreReviewService reviews;
    private final ExecutionPlanReader plans;
    private final ExecutionResultReader results;

    ChartQuestionEvidence(JdbcClient jdbc, ObjectMapper json, JejuMarketContext market, SalesStrategies strategies,
                          StrategyAgentClient agent, StoreReviewService reviews, ExecutionPlanReader plans,
                          ExecutionResultReader results) {
        this.jdbc = jdbc;
        this.json = json;
        this.market = market;
        this.strategies = strategies;
        this.agent = agent;
        this.reviews = reviews;
        this.plans = plans;
        this.results = results;
    }

    Snapshot forAnalysis(AnalysisResponse analysis, String owner, UUID selectedPlan) {
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
            snapshot.add(metric(analysis, "bsi", "JEJU_BSI", "소상공인 경기 체감지수", "제주 전체", "INDEX",
                    context.bsi().before(), context.bsi().after(), "소상공인시장진흥공단",
                    "https://www.data.go.kr/data/3060077/fileData.do"));
        }
        if (analysis.timeSeries() != null) {
            for (var slot : analysis.timeSeries().rows()) {
                String id = "time-" + UUID.nameUUIDFromBytes(slot.label().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                snapshot.add(metric(analysis, id, "TIME_SERIES", slot.label(), "해당 매장",
                        "COUNT".equals(analysis.timeSeries().metric()) ? "COUNT" : "KRW", slot.before(), slot.after(),
                        "저장된 시간대별 자료", null));
            }
        }
        var fingerprint = agent.fingerprintFor(analysis);
        var recommendation = jdbc.sql("""
                SELECT snapshot FROM strategy_recommendations WHERE analysis_id = :id AND input_fingerprint = :fingerprint
                ORDER BY created_at DESC, id DESC LIMIT 1
                """).param("id", analysis.id()).param("fingerprint", fingerprint)
                .query((rs, row) -> json.readValue(rs.getString(1), Response.class)).optional()
                .orElseGet(() -> strategies.from(analysis));
        for (var strategy : recommendation.strategies()) {
            var evidence = fact("strategy-" + strategy.code(), "STRATEGY", strategy.title(),
                    "AGENT".equals(recommendation.recommendationSource()) ? "저장된 AI 추천" : "기본 대응 전략", null)
                    .put("code", strategy.code()).put("reason", strategy.reason());
            var ids = evidence.putArray("evidenceIds");
            for (var item : strategy.evidence()) {
                snapshot.facts().values().stream().filter(value -> item.source().equals(value.path("metric").asString())
                        && (!"TIME_SERIES".equals(item.source()) || item.label().equals(value.path("label").asString())))
                        .findFirst().ifPresent(value -> ids.add(value.path("id").asString()));
            }
            snapshot.add(evidence);
            snapshot.allow("OPEN_STRATEGY", strategy.code());
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
        snapshot.allow("ADD_TIME_SERIES", "AMOUNT");
        snapshot.allow("ADD_TIME_SERIES", "COUNT");
        snapshot.allow("OPEN_REVIEWS", "ALL");
        for (var topic : ReviewTopic.values()) snapshot.allow("OPEN_REVIEWS", topic.name());
        for (var entry : reviews.classified(analysis.storeId())) {
            var review = entry.review();
            for (var topic : entry.topics()) {
                if (snapshot.facts().size() >= 200) break;
                snapshot.add(fact("review-" + review.id() + "-" + topic, "REVIEW", "매장 리뷰", "매장 등록 리뷰", null)
                        .put("date", review.date().toString()).put("topic", topic.name()).put("excerpt", review.text()));
            }
        }
        return snapshot;
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
        var value = fact(id, "METRIC", title, source, url).put("metric", metric).put("chart", metric)
                .put("scope", scope).put("unit", unit);
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
    private record SavedGuide(String code, GuideResponse guide) {}
    record Snapshot(LinkedHashMap<String, ObjectNode> facts, List<Action> actions) {
        void add(ObjectNode fact) { facts.put(fact.path("id").asString(), fact); }
        void allow(String type, String target) { actions.add(new Action(type, target)); }
    }
}
