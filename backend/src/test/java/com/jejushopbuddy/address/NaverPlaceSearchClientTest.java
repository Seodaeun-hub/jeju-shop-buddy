package com.jejushopbuddy.address;

import static org.assertj.core.api.Assertions.assertThat;

import com.jejushopbuddy.address.AddressController.PlaceMatch;
import com.jejushopbuddy.address.NaverPlaceSearchClient.LocalSearchResponse;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class NaverPlaceSearchClientTest {
    @Test
    void extractsJejuRoadAddressesAndPlainBusinessNames() {
        var response = new JsonMapper().readValue("""
                {
                  "items": [
                    {
                      "title": "<b>애월</b> 국수 &amp; 식당",
                      "address": "제주특별자치도 제주시 애월읍 예시리 1",
                      "roadAddress": "제주특별자치도 제주시 애월해안로 123"
                    },
                    {
                      "title": "시내 식당",
                      "roadAddress": "제주 제주시 중앙로 5"
                    },
                    {
                      "title": "다른 지역",
                      "roadAddress": "경기도 성남시 불정로 6"
                    },
                    {
                      "title": "도로명 주소 없음",
                      "address": "제주특별자치도 제주시 애월읍 예시리 2",
                      "roadAddress": ""
                    }
                  ]
                }
                """, LocalSearchResponse.class);

        assertThat(NaverPlaceSearchClient.jejuMatches(response)).containsExactly(
                new PlaceMatch("애월 국수 & 식당", "제주특별자치도 제주시 애월해안로 123", "제주시 애월읍"),
                new PlaceMatch("시내 식당", "제주 제주시 중앙로 5", ""));
    }
}
