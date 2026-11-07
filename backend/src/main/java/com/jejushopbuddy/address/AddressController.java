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

    AddressController(NaverGeocodingClient geocoding) {
        this.geocoding = geocoding;
    }

    @GetMapping("/api/addresses")
    public List<AddressMatch> search(@RequestParam String query) {
        String addressQuery = query.strip();
        if (addressQuery.length() < 2 || addressQuery.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter an address between 2 and 200 characters.");
        }
        return geocoding.search(addressQuery);
    }

    public record AddressMatch(String address, String area) {}
}
