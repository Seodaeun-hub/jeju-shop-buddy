package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.jejushopbuddy.time.BusinessDate;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class InstagramTestPublicationTest {
    private static BusinessDate businessDate(boolean rehearsing) {
        return new BusinessDate(null) {
            @Override public boolean rehearsing() { return rehearsing; }
        };
    }
    @Test
    void requiresTheConnectedStoreExplicitConfigurationAndRehearsalModeTogether() {
        for (boolean connected : new boolean[] {false, true}) {
            for (boolean optedIn : new boolean[] {false, true}) {
                for (boolean rehearsing : new boolean[] {false, true}) {
                    assertThat(InstagramTestPublication.available(connected, optedIn, rehearsing))
                            .isEqualTo(connected && optedIn && rehearsing);
                }
            }
        }
    }

    @Test
    void keepsTheHistoricOfferAndSeparatelyLabelsTheRealPostingDateAndSyntheticInputs() {
        String draft = "김치찌개 7,000원 · 30개 한정\n행사 기간 2021-06-01 ~ 2021-06-14\n선택한 후기 출처";
        String caption = InstagramTestPublication.caption(draft, LocalDate.parse("2021-06-01"), LocalDate.parse("2026-11-18"));
        assertThat(caption).startsWith("[가게짝꿍 가상 시연 · 테스트 게시]")
                .contains("시연 기준일: 2021-06-01 / 실제 게시일: 2026-11-18",
                        "현재 진행하는 판매 행사가 아닙니다", "음식 사진은 AI 예시", "가상 시연 자료")
                .endsWith("\n\n" + draft);
    }

    @Test
    void existingNormalAndScheduledRequestsDoNotOptIntoTestPublishing() {
        var input = JsonMapper.builder().build().readValue("""
                {"username":"jeju_shop_buddy_test","caption":"일반 홍보","image":"jpeg","scheduledAt":null}
                """, InstagramPublicationController.Input.class);
        assertThat(input.testPublication()).isFalse();
        assertThat(input.testConfirmed()).isFalse();
    }

    @Test
    void normalPublishCannotBypassTheRehearsalGuard() {
        var dates = businessDate(true);
        var controller = new InstagramPublicationController(null, JsonMapper.builder().build(), dates,
                "", "", "", "", "", true);
        var result = controller.publish(UUID.randomUUID(), new InstagramPublicationController.Input(
                "jeju_shop_buddy_test", "", "", null, false, true), () -> "owner@example.test");
        assertThat(result.getStatusCode().value()).isEqualTo(409);
        assertThat(JsonMapper.builder().build().writeValueAsString(result.getBody())).contains("REHEARSAL_PUBLICATION_DISABLED");
    }

    @Test
    void testFlagCannotPublishWhenTheServerHasNotOptedInOrTheAccountIsNotRehearsing() {
        for (boolean enabled : new boolean[] {false, true}) {
            for (boolean rehearsing : new boolean[] {false, true}) {
                if (enabled && rehearsing) continue;
                var dates = businessDate(rehearsing);
                var controller = new InstagramPublicationController(null, JsonMapper.builder().build(), dates,
                        "", "", "", "", "", enabled);
                var result = controller.publish(UUID.randomUUID(), new InstagramPublicationController.Input(
                        "jeju_shop_buddy_test", "", "", null, true, true), () -> "owner@example.test");
                assertThat(result.getStatusCode().value()).isEqualTo(409);
                assertThat(JsonMapper.builder().build().writeValueAsString(result.getBody())).contains("INSTAGRAM_TEST_PUBLICATION_DISABLED");
            }
        }
    }
}
