package com.jejushopbuddy.address;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.jejushopbuddy.address.AddressController.AddressMatch;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

@Service
class NaverGeocodingClient {
    private final RestClient client;
    private final boolean configured;

    NaverGeocodingClient(
            @Value("${NAVER_MAPS_CLIENT_ID:}") String clientId,
            @Value("${NAVER_MAPS_CLIENT_SECRET:}") String clientSecret) {
        var httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(Duration.ofSeconds(5));
        this.client = RestClient.builder().requestFactory(requestFactory)
                .baseUrl("https://maps.apigw.ntruss.com")
                .defaultHeader("x-ncp-apigw-api-key-id", clientId)
                .defaultHeader("x-ncp-apigw-api-key", clientSecret)
                .build();
        this.configured = !clientId.isBlank() && !clientSecret.isBlank();
    }

    List<AddressMatch> search(String query) {
        if (!configured) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Address search is not configured.");
        }
        GeocodingResponse response;
        try {
            response = client.get()
                    .uri("/map-geocode/v2/geocode?query={query}", query)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .body(GeocodingResponse.class);
        } catch (RestClientException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Address provider is unavailable.");
        }
        if (response == null || !"OK".equals(response.status()) || response.addresses() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Invalid address provider response.");
        }
        return jejuMatches(response);
    }

    static List<AddressMatch> jejuMatches(GeocodingResponse response) {
        return response.addresses().stream()
                .map(NaverAddress::toJejuMatch)
                .flatMap(Optional::stream)
                .distinct()
                .toList();
    }

    record GeocodingResponse(String status, List<NaverAddress> addresses) {}

    record NaverAddress(String roadAddress, String jibunAddress, List<AddressElement> addressElements) {
        private Optional<AddressMatch> toJejuMatch() {
            String province = elementName("SIDO");
            String city = elementName("SIGUGUN");
            String district = elementName("DONGMYUN");
            String address = roadAddress == null || roadAddress.isBlank() ? jibunAddress : roadAddress;
            if (!province.startsWith("제주") || city.isBlank() || district.isBlank()
                    || address == null || address.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(new AddressMatch(address, city + " " + district));
        }

        private String elementName(String type) {
            if (addressElements == null) {
                return "";
            }
            return addressElements.stream()
                    .filter(element -> element.types() != null && element.types().contains(type))
                    .map(AddressElement::longName)
                    .filter(Objects::nonNull)
                    .findFirst().orElse("").strip();
        }
    }

    record AddressElement(@JsonAlias("type") List<String> types, String longName) {}
}
