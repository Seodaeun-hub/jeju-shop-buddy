package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.jejushopbuddy.address.NaverGeocodingClient.Coordinates;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class PromotionWeatherTest {
    @Test
    void stripsOnlyTheRegisteredStoreNameFromTheBuildingAddress() {
        assertThat(KmaForecast.buildingAddress("제주특별자치도 제주시 항골남길 46 자매국수", "자매국수"))
                .isEqualTo("제주특별자치도 제주시 항골남길 46");
        assertThat(KmaForecast.buildingAddress("제주시 항골남길 46-1", "자매국수"))
                .isEqualTo("제주시 항골남길 46-1");
    }

    @Test
    void usesOnlyMatchingGridIssueAndTargetDateForTheForecast() {
        var grid = KmaForecast.grid(new Coordinates(33.4985768, 126.4591668));
        assertThat(grid).isEqualTo(new KmaForecast.Grid(51, 38));
        var issue = ZonedDateTime.parse("2026-11-12T20:00:00+09:00[Asia/Seoul]");
        var forecast = JsonMapper.builder().build().readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[
                {"baseDate":"20261112","baseTime":"2000","fcstDate":"20261113","fcstTime":"1000","nx":51,"ny":38,"category":"PTY","fcstValue":"1"},
                {"baseDate":"20261112","baseTime":"2000","fcstDate":"20261113","fcstTime":"1200","nx":51,"ny":38,"category":"SKY","fcstValue":"3"},
                {"baseDate":"20261112","baseTime":"2000","fcstDate":"20261113","fcstTime":"1200","nx":51,"ny":38,"category":"TMP","fcstValue":"14"},
                {"baseDate":"20261112","baseTime":"2000","fcstDate":"20261113","fcstTime":"1400","nx":51,"ny":38,"category":"TMP","fcstValue":"18"},
                {"baseDate":"20261112","baseTime":"2000","fcstDate":"20261113","fcstTime":"1200","nx":51,"ny":38,"category":"POP","fcstValue":"60"},
                {"baseDate":"20261112","baseTime":"2000","fcstDate":"20261113","fcstTime":"1200","nx":50,"ny":38,"category":"PTY","fcstValue":"3"},
                {"baseDate":"20261112","baseTime":"1700","fcstDate":"20261113","fcstTime":"1200","nx":51,"ny":38,"category":"PTY","fcstValue":"3"},
                {"baseDate":"20261112","baseTime":"2000","fcstDate":"20261114","fcstTime":"1200","nx":51,"ny":38,"category":"PTY","fcstValue":"3"}
                ]}}}}
                """);
        var day = LocalDate.parse("2026-11-13");
        assertThat(KmaForecast.summarize(forecast, grid, issue, day, 0))
                .isEqualTo(new KmaForecast.Daily("비 예보", issue.toOffsetDateTime(), 14, 18, 60, true));
        assertThat(KmaForecast.summarize(forecast, grid, issue, day, 11).label()).isEqualTo("구름 예보");
        assertThat(KmaForecast.summarize(forecast, grid, issue, day.minusDays(1), 0)).isNull();
    }

    @Test
    void waitsForTheReleaseAndUsesThePriorDayAroundMidnight() {
        var issue = ZonedDateTime.parse("2026-11-13T02:10:00+09:00[Asia/Seoul]");
        assertThat(KmaForecast.latestIssue(issue)).isEqualTo(issue.minusMinutes(10));
        assertThat(KmaForecast.latestIssue(issue.minusMinutes(1))).isEqualTo(issue.minusMinutes(190));
    }

    @Test
    void replacesOnlyTheManagedSentenceWhenTheDateChangesAndKeepsTheOffer() {
        var autumn = PromotionWeather.context("제주시 이호동", LocalDate.parse("2026-11-13"), "비 예보", null, "");
        var winter = PromotionWeather.context("제주시 이호동", LocalDate.parse("2026-12-01"), null, null, "");
        String offer = "고기국수 7,500원 · 개당 1,000원 할인 · 30개 한정\n행사 기간 2026-11-12 ~ 2026-12-09";
        String title = "[고기국수 행사]";
        String editable = title + "\n사장님이 직접 수정한 문장.";
        var oldLeads = List.of(autumn.leads().instagram(), autumn.leads().naver(), autumn.leads().daangn());
        var newLeads = List.of(winter.leads().instagram(), winter.leads().naver(), winter.leads().daangn());
        assertThat(oldLeads).allSatisfy(line -> assertThat(line).contains("가을", "비 예보")).doesNotHaveDuplicates();
        for (int i = 0; i < oldLeads.size(); i++) {
            String first = PromotionDraftController.withWeather(editable, "", oldLeads.get(i), offer, i != 0);
            String updated = PromotionDraftController.withWeather(first, oldLeads.get(i), newLeads.get(i), offer, i != 0);
            assertThat(updated).contains("겨울", "사장님이 직접 수정한 문장.").doesNotContain("가을", "비 예보")
                    .endsWith("\n\n" + offer);
            assertThat(updated.split("7,500원", -1)).hasSize(2);
            if (i != 0) assertThat(updated).startsWith(title + "\n");
        }
        assertThat(winter.sourceUrl()).isNull();
    }

    @Test
    void everyWeatherSentenceFitsTheEditorAllowanceIncludingLineBreaks() {
        // The editor reserves 48 characters for the automatic sentence and its two line breaks.
        var forecasts = List.of("", "맑음 예보", "구름 예보", "흐림 예보", "비 예보", "눈 예보", "비·눈 예보");
        for (String forecast : forecasts) {
            var leads = PromotionWeather.context("제주시 이호동", LocalDate.parse("2026-11-13"), forecast, null, "").leads();
            assertThat(List.of(leads.instagram(), leads.naver(), leads.daangn()))
                    .allSatisfy(lead -> assertThat(lead.length() + 2).isLessThanOrEqualTo(48));
        }
    }

    @Test
    void keepsLegacyBodyAndOfferWhenThereIsNoRoomForTheNewWeatherSentence() {
        String offer = "고기국수 7,500원 · 30개 한정";
        String body = "가".repeat(2200 - offer.length() - 2);
        String lead = "비 예보가 있는 제주입니다.";
        String fitted = PromotionDraftController.fittingLead(body, lead, offer, false);
        assertThat(fitted).isEmpty();
        assertThat(PromotionDraftController.withWeather(body, "", fitted, offer, false)).isEqualTo(body + "\n\n" + offer);
        assertThat(PromotionDraftController.fittingLead(body, lead, offer, true)).isEqualTo(lead);
    }
}
