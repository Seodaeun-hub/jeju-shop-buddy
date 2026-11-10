package com.jejushopbuddy.address;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class AddressController {
    private final NaverGeocodingClient geocoding;
    private final NaverPlaceSearchClient places;

    AddressController(NaverGeocodingClient geocoding, NaverPlaceSearchClient places) {
        this.geocoding = geocoding;
        this.places = places;
    }

    @GetMapping("/api/addresses")
    public List<AddressMatch> search(@RequestParam String query) {
        return geocoding.search(validateQuery(query));
    }

    @GetMapping("/api/addresses/places")
    public List<PlaceMatch> searchPlaces(@RequestParam String query) {
        return places.search(validateQuery(query));
    }

    private static String validateQuery(String query) {
        String searchTerm = query.strip();
        if (searchTerm.length() < 2 || searchTerm.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a search term between 2 and 200 characters.");
        }
        return searchTerm;
    }

    public record AddressMatch(String address, String area) {}

    public record PlaceMatch(String name, String address, String area) {}
}
