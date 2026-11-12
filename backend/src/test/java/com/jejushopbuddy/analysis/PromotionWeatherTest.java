package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class PromotionWeatherTest {
    @Test
    void stripsOnlyTheRegisteredStoreNameFromTheBuildingAddress() {
        assertThat(PromotionWeather.buildingAddress("제주특별자치도 제주시 항골남길 46 자매국수", "자매국수"))
                .isEqualTo("제주특별자치도 제주시 항골남길 46");
        assertThat(PromotionWeather.buildingAddress("제주시 항골남길 46-1", "자매국수"))
                .isEqualTo("제주시 항골남길 46-1");
    }

    @Test
    void usesOnlyTheKoreanForecastForThePostingDate() {
        var forecast = JsonMapper.builder().build().readTree("""
                {"timezone":"Asia/Seoul","daily":{"time":["2026-11-12","2026-11-13","2026-11-14"],
                "weather_code":[0,61,null]}}
                """);
        assertThat(PromotionWeather.forecastFor(forecast, LocalDate.parse("2026-11-12"))).isEqualTo("맑음 예보");
        assertThat(PromotionWeather.forecastFor(forecast, LocalDate.parse("2026-11-13"))).isEqualTo("비 예보");
        assertThat(PromotionWeather.forecastFor(forecast, LocalDate.parse("2026-11-14"))).isNull();
        assertThat(PromotionWeather.forecastFor(forecast, LocalDate.parse("2026-11-20"))).isNull();
    }

    @Test
    void replacesOnlyTheManagedSentenceWhenTheDateChangesAndKeepsTheOffer() {
        var autumn = PromotionWeather.context("제주시 도두동", LocalDate.parse("2026-11-13"), "비 예보", "");
        var winter = PromotionWeather.context("제주시 도두동", LocalDate.parse("2026-12-01"), null, "");
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
        var forecasts = List.of("", "맑음 예보", "구름 예보", "안개 예보", "비 예보", "눈 예보", "뇌우 예보");
        for (String forecast : forecasts) {
            var leads = PromotionWeather.context("제주시 이호동", LocalDate.parse("2026-11-13"), forecast, "").leads();
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
