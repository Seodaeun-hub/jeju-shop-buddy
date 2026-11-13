package com.jejushopbuddy.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.startsWith;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.queryParam;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.YearMonth;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

class TossPosImportTest {
    private static final String ROOT = "https://open-api.tossplace.com/api-public/openapi/v1/merchants/747507";
    private static final String ORDER_URL = ROOT + "/order/orders/by-cursor";
    private static final YearMonth MONTH = YearMonth.of(2026, 11);
    private static final Instant NOW = Instant.parse("2026-11-13T09:00:00Z");
    private static final String ORDER = """
            {"id":"order-1","orderState":"COMPLETED","discounts":[],"lineItems":[
                {"item":{"title":"만두"},"quantity":1,
                 "itemPrice":{"priceType":"FIXED","priceUnit":1,"priceValue":6000},"optionChoices":[],"appliedDiscounts":[]},
                {"item":{"title":"고기국수"},"quantity":2,
                 "itemPrice":{"priceType":"FIXED","priceUnit":1,"priceValue":8500},"optionChoices":[],"appliedDiscounts":[]}
            ]}
            """;
    private static final String PAYMENT = """
            {"id":"payment-1","orderId":"order-1","state":"APPROVED","approvedAt":"2026-11-13T05:34:00Z",
             "amount":23000,"paymentMethod":"CASH"}
            """;

    @Test
    void readsUtf8FollowsCursorAndJoinsPaymentsWithoutDuplicates() {
        var http = RestClient.builder();
        var server = MockRestServiceServer.bindTo(http).build();
        var toss = new TossPlacePosClient(new JsonMapper(), http, "747507", "test-key", "test-secret");
        server.expect(requestTo(startsWith(ORDER_URL))).andExpect(method(HttpMethod.GET))
                .andExpect(header("x-access-key", "test-key")).andExpect(header("x-secret-key", "test-secret"))
                .andExpect(queryParam("from", "2026-10-31T14%3A59%3A59Z"))
                .andExpect(queryParam("to", "2026-11-13T09%3A00%3A00Z"))
                .andRespond(json("{\"items\":[" + ORDER + "],\"cursor\":\"next/+\"}"));
        server.expect(requestTo(startsWith(ORDER_URL))).andExpect(queryParam("cursor", "next%2F%2B"))
                .andRespond(json("{\"items\":[" + ORDER + ",{\"id\":\"voided\",\"orderState\":\"CANCELLED\"}]}"));
        server.expect(requestTo(startsWith(ROOT + "/payment/payments/by-order-id")))
                .andExpect(method(HttpMethod.GET)).andExpect(queryParam("orderId", "order-1"))
                .andRespond(json("[" + PAYMENT + "," + PAYMENT + "]"));

        var snapshot = toss.fetch(MONTH, NOW);
        assertThat(snapshot.orderCount()).isEqualTo(1);
        assertThat(snapshot.paymentCount()).isEqualTo(1);
        assertThat(snapshot.revenue()).isEqualTo(23000);
        assertThat(new String(snapshot.payments(), StandardCharsets.UTF_8)).contains("2026-11-13,14:34:00,1,23000,완료");
        assertThat(new String(snapshot.products(), StandardCharsets.UTF_8))
                .contains("2026-11-13,완료,만두,1,6000,6000", "2026-11-13,완료,고기국수,2,8500,17000");
        server.verify();
    }

    @Test
    void excludesCancelledPaymentAndKeepsQuantitiesWhenRevenueCannotBeAllocated() {
        var http = RestClient.builder();
        var server = MockRestServiceServer.bindTo(http).build();
        var toss = new TossPlacePosClient(new JsonMapper(), http, "747507", "test-key", "test-secret");
        String payments = PAYMENT.replace("23000", "15000") + "," + """
                {"id":"payment-2","orderId":"order-1","state":"CANCELLED","amount":8000}
                """;
        String order = ORDER.replace("\"lineItems\"", "\"payments\":[" + payments + "],\"lineItems\"");
        server.expect(requestTo(startsWith(ORDER_URL))).andRespond(json("{\"items\":[" + order + "]}"));
        var snapshot = toss.fetch(MONTH, NOW);
        assertThat(snapshot.revenue()).isEqualTo(15000);
        assertThat(snapshot.paymentCount()).isEqualTo(1);
        assertThat(snapshot.incompleteProductRevenue()).isEqualTo(1);
        assertThat(new String(snapshot.products(), StandardCharsets.UTF_8)).contains("고기국수,2,8500,\r\n");
        server.verify();
    }

    @Test
    void reportsProviderFailureWithoutLeakingResponse() {
        var http = RestClient.builder();
        var server = MockRestServiceServer.bindTo(http).build();
        var toss = new TossPlacePosClient(new JsonMapper(), http, "747507", "test-key", "test-secret");
        server.expect(requestTo(startsWith(ORDER_URL))).andRespond(withSuccess("""
                {"resultType":"FAIL","error":{"reason":"private diagnostic"}}
                """, MediaType.APPLICATION_JSON));
        assertThatThrownBy(() -> toss.fetch(MONTH, NOW)).isInstanceOf(TossPlacePosClient.ImportFailure.class)
                .hasMessageNotContaining("private diagnostic");
        server.verify();
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "SHOP_BUDDY_TEST_TOSS_POS_DB", matches = "true")
    void savesOnePairAndReplacesCancelledSalesWithoutTouchingManualFiles() {
        var env = System.getenv();
        var source = new DriverManagerDataSource(
                env.getOrDefault("SHOP_BUDDY_DB_URL", "jdbc:postgresql://127.0.0.1:5432/jeju_shop_buddy_dev"),
                env.getOrDefault("SHOP_BUDDY_DB_USER", "jeju_shop_buddy"), env.getOrDefault("SHOP_BUDDY_DB_PASSWORD", ""));
        String schema = "toss_pos_test_" + UUID.randomUUID().toString().replace("-", "");
        var jdbc = JdbcClient.create(source);
        jdbc.sql("CREATE SCHEMA " + schema).update();
        try {
            source.setSchema(schema);
            new ResourceDatabasePopulator(new FileSystemResource("../schema.sql"), new FileSystemResource("../seed-jeju-areas.sql"),
                    new FileSystemResource("../seed-aewol-demo.sql"), new FileSystemResource("../migration-toss-pos-import.sql"))
                    .execute(source);
            UUID store = jdbc.sql("SELECT id FROM stores").query(UUID.class).single();
            var manual = UUID.randomUUID();
            jdbc.sql("""
                    INSERT INTO store_pos_files (id, store_id, kind, filename, content)
                    VALUES (:id, :store, 'PAYMENT', 'manual.csv', :content)
                    """).param("id", manual).param("store", store).param("content", new byte[] {1}).update();

            var toss = mock(TossPlacePosClient.class);
            var first = new TossPlacePosClient.Snapshot(new byte[] {1}, new byte[] {2}, 1, 1, 23000, 0);
            var cancelled = new TossPlacePosClient.Snapshot(new byte[] {3}, new byte[] {4}, 0, 0, 0, 0);
            when(toss.configured()).thenReturn(true);
            when(toss.fetch(any(), any())).thenReturn(first, first).thenThrow(new TossPlacePosClient.ImportFailure("조회 실패"))
                    .thenReturn(cancelled);
            var controller = new TossPosImportController(jdbc, toss, store.toString());
            var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
            var input = new TossPosImportController.ImportRequest("2021-05");
            assertThat(controller.config(store, () -> "other@example.test").getStatusCode().value()).isEqualTo(404);
            assertThat(tx.execute(status -> controller.importMonth(store, input, () -> "aewol-demo@example.test")).getBody())
                    .isEqualTo(new TossPosImportController.ImportResult(true, 1, 1, 23000, 0));
            var original = jdbc.sql("SELECT id FROM store_pos_files ORDER BY kind, id").query(UUID.class).list();
            tx.execute(status -> controller.importMonth(store, input, () -> "aewol-demo@example.test"));
            assertThat(jdbc.sql("SELECT id FROM store_pos_files ORDER BY kind, id").query(UUID.class).list()).isEqualTo(original);
            assertThatThrownBy(() -> tx.execute(status -> controller.importMonth(store, input, () -> "aewol-demo@example.test")))
                    .isInstanceOf(TossPlacePosClient.ImportFailure.class);
            assertThat(jdbc.sql("SELECT id FROM store_pos_files ORDER BY kind, id").query(UUID.class).list()).isEqualTo(original);
            assertThat(tx.execute(status -> controller.importMonth(store, input, () -> "aewol-demo@example.test")).getBody())
                    .isEqualTo(new TossPosImportController.ImportResult(true, 0, 0, 0, 0));
            assertThat(jdbc.sql("SELECT id FROM store_pos_files").query(UUID.class).list()).hasSize(3).contains(manual);
            assertThat(jdbc.sql("SELECT content FROM store_pos_files WHERE kind = 'PRODUCT'").query(byte[].class).single())
                    .containsExactly((byte) 4);
        } finally {
            source.setSchema(null);
            jdbc.sql("DROP SCHEMA " + schema + " CASCADE").update();
        }
    }

    private static org.springframework.test.web.client.ResponseCreator json(String payload) {
        return withSuccess(("{\"resultType\":\"SUCCESS\",\"success\":" + payload + "}").getBytes(StandardCharsets.UTF_8),
                MediaType.APPLICATION_JSON);
    }
}
