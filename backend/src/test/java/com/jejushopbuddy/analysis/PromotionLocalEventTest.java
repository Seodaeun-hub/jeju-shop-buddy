package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class PromotionLocalEventTest {
    @Test
    void connectsTheSelectedEventToTheMenuAndKeepsTheOffer() {
        var start = LocalDate.of(2026, 11, 16);
        var end = start.plusDays(13);
        var event = PromotionLocalEvent.forPlan(start, end, start).getFirst();
        var contextualEvent = event.forCaption("자매국수", "고기국수", true);
        String offer = "고기국수 7,500원 · 개당 1,000원 할인 · 30개 한정\n행사 기간 2026-11-16 ~ 2026-11-29";

        assertThat(contextualEvent.captionLine()).containsPattern("제주감귤박람회.*자매국수.*고기국수");
        assertThat(contextualEvent.sourceUrl()).isEqualTo(event.sourceUrl());
        assertThat(PromotionLocalEvent.captionFooter(offer, contextualEvent)).endsWith("\n\n" + offer);
        assertThat(PromotionLocalEvent.captionFooter(offer, null)).isEqualTo(offer);
        assertThat(contextualEvent.forCaption("자매국수", "고기국수", true)).isEqualTo(contextualEvent);
    }
}
