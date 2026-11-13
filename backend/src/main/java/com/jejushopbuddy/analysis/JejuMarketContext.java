package com.jejushopbuddy.analysis;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.Map;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
class JejuMarketContext {
    private static final String BSI_SOURCE = "https://www.data.go.kr/data/3060077/fileData.do";
    private static final String JTO_CARD_SOURCE = "https://data.ijto.or.kr/prog/dataPick/bigdata/sub02/view.do?regSn=27";
    private static final Set<String> RESTAURANTS = Set.of("한식 음식점업", "중식 음식점업", "일식 음식점업",
            "서양식 음식점업", "기타 외국식 음식점업", "피자, 햄버거, 샌드위치 및 유사 음식점업");
    private final JdbcClient jdbc;
    private final Dataset data;
    private final RecentDataset recent;
    private final Map<String, BigDecimal> bsi;

    JejuMarketContext(JdbcClient jdbc, ObjectMapper json) throws IOException {
        this.jdbc = jdbc;
        try (var source = new ClassPathResource("jeju-market-data.json").getInputStream()) {
            data = json.readValue(source, Dataset.class);
        }
        try (var source = new ClassPathResource("jeju-recent-market-data.json").getInputStream()) {
            recent = json.readValue(source, RecentDataset.class);
        }
        var values = new HashMap<>(data.jejuBsi());
        values.putAll(recent.bsi());
        bsi = Map.copyOf(values);
    }

    @GetMapping("/api/market-context")
    Context lookup(@RequestParam String area, @RequestParam String industry,
                   @RequestParam String beforeMonth, @RequestParam String afterMonth) {
        var amounts = data.cardAmounts().getOrDefault(area, Map.of()).getOrDefault(industry, Map.of());
        var exact = pair(amounts, beforeMonth, afterMonth);
        var regional = exact == null && RESTAURANTS.contains(industry)
                ? pair(recent.restaurantCardAmounts().getOrDefault(area, Map.of()), beforeMonth, afterMonth) : null;
        var bsiPair = pair(bsi, beforeMonth, afterMonth);
        var links = new LinkedHashSet<Source>();
        if (bsiPair != null) {
            links.add(bsiSource(beforeMonth));
            links.add(bsiSource(afterMonth));
        }
        return new Context(exact, bsiPair, regional == null ? null : new Reference(regional.before(), regional.after(),
                area + " 음식점업 전체", new Source("제주관광공사 · BC카드 기반 추정", JTO_CARD_SOURCE)),
                links.isEmpty() ? null : List.copyOf(links));
    }

    private Source bsiSource(String month) {
        String report = recent.bsiReportUrls().get(month);
        return report == null ? new Source("소상공인시장진흥공단", BSI_SOURCE)
                : new Source(month + " 중소벤처기업부 조사보고서", report);
    }

    StoreContext forStore(UUID storeId, String beforeMonth, String afterMonth) {
        var store = jdbc.sql("""
                SELECT a.name, s.industry_code, s.custom_industry_name
                FROM stores s JOIN jeju_areas a ON a.code = s.area_code
                WHERE s.id = :id
                """)
                .param("id", storeId)
                .query((rs, row) -> new StoreKey(rs.getString("name"), rs.getString("industry_code"),
                        data.industryNames().getOrDefault(rs.getString("industry_code"), rs.getString("custom_industry_name"))))
                .single();
        var context = lookup(store.area(), store.industry() == null ? "" : store.industry(), beforeMonth, afterMonth);
        return new StoreContext(store.area(), store.industryCode(), context);
    }

    private static Pair pair(Map<String, BigDecimal> values, String beforeMonth, String afterMonth) {
        var before = values.get(beforeMonth);
        var after = values.get(afterMonth);
        return before == null || after == null ? null : new Pair(before, after);
    }

    private record StoreKey(String area, String industryCode, String industry) {}

    record StoreContext(String area, String industryCode, Context context) {}

    record Dataset(Map<String, Map<String, Map<String, BigDecimal>>> cardAmounts,
                   Map<String, BigDecimal> jejuBsi, Map<String, String> industryNames) {}

    record RecentDataset(Map<String, Map<String, BigDecimal>> restaurantCardAmounts,
                         Map<String, BigDecimal> bsi, Map<String, String> bsiReportUrls) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Context(Pair card, Pair bsi, Reference cardReference, List<Source> bsiSources) {}

    record Pair(BigDecimal before, BigDecimal after) {}
    record Reference(BigDecimal before, BigDecimal after, String scope, Source source) {}
    record Source(String label, String url) {}
}
