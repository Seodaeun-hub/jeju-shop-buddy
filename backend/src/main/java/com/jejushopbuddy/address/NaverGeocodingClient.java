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
public class NaverGeocodingClient {
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
        return jejuMatches(lookup(query));
    }

    public Optional<Coordinates> coordinates(String address) {
        if (!configured || address == null || address.isBlank()) return Optional.empty();
        try {
            return exactJejuCoordinates(lookup(address), address);
        } catch (ResponseStatusException unavailable) {
            return Optional.empty();
        }
    }

    private GeocodingResponse lookup(String query) {
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
        return response;
    }

    static List<AddressMatch> jejuMatches(GeocodingResponse response) {
        return response.addresses().stream()
                .map(NaverAddress::toJejuMatch)
                .flatMap(Optional::stream)
                .distinct()
                .toList();
    }

    static Optional<Coordinates> exactJejuCoordinates(GeocodingResponse response, String address) {
        String expected = addressKey(address);
        var matches = response.addresses().stream()
                .filter(candidate -> candidate.toJejuMatch().isPresent())
                .filter(candidate -> expected.equals(addressKey(candidate.roadAddress()))
                        || expected.equals(addressKey(candidate.jibunAddress())))
                .map(NaverAddress::coordinates).flatMap(Optional::stream).distinct().limit(2).toList();
        return matches.size() == 1 ? Optional.of(matches.getFirst()) : Optional.empty();
    }

    private static String addressKey(String address) {
        return address == null ? "" : address.strip().replaceFirst("(?:\\s+(?:지하\\s*)?\\d+(?:층|호))+$", "")
                .replaceFirst("^제주(?:특별자치도|도)?\\s+", "")
                .replaceAll("\\s", "");
    }

    public record Coordinates(double latitude, double longitude) {}
    record GeocodingResponse(String status, List<NaverAddress> addresses) {}

    record NaverAddress(String roadAddress, String jibunAddress, List<AddressElement> addressElements, String x, String y) {
        private Optional<Coordinates> coordinates() {
            if (x == null || y == null) return Optional.empty();
            try {
                double latitude = Double.parseDouble(y);
                double longitude = Double.parseDouble(x);
                return latitude >= 33 && latitude < 35 && longitude >= 125 && longitude < 128
                        ? Optional.of(new Coordinates(latitude, longitude)) : Optional.empty();
            } catch (NumberFormatException invalid) {
                return Optional.empty();
            }
        }
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
