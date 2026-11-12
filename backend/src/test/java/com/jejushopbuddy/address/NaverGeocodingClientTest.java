package com.jejushopbuddy.address;

import static org.assertj.core.api.Assertions.assertThat;

import com.jejushopbuddy.address.AddressController.AddressMatch;
import com.jejushopbuddy.address.NaverGeocodingClient.GeocodingResponse;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class NaverGeocodingClientTest {
    @Test
    void extractsJejuDistrictFromNaverAddressElements() {
        var response = new JsonMapper().readValue("""
                {
                  "status": "OK",
                  "addresses": [
                    {
                      "roadAddress": "",
                      "jibunAddress": "제주특별자치도 제주시 애월읍 예시리 1",
                      "x": "126.38",
                      "y": "33.46",
                      "addressElements": [
                        {"types": ["SIDO"], "longName": "제주특별자치도"},
                        {"types": ["SIGUGUN"], "longName": "제주시"},
                        {"types": ["DONGMYUN"], "longName": "애월읍"}
                      ]
                    },
                    {
                      "roadAddress": "경기도 성남시 분당구 불정로 6",
                      "addressElements": [
                        {"types": ["SIDO"], "longName": "경기도"},
                        {"types": ["SIGUGUN"], "longName": "성남시 분당구"},
                        {"types": ["DONGMYUN"], "longName": "정자동"}
                      ]
                    }
                  ]
                }
                """, GeocodingResponse.class);

        assertThat(NaverGeocodingClient.jejuMatches(response))
                .containsExactly(new AddressMatch("제주특별자치도 제주시 애월읍 예시리 1", "제주시 애월읍"));
        assertThat(NaverGeocodingClient.exactJejuCoordinates(response, "제주 제주시 애월읍 예시리 1"))
                .contains(new NaverGeocodingClient.Coordinates(33.46, 126.38));
        assertThat(NaverGeocodingClient.exactJejuCoordinates(response, "제주 제주시 애월읍 예시리 1 1층"))
                .contains(new NaverGeocodingClient.Coordinates(33.46, 126.38));
        assertThat(NaverGeocodingClient.exactJejuCoordinates(response, "제주 제주시 애월읍 예시리 11")).isEmpty();
    }
}
