package com.jejushopbuddy.analysis;

import com.jejushopbuddy.address.NaverGeocodingClient.Coordinates;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
class InventoryDemand {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final int LOOKBACK_WEEKS = 12;
    private static final int MIN_SAMPLE_DAYS = 3;
    private final ProductPosArchive pos;
    private final KmaObservations observations;

    InventoryDemand(ProductPosArchive pos, KmaObservations observations) {
        this.pos = pos;
        this.observations = observations;
    }

    Estimate estimate(UUID store, Coordinates location, String product, LocalDate date, KmaForecast.Daily forecast) {
        LocalDate today = LocalDate.now(SEOUL);
        boolean historical = date.isBefore(today);
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
        var actual = historical ? ProductPosArchive.soldOn(archive, product, date) : null;
        return summarize(product, historical, actual, station == null ? null : station.name(),
                observed == null ? null : observed.rainfallMm(), precipitation, samples, rainfall,
                requiredPos(date, today));
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
                              PosRequirement requiredPos) {
        var dated = samples.stream().map(sample -> {
            var weather = rainfall.get(sample.date());
            return weather == null ? sample : new Sample(sample.date(), sample.quantity(), weather.rainfallMm(), weather.precipitation());
        }).toList();
        var comparable = dated.stream().filter(sample -> precipitation != null && precipitation.equals(sample.precipitation())).toList();
        boolean weatherMatch = comparable.size() >= MIN_SAMPLE_DAYS;
        var used = weatherMatch ? comparable : dated;
        boolean enough = used.size() >= MIN_SAMPLE_DAYS;
        return new Estimate(product, historical, actual, enough ? weatherMatch ? Basis.WEATHER : Basis.WEEKDAY : Basis.INSUFFICIENT,
                enough ? used.stream().mapToLong(Sample::quantity).min().orElseThrow() : null,
                enough ? used.stream().mapToLong(Sample::quantity).max().orElseThrow() : null,
                used, comparable.size(), precipitation, observed, rainfall.isEmpty() ? null : station,
                rainfall.isEmpty() ? null : KmaObservations.SOURCE_URL, enough ? null : requiredPos);
    }

    enum Basis { WEATHER, WEEKDAY, INSUFFICIENT }
    record Sample(LocalDate date, long quantity, BigDecimal rainfallMm, Boolean precipitation) {}
    record PosRequirement(LocalDate start, LocalDate end, String kind, int minimumDays) {}
    record Estimate(String product, boolean historical, Long actualSales, Basis basis, Long low, Long high,
                    List<Sample> samples, int weatherMatches, Boolean precipitation, BigDecimal observedRainfallMm,
                    String station, String observationSourceUrl, PosRequirement requiredPos) {}
}
