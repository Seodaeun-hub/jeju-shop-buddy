package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.json.JsonMapper;

class JejuMarketContextTest {
    private final JejuMarketContext context = new JejuMarketContext(mock(JdbcClient.class), new JsonMapper());

    JejuMarketContextTest() throws Exception {}

    @Test
    void showsRecentRegionalCardReferenceAndBsiForExactMonths() {
        var result = context.lookup("제주시 이호동", "한식 음식점업", "2026-08", "2026-09");
        assertThat(result.card()).isNull();
        assertThat(result.cardReference().scope()).isEqualTo("제주시 이호동 음식점업 전체");
        assertThat(result.cardReference().before()).isEqualByComparingTo(new BigDecimal("1269268638"));
        assertThat(result.cardReference().after()).isEqualByComparingTo(new BigDecimal("845862979"));
        assertThat(result.bsi().before()).isEqualByComparingTo("64.2");
        assertThat(result.bsi().after()).isEqualByComparingTo("77.2");
        assertThat(result.bsiSources()).hasSize(2);
    }

    @Test
    void avoidsInventingCardValuesAndPreservesHistoricalSeries() {
        var unavailable = context.lookup("제주시 이호동", "한식 음식점업", "2026-09", "2026-10");
        assertThat(unavailable.card()).isNull();
        assertThat(unavailable.cardReference()).isNull();
        assertThat(unavailable.bsi().after()).isEqualByComparingTo("61.7");
        assertThat(context.lookup("제주시 이호동", "호텔업", "2026-08", "2026-09").cardReference()).isNull();

        var legacy = context.lookup("제주시 이호동", "한식 음식점업", "2021-04", "2021-05");
        assertThat(legacy.card()).isNotNull();
        assertThat(legacy.cardReference()).isNull();
        assertThat(legacy.bsi().before()).isEqualByComparingTo("63.1");
        assertThat(legacy.bsiSources()).hasSize(1);
    }
}
