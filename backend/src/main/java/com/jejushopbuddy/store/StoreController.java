package com.jejushopbuddy.store;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.security.Principal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
class StoreController {
    private static final Set<String> FIELDS = Set.of(
            "name", "address", "addressDetail", "addressSource",
            "areaCode", "industryCode", "customIndustryName");
    private static final Set<String> INDUSTRIES = Set.of(
            "KOREAN_RESTAURANT", "CHINESE_RESTAURANT", "JAPANESE_RESTAURANT",
            "WESTERN_RESTAURANT", "OTHER_FOREIGN_RESTAURANT", "PIZZA_BURGER_SANDWICH",
            "CAFE", "BAR", "BAKERY_RETAIL", "SUPERMARKET", "CONVENIENCE_STORE",
            "PRODUCE_RETAIL", "SEAFOOD_RETAIL", "MEAT_RETAIL", "SOUVENIR_RETAIL",
            "COSMETICS_RETAIL", "HOTEL", "MOTEL", "RESORT_CONDO", "TRAVEL_AGENCY", "OTHER");

    private final JdbcClient jdbc;

    StoreController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/stores")
    List<StoreResponse> list(Principal owner) {
        return jdbc.sql("""
                SELECT s.*, a.name AS area_name, (
                    SELECT COUNT(*) FROM (
                        SELECT p.product_name
                        FROM analysis_product_sales p
                        JOIN sales_analyses analysis ON analysis.id = p.analysis_id
                        WHERE analysis.store_id = s.id
                        UNION
                        SELECT photo.product_name FROM store_product_photos photo WHERE photo.store_id = s.id
                    ) AS menu
                ) AS menu_count
                FROM stores s
                JOIN owners o ON o.id = s.owner_id
                JOIN jeju_areas a ON a.code = s.area_code
                WHERE o.email = :email
                ORDER BY s.created_at DESC, s.id
                """)
                .param("email", owner.getName())
                .query((rs, row) -> new StoreResponse(rs.getObject("id", UUID.class),
                        rs.getString("name"), rs.getString("address"), rs.getString("address_detail"),
                        rs.getString("address_source"), rs.getString("area_code"), rs.getString("area_name"),
                        rs.getString("industry_code"), rs.getString("custom_industry_name"),
                        rs.getObject("created_at", OffsetDateTime.class), rs.getLong("menu_count")))
                .list();
    }

    @GetMapping("/api/areas")
    List<AreaResponse> areas() {
        return jdbc.sql("SELECT code, name FROM jeju_areas ORDER BY name")
                .query(AreaResponse.class)
                .list();
    }

    record AreaResponse(String code, String name) {}

    @PostMapping(path = "/api/stores", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> create(@RequestBody JsonNode body, Principal owner) {
        StoreInput input = StoreInput.read(body);
        var areaName = jdbc.sql("SELECT name FROM jeju_areas WHERE code = :code")
                .param("code", input.areaCode())
                .query(String.class)
                .optional()
                .orElseThrow(() -> new InvalidStore("INVALID_AREA", "제주 읍·면·동을 선택해 주세요.", "areaCode"));

        var id = UUID.randomUUID();
        var createdAt = jdbc.sql("""
                INSERT INTO stores (id, owner_id, area_code, name, address, address_detail,
                                    address_source, industry_code, custom_industry_name)
                SELECT :id, id, :areaCode, :name, :address, :addressDetail,
                       :addressSource, :industryCode, :customIndustryName
                FROM owners WHERE email = :ownerEmail
                RETURNING created_at
                """)
                .param("id", id)
                .param("ownerEmail", owner.getName())
                .param("areaCode", input.areaCode())
                .param("name", input.name())
                .param("address", input.address())
                .param("addressDetail", input.addressDetail())
                .param("addressSource", input.addressSource())
                .param("industryCode", input.industryCode())
                .param("customIndustryName", input.customIndustryName())
                .query((rs, row) -> rs.getObject("created_at", OffsetDateTime.class))
                .optional();

        if (createdAt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(StoreSecurityConfiguration.AUTH_REQUIRED);
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(new StoreResponse(
                id, input.name(), input.address(), input.addressDetail(), input.addressSource(),
                input.areaCode(), areaName, input.industryCode(), input.customIndustryName(), createdAt.get(), 0));
    }

    @ExceptionHandler(InvalidStore.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError invalidStore(InvalidStore failure) {
        return failure.error;
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError invalidJson() {
        return new ApiError("INVALID_REQUEST", "매장 정보를 올바른 JSON 형식으로 입력해 주세요.", null);
    }

    private record StoreInput(String name, String address, String addressDetail, String addressSource,
                              String areaCode, String industryCode, String customIndustryName) {
        static StoreInput read(JsonNode body) {
            if (!body.isObject()) {
                throw new InvalidStore("INVALID_REQUEST", "매장 정보를 JSON 객체로 입력해 주세요.", null);
            }
            for (String field : body.propertyNames()) {
                if (!FIELDS.contains(field)) {
                    throw new InvalidStore("INVALID_REQUEST", "지원하지 않는 입력 항목이에요.", field);
                }
            }
            String name = text(body, "name", 100, true, "INVALID_REQUEST");
            String address = text(body, "address", 255, true, "INVALID_REQUEST");
            String addressDetail = text(body, "addressDetail", 100, false, "INVALID_REQUEST");
            String addressSource = text(body, "addressSource", 6, true, "INVALID_REQUEST");
            if (!Set.of("SEARCH", "MANUAL").contains(addressSource)) {
                throw new InvalidStore("INVALID_REQUEST", "주소 입력 방식을 확인해 주세요.", "addressSource");
            }
            String areaCode = text(body, "areaCode", 32, true, "INVALID_AREA");
            if (!areaCode.matches("[A-Z0-9_]+")) {
                throw new InvalidStore("INVALID_AREA", "제주 읍·면·동을 선택해 주세요.", "areaCode");
            }
            String industryCode = text(body, "industryCode", 32, true, "INVALID_INDUSTRY");
            if (!INDUSTRIES.contains(industryCode)) {
                throw new InvalidStore("INVALID_INDUSTRY", "등록할 수 있는 업종을 선택해 주세요.", "industryCode");
            }
            boolean other = industryCode.equals("OTHER");
            String customIndustryName = text(body, "customIndustryName", 100, other, "INVALID_INDUSTRY");
            if (!other && customIndustryName != null) {
                throw new InvalidStore("INVALID_INDUSTRY", "기타 업종을 선택할 때만 업종명을 입력해 주세요.", "customIndustryName");
            }
            return new StoreInput(name, address, addressDetail, addressSource, areaCode, industryCode, customIndustryName);
        }

        private static String text(JsonNode body, String field, int max, boolean required, String code) {
            var value = body.get(field);
            if (value == null && !required) {
                return null;
            }
            if (value != null && value.isString()) {
                String text = value.stringValue();
                if (!text.isBlank() && text.indexOf(0) < 0 && text.codePointCount(0, text.length()) <= max) {
                    return text;
                }
            }
            throw new InvalidStore(code, "입력값과 글자 수를 확인해 주세요.", field);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record StoreResponse(UUID id, String name, String address, String addressDetail, String addressSource,
                         String areaCode, String areaName, String industryCode, String customIndustryName,
                         OffsetDateTime createdAt, long menuCount) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ApiError(String code, String message, String field) {}

    private static final class InvalidStore extends RuntimeException {
        private final ApiError error;

        InvalidStore(String code, String message, String field) {
            this.error = new ApiError(code, message, field);
        }
    }
}
