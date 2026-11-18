package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class PromotionReviewDateTest {
    @Test
    void aCachedSearchCannotCrossDatesOrMenus() {
        var reference = LocalDate.of(2021, 6, 1);
        var snapshot = new PromotionDraftController.ResearchSnapshot(UUID.randomUUID(), "김치찌개", Instant.now(),
                List.of(), List.of(), reference);
        assertThat(snapshot.matches("김치찌개", reference)).isTrue();
        assertThat(snapshot.matches("김치찌개", reference.plusDays(1))).isFalse();
        assertThat(snapshot.matches("김치찌개", LocalDate.of(2026, 11, 18))).isFalse();
        assertThat(snapshot.matches("두루치기", reference)).isFalse();
    }

    @Test
    void legacyJsonStillLoadsButRequiresAResearchWithTheCurrentDate() {
        var json = JsonMapper.builder().build();
        var legacy = json.readValue("""
                {"id":"a61b35a3-190a-495d-bf17-3be443a42943","subject":"김치찌개",
                 "searchedAt":"2026-11-18T00:00:00Z","sources":[],"points":[]}
                """, PromotionDraftController.ResearchSnapshot.class);
        assertThat(legacy.referenceDate()).isNull();
        assertThat(legacy.matches("김치찌개", LocalDate.of(2021, 6, 1))).isFalse();
    }
}
