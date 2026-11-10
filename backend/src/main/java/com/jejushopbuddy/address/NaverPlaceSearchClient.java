package com.jejushopbuddy.address;

import com.jejushopbuddy.address.AddressController.PlaceMatch;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.HtmlUtils;

@Service
class NaverPlaceSearchClient {
    private static final Pattern JEJU_ADDRESS = Pattern.compile(
            "^(?:제주특별자치도|제주도|제주)\\s+(제주시|서귀포시)\\s+(\\S+)");
    private static final Pattern HIGHLIGHT = Pattern.compile("</?b>", Pattern.CASE_INSENSITIVE);

    private final RestClient client;
    private final boolean configured;

    NaverPlaceSearchClient(
            @Value("${NAVER_LOCAL_SEARCH_CLIENT_ID:}") String clientId,
            @Value("${NAVER_LOCAL_SEARCH_CLIENT_SECRET:}") String clientSecret) {
        var httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(Duration.ofSeconds(5));
        this.client = RestClient.builder().requestFactory(requestFactory)
                .baseUrl("https://naverapihub.apigw.ntruss.com")
                .defaultHeader("X-NCP-APIGW-API-KEY-ID", clientId)
                .defaultHeader("X-NCP-APIGW-API-KEY", clientSecret)
                .build();
        this.configured = !clientId.isBlank() && !clientSecret.isBlank();
    }

    List<PlaceMatch> search(String query) {
        if (!configured) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Place search is not configured.");
        }
        String localQuery = query.contains("제주") || query.contains("서귀포") ? query : "제주 " + query;
        LocalSearchResponse response;
        try {
            response = client.get()
                    .uri("/search/v1/local?query={query}&display=5", localQuery)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .body(LocalSearchResponse.class);
        } catch (RestClientException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Place search provider is unavailable.");
        }
        if (response == null || response.items() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Invalid place search provider response.");
        }
        return jejuMatches(response);
    }

    static List<PlaceMatch> jejuMatches(LocalSearchResponse response) {
        return response.items().stream()
                .filter(Objects::nonNull)
                .map(NaverPlace::toJejuMatch)
                .flatMap(Optional::stream)
                .distinct()
                .toList();
    }

    record LocalSearchResponse(List<NaverPlace> items) {}

    record NaverPlace(String title, String address, String roadAddress) {
        private Optional<PlaceMatch> toJejuMatch() {
            if (title == null || roadAddress == null) return Optional.empty();
            String name = HtmlUtils.htmlUnescape(HIGHLIGHT.matcher(title).replaceAll("")).strip();
            String road = roadAddress.strip();
            var location = JEJU_ADDRESS.matcher(road);
            if (name.isBlank() || road.length() > 255 || !location.find()) return Optional.empty();

            // Local Search includes a lot address with the district even when the road address omits it.
            var lot = JEJU_ADDRESS.matcher(address == null ? "" : address.strip());
            String area = "";
            if (lot.find() && location.group(1).equals(lot.group(1))) {
                String district = lot.group(2);
                if (district.matches(".+[읍면동]")) {
                    area = lot.group(1) + " " + district;
                }
            }
            return Optional.of(new PlaceMatch(name, road, area));
        }
    }
}
