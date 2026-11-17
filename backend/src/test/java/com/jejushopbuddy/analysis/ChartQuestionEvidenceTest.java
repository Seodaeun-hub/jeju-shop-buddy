package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesAnalysisController.MonthlySale;
import com.jejushopbuddy.analysis.SalesAnalysisController.ProductSale;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSeries;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSlot;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ChartQuestionEvidenceTest {
    @Test
    void includesSavedProductRevenueAndBothUnitsForTheSamePosTimeBand() {
        var json = new JsonMapper();
        var id = UUID.randomUUID();
        var store = UUID.randomUUID();
        var analysis = new AnalysisResponse(id, store, "8·9월 시연", null, "2026-08", "2026-09",
                List.of(new MonthlySale("2026-08", 850000L), new MonthlySale("2026-09", 1020000L)),
                new TimeSeries("COUNT", List.of(new TimeSlot("오후 2시 전", 100, 120))),
                List.of(new ProductSale("고기국수", 100, 120, 8500L, 850000L, 1020000L),
                        new ProductSale("만두", 5, 10, 6000L, null, null)), OffsetDateTime.now());
        var hourly = json.createObjectNode();
        for (var month : analysis.monthlySales()) {
            var hours = hourly.putArray(month.month());
            for (int hour = 0; hour < 24; hour++) {
                hours.addObject().put("amount", hour == 13 ? month.amount() : 0)
                        .put("count", hour == 13 ? month.amount() / 8500 : 0);
            }
        }
        var reader = mock(SalesAnalysisReader.class);
        when(reader.findHourlySales(id, "owner@example.test")).thenReturn(Optional.of(hourly.toString()));
        var facts = evidenceFor(analysis, reader, json).forAnalysis(analysis, "owner@example.test", null,
                "고기국수 판매량과 매출이 늘어난 시간대", Set.of()).facts().values();

        assertThat(facts).filteredOn(fact -> matches(fact, "고기국수"))
                .hasSize(2).allMatch(fact -> !fact.has("chart"))
                .anyMatch(fact -> hasValues(fact, "QUANTITY", 100, 120))
                .anyMatch(fact -> hasValues(fact, "KRW", 850000, 1020000));
        assertThat(facts).filteredOn(fact -> matches(fact, "만두"))
                .singleElement().matches(fact -> hasValues(fact, "QUANTITY", 5, 10));
        assertThat(facts).filteredOn(fact -> matches(fact, "오후 2시 전"))
                .hasSize(2)
                .anyMatch(fact -> hasValues(fact, "COUNT", 100, 120))
                .anyMatch(fact -> hasValues(fact, "KRW", 850000, 1020000));
    }

    @Test
    void includesLargestDeclinesEvenWhenTheMenuEvidenceIsCapped() {
        var steady = IntStream.range(0, 24).mapToObj(index ->
                new ProductSale("그대로인 메뉴 " + index, 40, 40, 6000L, 240000L, 240000L));
        var declining = Stream.of(new ProductSale("고기국수", 120, 100, 8500L, 1020000L, 850000L),
                new ProductSale("공깃밥", 40, 5, 1000L, 40000L, 5000L),
                new ProductSale("금액 없는 메뉴", 200, 0, null, null, null));
        var analysis = new AnalysisResponse(UUID.randomUUID(), UUID.randomUUID(), "8·9월 시연", null,
                "2026-08", "2026-09", List.of(new MonthlySale("2026-08", 1500000L),
                new MonthlySale("2026-09", 1330000L)), null, Stream.concat(steady, declining).toList(), OffsetDateTime.now());
        var evidence = evidenceFor(analysis, mock(SalesAnalysisReader.class), new JsonMapper());
        var facts = evidence.forAnalysis(analysis, "owner@example.test", null,
                "매출이 가장 많이 줄어든 메뉴는?", Set.of()).facts().values().stream()
                .filter(fact -> "ITEM_SALES".equals(fact.path("metric").asString())).toList();

        assertThat(facts).hasSize(40);
        assertThat(facts.subList(0, 2)).anyMatch(fact ->
                matches(fact, "고기국수") && hasValues(fact, "KRW", 1020000, 850000));
        assertThat(facts).noneMatch(fact -> matches(fact, "금액 없는 메뉴"));
    }

    @SuppressWarnings("unchecked")
    private static ChartQuestionEvidence evidenceFor(AnalysisResponse analysis, SalesAnalysisReader reader, JsonMapper json) {
        var jdbc = mock(JdbcClient.class);
        var statement = mock(JdbcClient.StatementSpec.class);
        JdbcClient.MappedQuerySpec<Object> mapped = mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(statement);
        when(statement.param(anyString(), any())).thenReturn(statement);
        when(statement.query(org.mockito.ArgumentMatchers.<RowMapper<Object>>any())).thenReturn(mapped);
        when(statement.query(UUID.class)).thenReturn(mock(JdbcClient.MappedQuerySpec.class));
        var market = mock(JejuMarketContext.class);
        when(market.forStore(analysis.storeId(), "2026-08", "2026-09")).thenReturn(new JejuMarketContext.StoreContext(
                "제주시 이호동", "KOREAN_RESTAURANT", new JejuMarketContext.Context(null, null, null, List.of())));
        var strategies = mock(SalesStrategies.class);
        when(strategies.from(analysis)).thenReturn(new SalesStrategies.Response(analysis.id(), "2026-08", "2026-09",
                List.of(), "RULE", List.of()));
        var strategyAgent = mock(StrategyAgentClient.class);
        when(strategyAgent.fingerprintFor(analysis)).thenReturn("demo");
        return new ChartQuestionEvidence(jdbc, reader, json, market, strategies, strategyAgent,
                mock(StoreReviewService.class), mock(ExecutionPlanReader.class), mock(ExecutionResultReader.class));
    }

    private static boolean matches(JsonNode fact, String label) {
        return label.equals(fact.path("label").asString());
    }

    private static boolean hasValues(JsonNode fact, String unit, long before, long after) {
        return unit.equals(fact.path("unit").asString())
                && fact.path("before").asLong() == before && fact.path("after").asLong() == after;
    }
}
