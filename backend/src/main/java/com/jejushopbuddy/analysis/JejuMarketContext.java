package com.jejushopbuddy.analysis;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
class JejuMarketContext {
    private final JdbcClient jdbc;
    private final Dataset data;

    JejuMarketContext(JdbcClient jdbc, ObjectMapper json) throws IOException {
        this.jdbc = jdbc;
        try (var source = new ClassPathResource("jeju-market-data.json").getInputStream()) {
            data = json.readValue(source, Dataset.class);
        }
    }

    @GetMapping("/api/market-context")
    Context lookup(@RequestParam String area, @RequestParam String industry,
                   @RequestParam String beforeMonth, @RequestParam String afterMonth) {
        var amounts = data.cardAmounts().getOrDefault(area, Map.of()).getOrDefault(industry, Map.of());
        return new Context(pair(amounts, beforeMonth, afterMonth), pair(data.jejuBsi(), beforeMonth, afterMonth));
    }

    Context forStore(UUID storeId, String beforeMonth, String afterMonth) {
        var store = jdbc.sql("""
                SELECT a.name, s.industry_code, s.custom_industry_name
                FROM stores s JOIN jeju_areas a ON a.code = s.area_code
                WHERE s.id = :id
                """)
                .param("id", storeId)
                .query((rs, row) -> new StoreKey(rs.getString("name"),
                        data.industryNames().getOrDefault(rs.getString("industry_code"), rs.getString("custom_industry_name"))))
                .single();
        return lookup(store.area(), store.industry() == null ? "" : store.industry(), beforeMonth, afterMonth);
    }

    private static Pair pair(Map<String, BigDecimal> values, String beforeMonth, String afterMonth) {
        var before = values.get(beforeMonth);
        var after = values.get(afterMonth);
        return before == null || after == null ? null : new Pair(before, after);
    }

    private record StoreKey(String area, String industry) {}

    record Dataset(Map<String, Map<String, Map<String, BigDecimal>>> cardAmounts,
                   Map<String, BigDecimal> jejuBsi, Map<String, String> industryNames) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Context(Pair card, Pair bsi) {}

    record Pair(BigDecimal before, BigDecimal after) {}
}
