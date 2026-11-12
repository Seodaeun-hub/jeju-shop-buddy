package com.jejushopbuddy.analysis;

import com.jejushopbuddy.address.NaverGeocodingClient;
import com.jejushopbuddy.address.NaverGeocodingClient.Coordinates;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.IntSummaryStatistics;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;

@Service
class KmaForecast {
    static final String SOURCE_URL = "https://www.data.go.kr/data/15084084/openapi.do";
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter DATE = DateTimeFormatter.BASIC_ISO_DATE;
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HHmm");
    private final NaverGeocodingClient geocoding;
    private final RestClient client;
    private final String key;

    KmaForecast(NaverGeocodingClient geocoding, @Value("${KMA_FORECAST_SERVICE_KEY:}") String key) {
        this.geocoding = geocoding;
        this.key = key.strip();
        var requests = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
        requests.setReadTimeout(Duration.ofSeconds(5));
        client = RestClient.builder().requestFactory(requests).baseUrl("https://apis.data.go.kr").build();
    }

    static boolean withinForecastWindow(LocalDate date) {
        LocalDate today = LocalDate.now(SEOUL);
        return !date.isBefore(today) && !date.isAfter(today.plusDays(3));
    }

    static boolean currentIssue(OffsetDateTime issuedAt) {
        return issuedAt != null && !issuedAt.isBefore(latestIssue(ZonedDateTime.now(SEOUL)).toOffsetDateTime());
    }

    Daily lookup(String address, String store, LocalDate date) {
        if (key.isEmpty() || !withinForecastWindow(date)) return null;
        return location(address, store).map(point -> lookup(point, date)).orElse(null);
    }

    Optional<Coordinates> location(String address, String store) {
        return geocoding.coordinates(buildingAddress(address, store));
    }

    Daily lookup(Coordinates location, LocalDate date) {
        if (key.isEmpty() || !withinForecastWindow(date)) return null;
        var grid = grid(location);
        var now = ZonedDateTime.now(SEOUL);
        var issue = latestIssue(now);
        try {
            JsonNode payload = client.get().uri(uri -> uri.path("/1360000/VilageFcstInfoService_2.0/getVilageFcst")
                    .queryParam("serviceKey", "{key}").queryParam("dataType", "JSON")
                    .queryParam("pageNo", 1).queryParam("numOfRows", 1500)
                    .queryParam("base_date", DATE.format(issue.toLocalDate())).queryParam("base_time", TIME.format(issue))
                    .queryParam("nx", grid.x()).queryParam("ny", grid.y()).build(key)).retrieve().body(JsonNode.class);
            return summarize(payload, grid, issue, date, date.equals(now.toLocalDate()) ? now.getHour() : 0);
        } catch (RestClientException unavailable) {
            return null;
        }
    }

    static ZonedDateTime latestIssue(ZonedDateTime now) {
        // The 02:00, 05:00, ... 23:00 runs are available 10 minutes after release.
        var available = now.withZoneSameInstant(SEOUL).minusMinutes(10);
        int hoursSinceIssue = Math.floorMod(available.getHour() - 2, 3);
        return available.withMinute(0).withSecond(0).withNano(0).minusHours(hoursSinceIssue);
    }

    static String buildingAddress(String address, String store) {
        String value = address.strip();
        String suffix = " " + store;
        return value.endsWith(suffix)
                ? value.substring(0, value.length() - suffix.length()).replaceFirst("[,\\s]+$", "") : value;
    }

    // KMA's 5 km Lambert conformal conic grid parameters.
    static Grid grid(Coordinates point) {
        double radius = 6371.00877 / 5.0;
        double parallel1 = Math.toRadians(30);
        double parallel2 = Math.toRadians(60);
        double tangent1 = Math.tan(Math.PI / 4 + parallel1 / 2);
        double tangent2 = Math.tan(Math.PI / 4 + parallel2 / 2);
        double cone = Math.log(Math.cos(parallel1) / Math.cos(parallel2)) / Math.log(tangent2 / tangent1);
        double scale = radius * Math.pow(tangent1, cone) * Math.cos(parallel1) / cone;
        double origin = scale / Math.pow(Math.tan(Math.PI / 4 + Math.toRadians(38) / 2), cone);
        double distance = scale / Math.pow(Math.tan(Math.PI / 4 + Math.toRadians(point.latitude()) / 2), cone);
        double angle = Math.toRadians(point.longitude() - 126) * cone;
        return new Grid((int) Math.round(distance * Math.sin(angle) + 43),
                (int) Math.round(origin - distance * Math.cos(angle) + 136));
    }

    static Daily summarize(JsonNode payload, Grid grid, ZonedDateTime issue, LocalDate date, int firstHour) {
        if (payload == null) return null;
        var response = payload.path("response");
        var header = response.path("header");
        if (header.path("resultCode").asInt(-1) != 0) return null;
        var rows = response.path("body").path("items").path("item");
        if (!rows.isArray()) return null;
        String day = DATE.format(date);
        String baseDate = DATE.format(issue.toLocalDate());
        String baseTime = TIME.format(issue);
        var temperature = new IntSummaryStatistics();
        int probability = -1;
        int sky = 0;
        boolean rain = false;
        boolean snow = false;
        boolean precipitationKnown = false;
        for (var row : rows) {
            if (!day.equals(row.path("fcstDate").asString()) || !baseDate.equals(row.path("baseDate").asString())
                    || !baseTime.equals(row.path("baseTime").asString()) || row.path("nx").asInt(-1) != grid.x()
                    || row.path("ny").asInt(-1) != grid.y()) continue;
            String slot = row.path("fcstTime").asString();
            if (!slot.matches("(?:[01][0-9]|2[0-3])00") || LocalTime.parse(slot, TIME).getHour() < firstHour) continue;
            int value = row.path("fcstValue").asInt(Integer.MIN_VALUE);
            switch (row.path("category").asString()) {
                case "PTY" -> {
                    precipitationKnown |= value >= 0 && value <= 4;
                    rain |= value == 1 || value == 2 || value == 4;
                    snow |= value == 2 || value == 3;
                }
                case "SKY" -> { if (value == 1 || value == 3 || value == 4) sky = Math.max(sky, value); }
                case "TMP" -> { if (value >= -70 && value <= 60) temperature.accept(value); }
                case "POP" -> { if (value >= 0 && value <= 100) probability = Math.max(probability, value); }
                default -> { }
            }
        }
        String label = rain && snow ? "비·눈 예보" : rain ? "비 예보" : snow ? "눈 예보"
                : switch (sky) {
                    case 1 -> "맑음 예보";
                    case 3 -> "구름 예보";
                    case 4 -> "흐림 예보";
                    default -> null;
                };
        if (label == null) return null;
        return new Daily(label, issue.toOffsetDateTime(), temperature.getCount() == 0 ? null : temperature.getMin(),
                temperature.getCount() == 0 ? null : temperature.getMax(), probability < 0 ? null : probability,
                precipitationKnown ? rain || snow : null);
    }

    record Grid(int x, int y) {}
    record Daily(String label, OffsetDateTime issuedAt, Integer minTemperature, Integer maxTemperature,
                 Integer maxPrecipitationProbability, Boolean precipitation) {}
}
