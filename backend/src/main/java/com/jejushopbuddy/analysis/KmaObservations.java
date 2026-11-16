package com.jejushopbuddy.analysis;

import com.jejushopbuddy.address.NaverGeocodingClient.Coordinates;
import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;

@Service
class KmaObservations {
    static final String SOURCE_URL = "https://www.data.go.kr/data/15059093/openapi.do";
    private static final Pattern PRECIPITATION_EVENT =
            Pattern.compile("\\{(?:비|소나기|이슬비|눈|소낙눈|진눈깨비|우박|싸락눈|가루눈|싸락우박|어는\\s?비|어는\\s?이슬비)\\}");
    // WGS84 station locations from the KMA station metadata catalog.
    private static final List<Station> STATIONS = List.of(
            new Station(184, "제주", 33.51411, 126.52969),
            new Station(185, "고산", 33.29382, 126.16283),
            new Station(188, "성산", 33.38677, 126.8802),
            new Station(189, "서귀포", 33.24616, 126.5653));
    private final RestClient client;
    private final String key;

    @Autowired
    KmaObservations(@Value("${KMA_ASOS_SERVICE_KEY:${KMA_FORECAST_SERVICE_KEY:}}") String key) {
        this(providerClient(), key);
    }

    KmaObservations(RestClient.Builder client, String key) {
        this.key = key.strip();
        this.client = client.baseUrl("https://apis.data.go.kr").build();
    }

    private static RestClient.Builder providerClient() {
        var requests = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
        requests.setReadTimeout(Duration.ofSeconds(5));
        return RestClient.builder().requestFactory(requests);
    }

    static Station nearest(Coordinates location) {
        return STATIONS.stream().min(Comparator.comparingDouble(station -> {
            double north = location.latitude() - station.latitude();
            double east = (location.longitude() - station.longitude()) * Math.cos(Math.toRadians(location.latitude()));
            return north * north + east * east;
        })).orElseThrow();
    }

    Map<LocalDate, Observation> rainfall(Station station, LocalDate start, LocalDate end) {
        if (key.isEmpty() || start.isAfter(end)) return Map.of();
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                return rainfallFrom(fetchRainfall(station, start, end), station.id(), start, end);
            } catch (ResourceAccessException | HttpServerErrorException unavailable) {
                if (Thread.currentThread().isInterrupted()) break;
            } catch (RestClientException unavailable) {
                break;
            }
        }
        return Map.of();
    }

    private JsonNode fetchRainfall(Station station, LocalDate start, LocalDate end) {
        var date = DateTimeFormatter.BASIC_ISO_DATE;
        return client.get().uri(uri -> uri.path("/1360000/AsosDalyInfoService/getWthrDataList")
                .queryParam("serviceKey", "{key}").queryParam("dataType", "JSON")
                .queryParam("dataCd", "ASOS").queryParam("dateCd", "DAY").queryParam("pageNo", 1)
                .queryParam("numOfRows", 100).queryParam("stnIds", station.id())
                .queryParam("startDt", date.format(start)).queryParam("endDt", date.format(end))
                .build(key)).retrieve().body(JsonNode.class);
    }

    static Map<LocalDate, Observation> rainfallFrom(JsonNode payload, int station, LocalDate start, LocalDate end) {
        if (payload == null) return Map.of();
        var response = payload.path("response");
        if (response.path("header").path("resultCode").asInt(-1) != 0) return Map.of();
        var items = response.path("body").path("items").path("item");
        if (!items.isArray()) return Map.of();
        var result = new HashMap<LocalDate, Observation>();
        for (var row : items) {
            if (row.path("stnId").asInt(-1) != station) continue;
            try {
                var day = LocalDate.parse(row.path("tm").asString());
                if (day.isBefore(start) || day.isAfter(end)) continue;
                var amount = row.path("sumRn");
                var phenomena = row.path("iscs");
                boolean precipitation = PRECIPITATION_EVENT.matcher(phenomena.asString("")).find();
                String value = amount.asString("");
                if (!value.isBlank()) {
                    var rain = new BigDecimal(value);
                    if (rain.signum() >= 0) result.put(day, new Observation(rain, precipitation || rain.signum() > 0));
                } else if (amount.isString() && phenomena.isString() && Double.isFinite(row.path("avgTa").asDouble(Double.NaN))) {
                    // ASOS leaves the amount blank for days without measured precipitation. Use the
                    // weather phenomena record on a reported observation day and keep the amount blank.
                    result.put(day, new Observation(null, precipitation));
                }
            } catch (DateTimeParseException | NumberFormatException invalid) {
                // Leave incomplete observations out of the weather match.
            }
        }
        return Map.copyOf(result);
    }

    record Station(int id, String name, double latitude, double longitude) {}
    record Observation(BigDecimal rainfallMm, boolean precipitation) {}
}
