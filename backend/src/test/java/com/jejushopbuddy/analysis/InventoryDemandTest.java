package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.jejushopbuddy.address.NaverGeocodingClient.Coordinates;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class InventoryDemandTest {
    private static final LocalDate TARGET = LocalDate.parse("2021-05-29");
    private static final String NOODLES = "고기국수";

    @Test
    void onlyEarlierSameWeekdaySalesAreUsedAndFilesAreNotAddedTogether() {
        var newest = new ProductPosArchive.Days(Map.of(
                TARGET, Map.of(NOODLES, new ProductPosArchive.Item(100, 1)),
                TARGET.minusWeeks(1), Map.of(NOODLES, new ProductPosArchive.Item(18, 1)),
                TARGET.minusWeeks(2), Map.of("만두", new ProductPosArchive.Item(2, 1)),
                TARGET.minusDays(1), Map.of(NOODLES, new ProductPosArchive.Item(99, 1))),
                TARGET.minusWeeks(3), TARGET);
        var old = new ProductPosArchive.Days(Map.of(
                TARGET.minusWeeks(1), Map.of(NOODLES, new ProductPosArchive.Item(50, 1))), null, null);
        var samples = InventoryDemand.sameWeekdays(List.of(newest, old), NOODLES, TARGET, TARGET.plusDays(1));
        assertThat(samples).extracting(InventoryDemand.Sample::quantity).containsExactly(0L, 18L);
        assertThat(samples).extracting(InventoryDemand.Sample::date)
                .containsExactly(TARGET.minusWeeks(2), TARGET.minusWeeks(1));
        assertThat(InventoryDemand.sameWeekdays(List.of(newest), "없는 메뉴", TARGET, TARGET.plusDays(1))).isEmpty();
    }

    @Test
    void usesWeatherOnlyWithThreeMatchingDaysOtherwiseFallsBackToWeekday() {
        var samples = List.of(sample(4, 20), sample(3, 13), sample(2, 16), sample(1, 31));
        var rain = Map.of(TARGET.minusWeeks(4), new KmaObservations.Observation(BigDecimal.TEN, true),
                TARGET.minusWeeks(3), new KmaObservations.Observation(BigDecimal.ONE, true),
                TARGET.minusWeeks(2), new KmaObservations.Observation(BigDecimal.ZERO, true),
                TARGET.minusWeeks(1), new KmaObservations.Observation(null, false));
        var required = InventoryDemand.requiredPos(TARGET, TARGET.minusDays(1));
        var wet = InventoryDemand.summarize(NOODLES, false, null, "제주", null, true, samples, rain, required, Set.of());
        assertThat(wet.basis()).isEqualTo(InventoryDemand.Basis.WEATHER);
        assertThat(wet.low()).isEqualTo(13);
        assertThat(wet.high()).isEqualTo(20);
        assertThat(wet.samples()).hasSize(3);
        assertThat(wet.requiredPos()).isNull();
        var dry = InventoryDemand.summarize(NOODLES, false, null, "제주", null, false, samples, rain, required, Set.of());
        assertThat(dry.basis()).isEqualTo(InventoryDemand.Basis.WEEKDAY);
        assertThat(dry.high()).isEqualTo(31);
        var missing = InventoryDemand.summarize(NOODLES, true, 18L, null, null, null, samples.subList(0, 2), Map.of(), required, Set.of());
        assertThat(missing.basis()).isEqualTo(InventoryDemand.Basis.INSUFFICIENT);
        assertThat(missing.low()).isNull();
        assertThat(missing.actualSales()).isEqualTo(18);
        assertThat(missing.requiredPos()).isEqualTo(new InventoryDemand.PosRequirement(
                TARGET.minusWeeks(12), TARGET.minusWeeks(1), "PRODUCT", 3));
    }

    @Test
    void filtersSelectedDaysBeforeChoosingWeatherBasisAndKeepsOriginalRange() {
        var samples = List.of(sample(4, 13), sample(3, 24), sample(2, 16), sample(1, 28));
        var rain = Map.of(TARGET.minusWeeks(4), new KmaObservations.Observation(BigDecimal.ONE, true),
                TARGET.minusWeeks(3), new KmaObservations.Observation(BigDecimal.ONE, true),
                TARGET.minusWeeks(2), new KmaObservations.Observation(BigDecimal.ONE, true),
                TARGET.minusWeeks(1), new KmaObservations.Observation(BigDecimal.ZERO, false));
        var excluded = TARGET.minusWeeks(3);
        var estimate = InventoryDemand.summarize(NOODLES, true, 19L, "제주", BigDecimal.ONE, true,
                samples, rain, InventoryDemand.requiredPos(TARGET, TARGET), Set.of(excluded));
        assertThat(estimate.originalBounds()).isEqualTo(new InventoryDemand.Bounds(InventoryDemand.Basis.WEATHER, 13L, 24L));
        assertThat(estimate.basis()).isEqualTo(InventoryDemand.Basis.WEEKDAY);
        assertThat(estimate.high()).isEqualTo(28);
        assertThat(estimate.actualSales()).isEqualTo(19);
        assertThat(estimate.excludedDates()).containsExactly(excluded);
        assertThat(estimate.samples()).extracting(InventoryDemand.Sample::date).doesNotContain(excluded);
        assertThat(estimate.candidates()).extracting(InventoryDemand.Sample::date).contains(excluded);

        var insufficient = InventoryDemand.summarize(NOODLES, true, 19L, "제주", BigDecimal.ONE, true,
                samples, rain, InventoryDemand.requiredPos(TARGET, TARGET), Set.of(excluded, TARGET.minusWeeks(1)));
        assertThat(insufficient.basis()).isEqualTo(InventoryDemand.Basis.INSUFFICIENT);
        assertThat(insufficient.requiredPos()).isNull();
    }

    @Test
    void requestsOnlyEarlierCompletedSameWeekdays() {
        assertThat(InventoryDemand.requiredPos(TARGET, TARGET.minusWeeks(1)).end()).isEqualTo(TARGET.minusWeeks(2));
        assertThat(InventoryDemand.requiredPos(TARGET, TARGET.minusWeeks(12))).isNull();
    }

    @Test
    void comparesCompletedDaysWithInclusiveSavedBounds() {
        var saved = new InventoryReviewController.SavedEstimate(TARGET, NOODLES, 13, 24,
                InventoryDemand.Basis.WEATHER, null);
        var today = TARGET.plusDays(1);
        assertThat(InventoryReviewController.ComparisonStatus.of(saved, null, TARGET))
                .isEqualTo(InventoryReviewController.ComparisonStatus.PENDING_DATE);
        assertThat(InventoryReviewController.ComparisonStatus.of(saved, null, today))
                .isEqualTo(InventoryReviewController.ComparisonStatus.POS_REQUIRED);
        assertThat(InventoryReviewController.ComparisonStatus.of(saved, 13L, today))
                .isEqualTo(InventoryReviewController.ComparisonStatus.WITHIN_RANGE);
        assertThat(InventoryReviewController.ComparisonStatus.of(saved, 24L, today))
                .isEqualTo(InventoryReviewController.ComparisonStatus.WITHIN_RANGE);
        assertThat(InventoryReviewController.ComparisonStatus.of(saved, 12L, today))
                .isEqualTo(InventoryReviewController.ComparisonStatus.BELOW_RANGE);
        assertThat(InventoryReviewController.ComparisonStatus.of(saved, 28L, today))
                .isEqualTo(InventoryReviewController.ComparisonStatus.ABOVE_RANGE);
    }

    @Test
    void keepsOnlyValidObservationsFromTheStoresStationAndDateRange() {
        assertThat(KmaObservations.nearest(new Coordinates(33.4985768, 126.4591668)).id()).isEqualTo(184);
        var payload = JsonMapper.builder().build().readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[
                {"stnId":"184","tm":"2021-05-26","sumRn":"","iscs":"","avgTa":""},
                {"stnId":"184","tm":"2021-05-27","sumRn":"","iscs":"{박무}","avgTa":"18.0"},
                {"stnId":"184","tm":"2021-05-28","sumRn":"0.0","iscs":"{비}{강도0}","avgTa":"18.1"},
                {"stnId":"184","tm":"2021-05-29","sumRn":"2.1"},
                {"stnId":"189","tm":"2021-05-29","sumRn":"3.0"},
                {"stnId":"184","tm":"2021-05-30","sumRn":"5"}
                ]}}}}
                """);
        assertThat(KmaObservations.rainfallFrom(payload, 184, TARGET.minusDays(3), TARGET))
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        TARGET.minusDays(2), new KmaObservations.Observation(null, false),
                        TARGET.minusDays(1), new KmaObservations.Observation(new BigDecimal("0.0"), true),
                        TARGET, new KmaObservations.Observation(new BigDecimal("2.1"), true)));
    }

    private static InventoryDemand.Sample sample(int weeksAgo, long quantity) {
        return new InventoryDemand.Sample(TARGET.minusWeeks(weeksAgo), quantity, null, null);
    }
}
