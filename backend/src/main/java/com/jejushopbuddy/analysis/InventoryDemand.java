package com.jejushopbuddy.analysis;

import com.jejushopbuddy.address.NaverGeocodingClient.Coordinates;
import com.jejushopbuddy.time.BusinessDate;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
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
                dated, excluded, excluded.isEmpty() ? null : original.bounds());
    }

    private static SampleRange range(List<Sample> samples, Boolean precipitation) {
        var comparable = samples.stream().filter(sample -> precipitation != null && precipitation.equals(sample.precipitation())).toList();
        boolean weatherMatch = comparable.size() >= MIN_SAMPLE_DAYS;
        var used = weatherMatch ? comparable : samples;
        boolean enough = used.size() >= MIN_SAMPLE_DAYS && samples.stream().anyMatch(sample -> sample.quantity() > 0);
        var bounds = enough ? new Bounds(weatherMatch ? Basis.WEATHER : Basis.WEEKDAY,
                used.stream().mapToLong(Sample::quantity).min().orElseThrow(),
                used.stream().mapToLong(Sample::quantity).max().orElseThrow()) : new Bounds(Basis.INSUFFICIENT, null, null);
        return new SampleRange(bounds, used, comparable.size());
    }

    enum Basis { WEATHER, WEEKDAY, INSUFFICIENT }
    record Sample(LocalDate date, long quantity, BigDecimal rainfallMm, Boolean precipitation) {}
    record PosRequirement(LocalDate start, LocalDate end, String kind, int minimumDays) {}
    record Bounds(Basis basis, Long low, Long high) {}
    private record SampleRange(Bounds bounds, List<Sample> samples, int weatherMatches) {}
    record Estimate(String product, boolean historical, Long actualSales, Basis basis, Long low, Long high,
                    List<Sample> samples, int weatherMatches, Boolean precipitation, BigDecimal observedRainfallMm,
                    String station, String observationSourceUrl, PosRequirement requiredPos,
                    List<Sample> candidates, List<LocalDate> excludedDates, Bounds originalBounds) {}
}
