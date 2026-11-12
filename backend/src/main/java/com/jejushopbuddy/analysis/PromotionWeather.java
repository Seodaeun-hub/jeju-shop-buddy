package com.jejushopbuddy.analysis;

import com.jejushopbuddy.address.NaverGeocodingClient;
import com.jejushopbuddy.analysis.PromotionDraftController.ChannelCopy;
import com.jejushopbuddy.analysis.StorePromotionToneController.Tone;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;

@Service
class PromotionWeather {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final String SOURCE = "https://open-meteo.com/en/docs";
    private final NaverGeocodingClient geocoding;
    private final RestClient weather;
    private final String apiKey;

    PromotionWeather(NaverGeocodingClient geocoding, @Value("${SHOP_BUDDY_WEATHER_API_KEY:}") String apiKey) {
        this.geocoding = geocoding;
        this.apiKey = apiKey;
        var requests = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
        requests.setReadTimeout(Duration.ofSeconds(5));
        weather = RestClient.builder().requestFactory(requests)
                .baseUrl(apiKey.isBlank() ? "https://api.open-meteo.com" : "https://customer-api.open-meteo.com").build();
    }

    static boolean withinForecastWindow(LocalDate date) {
        LocalDate today = LocalDate.now(SEOUL);
        return !date.isBefore(today) && !date.isAfter(today.plusDays(6));
    }

    Context resolve(String address, String store, String area, LocalDate date, String avoid) {
        String forecast = null;
        if (withinForecastWindow(date)) {
            var coordinates = geocoding.coordinates(buildingAddress(address, store));
            if (coordinates.isPresent()) forecast = forecast(coordinates.get(), date);
        }
        return context(area, date, forecast, avoid);
    }

    static String buildingAddress(String address, String store) {
        String value = address.strip();
        String suffix = " " + store;
        return value.endsWith(suffix)
                ? value.substring(0, value.length() - suffix.length()).replaceFirst("[,\\s]+$", "") : value;
    }

    private String forecast(NaverGeocodingClient.Coordinates location, LocalDate date) {
        try {
            JsonNode body = weather.get().uri(builder -> {
                builder.path("/v1/forecast").queryParam("latitude", location.latitude())
                        .queryParam("longitude", location.longitude()).queryParam("daily", "weather_code")
                        .queryParam("timezone", SEOUL.getId()).queryParam("start_date", date).queryParam("end_date", date);
                if (!apiKey.isBlank()) builder.queryParam("apikey", apiKey);
                return builder.build();
            }).retrieve().body(JsonNode.class);
            return forecastFor(body, date);
        } catch (RestClientException unavailable) {
            return null;
        }
    }

    static String forecastFor(JsonNode response, LocalDate date) {
        if (response == null || !SEOUL.getId().equals(response.path("timezone").asString())) return null;
        var days = response.path("daily").path("time");
        var codes = response.path("daily").path("weather_code");
        if (!days.isArray() || !codes.isArray() || days.size() != codes.size()) return null;
        for (int i = 0; i < days.size(); i++) {
            if (!date.toString().equals(days.get(i).asString()) || !codes.get(i).isIntegralNumber()) continue;
            return switch (codes.get(i).asInt()) {
                case 0, 1 -> "맑음 예보";
                case 2, 3 -> "구름 예보";
                case 45, 48 -> "안개 예보";
                case 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82 -> "비 예보";
                case 71, 73, 75, 77, 85, 86 -> "눈 예보";
                case 95, 96, 99 -> "뇌우 예보";
                default -> null;
            };
        }
        return null;
    }

    static Context context(String area, LocalDate date, String forecast, String avoid) {
        String season = switch (date.getMonthValue()) {
            case 3, 4, 5 -> "봄";
            case 6, 7, 8 -> "여름";
            case 9, 10, 11 -> "가을";
            default -> "겨울";
        };
        String day = "제주의 " + season + "날";
        String intro = switch (forecast == null ? "" : forecast) {
            case "맑음 예보" -> "맑을 것으로 예보된 " + day;
            case "구름 예보" -> "구름이 낄 것으로 예보된 " + day;
            case "" -> day;
            default -> forecast + "가 있는 " + day;
        };
        var leads = new ChannelCopy(
                allowed(intro + ", 저희 가게 소식을 전해요.", avoid),
                allowed(intro + "에 맞춰 매장 소식을 안내드립니다.", avoid),
                allowed(intro + "이네요. 동네에서 들르실 때 참고해 주세요.", avoid));
        return new Context(date, area, season, forecast, forecast == null ? null : SOURCE, leads);
    }

    private static String allowed(String line, String avoid) {
        return Tone.containsAvoidedPhrase(line, avoid) ? "" : line;
    }

    record Context(LocalDate date, String area, String season, String forecast, String sourceUrl, ChannelCopy leads) {}
}
