package com.jejushopbuddy.store;

import java.io.IOException;
import java.io.StringWriter;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.DefaultUriBuilderFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
class TossPlacePosClient {
    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final String ROOT = "https://open-api.tossplace.com/api-public/openapi/v1/merchants/";
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");
    private static final long MAX_TOTAL = 9_007_199_254_740_991L;
    private static final int MAX_PAGES = 300;

    private final ObjectMapper json;
    private final RestClient client;
    private final boolean configured;

    @Autowired
    TossPlacePosClient(ObjectMapper json, @Value("${SHOP_BUDDY_TOSS_MERCHANT_ID:}") String merchantId,
                       @Value("${SHOP_BUDDY_TOSS_ACCESS_KEY:}") String key,
                       @Value("${SHOP_BUDDY_TOSS_ACCESS_SECRET:}") String secret) {
        this(json, http(), merchantId, key, secret);
    }

    TossPlacePosClient(ObjectMapper json, RestClient.Builder http, String merchantId, String key, String secret) {
        this.json = json;
        configured = merchantId.matches("[0-9]{1,19}") && !key.isBlank() && !secret.isBlank();
        var uris = new DefaultUriBuilderFactory(ROOT + (configured ? merchantId : "0"));
        uris.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.TEMPLATE_AND_VALUES);
        client = http.uriBuilderFactory(uris).defaultHeader("x-access-key", key.strip())
                .defaultHeader("x-secret-key", secret.strip()).build();
    }

    private static RestClient.Builder http() {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(4)).followRedirects(HttpClient.Redirect.NEVER).build());
        factory.setReadTimeout(Duration.ofSeconds(8));
        return RestClient.builder().requestFactory(factory);
    }

    boolean configured() {
        return configured;
    }

    Snapshot fetch(YearMonth month, Instant now) {
        var orders = new LinkedHashMap<String, JsonNode>();
        Set<String> cursors = new HashSet<>();
        String cursor = null;
        String from = month.atDay(1).atStartOfDay(SEOUL).toInstant().minusSeconds(1).toString();
        Instant deadline = Instant.now().plusSeconds(55);
        do {
            checkDeadline(deadline);
            String pageCursor = cursor;
            var page = success(client.get().uri(builder -> {
                builder.path("/order/orders/by-cursor").queryParam("from", "{from}").queryParam("to", "{to}");
                Map<String, String> values = new LinkedHashMap<>(Map.of("from", from, "to", now.toString()));
                if (pageCursor != null) {
                    builder.queryParam("cursor", "{cursor}");
                    values.put("cursor", pageCursor);
                }
                return builder.build(values);
            }));
            for (var order : array(page.path("items"))) {
                orders.putIfAbsent(requiredText(order.path("id")), order);
            }
            var next = page.path("cursor");
            cursor = next.isMissingNode() || next.isNull() ? null : requiredText(next);
            if (cursor != null && (!cursors.add(cursor) || cursors.size() >= MAX_PAGES)) {
                throw new ImportFailure("조회할 주문이 너무 많거나 토스포스의 다음 페이지를 확인할 수 없어요.");
            }
        } while (cursor != null);

        var paymentsText = new StringWriter();
        var productsText = new StringWriter();
        try (var payments = new CSVPrinter(paymentsText, CSVFormat.DEFAULT);
             var products = new CSVPrinter(productsText, CSVFormat.DEFAULT)) {
            payments.printRecord("결제기준일자", "결제시각", "결제건수", "결제금액", "결제상태");
            products.printRecord("주문기준일자", "결제상태", "상품명", "수량", "상품가격", "실판매금액");
            int orderCount = 0;
            int paymentCount = 0;
            int incompleteProductRevenue = 0;
            long revenue = 0;
            for (var entry : orders.entrySet().stream().sorted(Map.Entry.comparingByKey()).toList()) {
                checkDeadline(deadline);
                var order = entry.getValue();
                String state = requiredText(order.path("orderState"));
                if ("CANCELLED".equals(state)) continue;
                if (!"COMPLETED".equals(state)) throw invalidResponse();
                // The order endpoint also returns Payment[]. Use the separate payment GET when the array is omitted.
                JsonNode records = order.path("payments");
                if (records.isMissingNode() || records.isNull() || emptyArray(records)) {
                    records = success(client.get().uri(builder -> builder.path("/payment/payments/by-order-id")
                            .queryParam("orderId", "{id}").build(entry.getKey())));
                }
                List<Payment> approved = new ArrayList<>();
                boolean hadCancellation = false;
                Set<String> paymentIds = new HashSet<>();
                for (var record : array(records)) {
                    String paymentState = requiredText(record.path("state"));
                    if ("CANCELLED".equals(paymentState)) {
                        hadCancellation = true;
                        continue;
                    }
                    if (!"APPROVED".equals(paymentState)) throw invalidResponse();
                    if (!entry.getKey().equals(requiredText(record.path("orderId")))) throw invalidResponse();
                    if (!paymentIds.add(requiredText(record.path("id")))) continue;
                    approved.add(new Payment(dateTime(requiredText(record.path("approvedAt"))),
                            number(record.path("amount"))));
                }
                approved.sort(Comparator.comparing(Payment::at).thenComparingLong(Payment::amount));
                var monthPayments = approved.stream().filter(payment -> YearMonth.from(payment.at()).equals(month)).toList();
                if (monthPayments.isEmpty()) continue;
                long orderRevenue = 0;
                for (var payment : monthPayments) {
                    payments.printRecord(payment.at().toLocalDate(), TIME.format(payment.at()), 1, payment.amount(), "완료");
                    paymentCount++;
                    revenue = add(revenue, payment.amount());
                    orderRevenue = add(orderRevenue, payment.amount());
                }
                orderCount++;
                LocalDate day = approved.getLast().at().toLocalDate();
                if (!YearMonth.from(day).equals(month)) continue;
                var lines = lines(order);
                // Item totals are only comparable to receipts when no options or discounts need allocating.
                boolean exact = !hadCancellation && !lines.isEmpty() && emptyArray(order.path("discounts"))
                        && approved.stream().allMatch(payment -> payment.at().toLocalDate().equals(day))
                        && lines.stream().allMatch(Line::plain);
                if (exact) {
                    long total = 0;
                    for (var line : lines) total = add(total, line.total());
                    exact = total == orderRevenue;
                }
                if (!exact && !lines.isEmpty()) incompleteProductRevenue++;
                for (var line : lines) {
                    products.printRecord(day, "완료", line.name(), line.quantity(), line.price(),
                            exact ? line.total() : null);
                }
            }
            return new Snapshot(bytes(paymentsText), bytes(productsText), orderCount, paymentCount, revenue,
                    incompleteProductRevenue);
        } catch (IOException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private JsonNode success(RestClient.RequestHeadersSpec<?> request) {
        try {
            byte[] bytes = request.retrieve().body(byte[].class);
            if (bytes == null) throw invalidResponse();
            JsonNode response = json.readTree(bytes);
            if (response == null || !"SUCCESS".equals(response.path("resultType").asText())
                    || response.path("success").isNull() || response.path("success").isMissingNode()) {
                throw invalidResponse();
            }
            return response.path("success");
        } catch (RestClientException | JacksonException failure) {
            throw new ImportFailure("토스포스에서 주문과 결제를 조회하지 못했어요. 연결 상태와 조회 권한을 확인해 주세요.");
        }
    }

    private static List<Line> lines(JsonNode order) {
        List<Line> lines = new ArrayList<>();
        for (var line : array(order.path("lineItems"))) {
            String name = requiredText(line.path("item").path("title")).strip();
            if (name.isBlank() || name.length() > 255 || name.indexOf(0) >= 0) throw invalidResponse();
            long quantity = number(line.path("quantity"));
            var price = line.path("itemPrice");
            boolean fixed = "FIXED".equals(price.path("priceType").asText());
            Long unitPrice = fixed ? number(price.path("priceValue")) : null;
            boolean plain = fixed && quantity > 0 && price.path("priceUnit").asLong(-1) == 1
                    && emptyArray(line.path("optionChoices")) && emptyArray(line.path("appliedDiscounts"));
            if (plain && unitPrice > MAX_TOTAL / quantity) throw invalidResponse();
            lines.add(new Line(name, quantity, unitPrice, plain ? unitPrice * quantity : 0, plain));
        }
        return lines;
    }

    private static JsonNode array(JsonNode value) {
        if (!value.isArray()) throw invalidResponse();
        return value;
    }

    private static boolean emptyArray(JsonNode value) {
        return value.isArray() && value.isEmpty();
    }

    private static String requiredText(JsonNode value) {
        if (!value.isString() || value.asText().isBlank()) throw invalidResponse();
        return value.asText();
    }

    private static long number(JsonNode value) {
        if (!value.isIntegralNumber() || !value.canConvertToLong()
                || value.longValue() < 0 || value.longValue() > MAX_TOTAL) throw invalidResponse();
        return value.longValue();
    }

    private static long add(long first, long second) {
        if (first > MAX_TOTAL - second) throw invalidResponse();
        return first + second;
    }

    private static LocalDateTime dateTime(String value) {
        try {
            return OffsetDateTime.parse(value).atZoneSameInstant(SEOUL).toLocalDateTime();
        } catch (DateTimeParseException noOffset) {
            try {
                return LocalDateTime.parse(value);
            } catch (DateTimeParseException invalid) {
                throw invalidResponse();
            }
        }
    }

    private static byte[] bytes(StringWriter csv) {
        byte[] bytes = ("\uFEFF" + csv).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 10 * 1024 * 1024) {
            throw new ImportFailure("토스포스에서 가져온 자료가 파일당 10MB를 넘어요.");
        }
        return bytes;
    }

    private static void checkDeadline(Instant deadline) {
        if (Instant.now().isAfter(deadline)) throw new ImportFailure("토스포스 자료를 불러오는 데 시간이 오래 걸려요. 다시 시도해 주세요.");
    }

    private static ImportFailure invalidResponse() {
        return new ImportFailure("토스포스 응답에서 주문·결제 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

    record Snapshot(byte[] payments, byte[] products, int orderCount, int paymentCount, long revenue,
                    int incompleteProductRevenue) {}
    private record Payment(LocalDateTime at, long amount) {}
    private record Line(String name, long quantity, Long price, long total, boolean plain) {}

    static class ImportFailure extends RuntimeException {
        ImportFailure(String message) { super(message); }
    }
}
