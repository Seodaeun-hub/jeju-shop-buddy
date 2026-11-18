package com.jejushopbuddy.analysis;

import com.jejushopbuddy.address.NaverGeocodingClient.Coordinates;
import com.jejushopbuddy.time.BusinessDate;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
class InventoryDemand {
    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    static final int LOOKBACK_WEEKS = 12;
    private static final int MIN_SAMPLE_DAYS = 3;
    private final ProductPosArchive pos;
    private final KmaObservations observations;
    private final BusinessDate dates;

    InventoryDemand(ProductPosArchive pos, KmaObservations observations, BusinessDate dates) {
        this.pos = pos;
        this.observations = observations;
        this.dates = dates;
    }

    Estimate estimate(UUID store, Coordinates location, String product, LocalDate date, KmaForecast.Daily forecast,
                      Set<LocalDate> excludedDates) {
        LocalDate today = dates.today();
        // Provider availability uses the real calendar: historical observations are never a live forecast.
        boolean historical = date.isBefore(BusinessDate.actualToday());
        var archive = pos.load(store);
        var samples = sameWeekdays(archive, product, date, today);
        var station = location == null ? null : KmaObservations.nearest(location);
        Map<LocalDate, KmaObservations.Observation> rainfall = Map.of();
        Boolean predictedRain = date.isAfter(today) && forecast != null ? forecast.precipitation() : null;
        if (station != null && samples.size() >= MIN_SAMPLE_DAYS && (historical || predictedRain != null)) {
            LocalDate end = historical ? date : samples.getLast().date();
            rainfall = observations.rainfall(station, samples.getFirst().date(), end);
        }
        var observed = historical ? rainfall.get(date) : null;
        Boolean precipitation = historical ? observed == null ? null : observed.precipitation() : predictedRain;
        var actual = date.isBefore(today) ? ProductPosArchive.soldOn(archive, product, date) : null;
        return summarize(product, historical, actual, station == null ? null : station.name(),
                observed == null ? null : observed.rainfallMm(), precipitation, samples, rainfall,
                requiredPos(date, today), excludedDates);
    }

    static PosRequirement requiredPos(LocalDate target, LocalDate today) {
        var start = target.minusWeeks(LOOKBACK_WEEKS);
        var end = target.minusWeeks(1);
        while (!end.isBefore(today) && !end.isBefore(start)) end = end.minusWeeks(1);
        return end.isBefore(start) ? null : new PosRequirement(start, end, "PRODUCT", MIN_SAMPLE_DAYS);
    }

    static List<Sample> sameWeekdays(List<ProductPosArchive.Days> archive, String product, LocalDate target, LocalDate today) {
        var samples = new ArrayList<Sample>();
        for (LocalDate day = target.minusWeeks(LOOKBACK_WEEKS); day.isBefore(target) && day.isBefore(today); day = day.plusWeeks(1)) {
            var quantity = ProductPosArchive.soldOn(archive, product, day);
            if (quantity != null) samples.add(new Sample(day, quantity, null, null));
        }
        // The selected menu must have been sold before the target date.
        if (samples.stream().noneMatch(sample -> sample.quantity() > 0)) return List.of();
        return samples;
    }

    static Estimate summarize(String product, boolean historical, Long actual, String station, BigDecimal observed,
                              Boolean precipitation, List<Sample> samples, Map<LocalDate, KmaObservations.Observation> rainfall,
                              PosRequirement requiredPos, Set<LocalDate> excludedDates) {
        var dated = samples.stream().map(sample -> {
            var weather = rainfall.get(sample.date());
            return weather == null ? sample : new Sample(sample.date(), sample.quantity(), weather.rainfallMm(), weather.precipitation());
        }).toList();
        var excluded = dated.stream().map(Sample::date).filter(excludedDates::contains).toList();
        var original = range(dated, precipitation);
        var selected = excluded.isEmpty() ? original
                : range(dated.stream().filter(sample -> !excludedDates.contains(sample.date())).toList(), precipitation);
        return new Estimate(product, historical, actual, selected.bounds().basis(), selected.bounds().low(), selected.bounds().high(),
                selected.samples(), selected.weatherMatches(), precipitation, observed, rainfall.isEmpty() ? null : station,
                rainfall.isEmpty() ? null : KmaObservations.SOURCE_URL,
                original.bounds().basis() == Basis.INSUFFICIENT ? requiredPos : null,
                dated, excluded, excluded.isEmpty() ? null : original.bounds(), selected.calculation());
    }

    private static SampleRange range(List<Sample> samples, Boolean precipitation) {
        var ordered = samples.stream().sorted(Comparator.comparing(Sample::date)).toList();
        if (ordered.size() < MIN_SAMPLE_DAYS) {
            return new SampleRange(new Bounds(Basis.INSUFFICIENT, null, null), ordered, 0, null);
        }
        // Six same-weekday observations form two disjoint three-day periods. Updating to
        // the recent level once avoids multiplying a decline onto already-recent sales.
        boolean trend = ordered.size() >= 6;
        var used = ordered.subList(Math.max(0, ordered.size() - (trend ? 6 : 4)), ordered.size());
        var recent = trend ? used.subList(3, 6) : used;
        var previous = trend ? used.subList(0, 3) : List.<Sample>of();
        var baseline = average(used);
        var recentAverage = average(recent);
        var previousAverage = previous.isEmpty() ? null : average(previous);
        var change = previousAverage == null || previousAverage.signum() == 0 ? null
                : recentAverage.subtract(previousAverage).multiply(BigDecimal.valueOf(100))
                    .divide(previousAverage, 2, RoundingMode.HALF_UP);
        var wet = used.stream().filter(sample -> Boolean.TRUE.equals(sample.precipitation())).toList();
        var dry = used.stream().filter(sample -> Boolean.FALSE.equals(sample.precipitation())).toList();
        int matches = precipitation == null ? 0 : precipitation ? wet.size() : dry.size();
        BigDecimal factor = BigDecimal.ONE;
        boolean weather = false;
        String note;
        if (precipitation == null) {
            note = "선택한 날짜의 강수 여부를 확인하지 못해 날씨 보정을 적용하지 않았어요.";
        } else if (!trend || wet.size() < 3 || dry.size() < 3) {
            note = "강수·비강수 기록이 각각 3일 이상 필요해 날씨 보정을 적용하지 않았어요.";
        } else if (previousAverage.signum() == 0 || recentAverage.signum() == 0
                || !bothWeather(previous) || !bothWeather(recent)) {
            note = "이전·최근 기간에서 강수와 비강수 판매를 함께 비교할 수 없어 날씨 보정을 적용하지 않았어요.";
        } else {
            // Normalize each period by its own sales level, so an older rainy period
            // cannot be mistaken for a rain effect when the menu is declining.
            var normalized = BigDecimal.ZERO;
            for (var sample : precipitation ? wet : dry) {
                var level = recent.contains(sample) ? recentAverage : previousAverage;
                normalized = normalized.add(BigDecimal.valueOf(sample.quantity()).divide(level, 8, RoundingMode.HALF_UP));
            }
            factor = normalized.divide(BigDecimal.valueOf(matches), 4, RoundingMode.HALF_UP)
                    .max(new BigDecimal("0.8")).min(new BigDecimal("1.2"));
            weather = true;
            note = "기간별 판매 수준 차이를 나눠 비교한 강수 보정이에요. 보정 폭은 ±20% 이내로 제한해요.";
        }
        var low = boundedQuantity(recent.stream().mapToLong(Sample::quantity).min().orElseThrow(), factor, RoundingMode.FLOOR);
        var high = boundedQuantity(recent.stream().mapToLong(Sample::quantity).max().orElseThrow(), factor, RoundingMode.CEILING);
        var calculation = new Calculation(used.size(), baseline, previous.size(), previousAverage,
                recent.size(), recentAverage, change, trend, factor, weather, note,
                used.getLast().date(), recent.size());
        return new SampleRange(new Bounds(weather ? Basis.WEATHER : Basis.WEEKDAY, low, high), used, matches, calculation);
    }

    private static BigDecimal average(List<Sample> samples) {
        return samples.stream().map(sample -> BigDecimal.valueOf(sample.quantity())).reduce(BigDecimal.ZERO, BigDecimal::add)
                .divide(BigDecimal.valueOf(samples.size()), 4, RoundingMode.HALF_UP);
    }

    private static boolean bothWeather(List<Sample> samples) {
        return samples.stream().anyMatch(sample -> Boolean.TRUE.equals(sample.precipitation()))
                && samples.stream().anyMatch(sample -> Boolean.FALSE.equals(sample.precipitation()));
    }

    private static long boundedQuantity(long quantity, BigDecimal factor, RoundingMode rounding) {
        return BigDecimal.valueOf(quantity).multiply(factor).setScale(0, rounding)
                .min(BigDecimal.valueOf(9_007_199_254_740_991L)).max(BigDecimal.ZERO).longValueExact();
    }

    enum Basis { WEATHER, WEEKDAY, INSUFFICIENT }
    record Sample(LocalDate date, long quantity, BigDecimal rainfallMm, Boolean precipitation) {}
    record PosRequirement(LocalDate start, LocalDate end, String kind, int minimumDays) {}
    record Bounds(Basis basis, Long low, Long high) {}
    private record SampleRange(Bounds bounds, List<Sample> samples, int weatherMatches, Calculation calculation) {}
    record Calculation(int baselineDays, BigDecimal baselineAverage, int previousDays, BigDecimal previousAverage,
                       int recentDays, BigDecimal recentAverage, BigDecimal changePercent, boolean trendApplied,
                       BigDecimal weatherFactor, boolean weatherApplied, String weatherNote,
                       LocalDate latestSalesDate, int rangeDays) {}
    record Estimate(String product, boolean historical, Long actualSales, Basis basis, Long low, Long high,
                    List<Sample> samples, int weatherMatches, Boolean precipitation, BigDecimal observedRainfallMm,
                    String station, String observationSourceUrl, PosRequirement requiredPos,
                    List<Sample> candidates, List<LocalDate> excludedDates, Bounds originalBounds, Calculation calculation) {}
}
