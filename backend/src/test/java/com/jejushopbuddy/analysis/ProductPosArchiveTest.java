package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import tools.jackson.databind.json.JsonMapper;

class ProductPosArchiveTest {
    private static final String HEADER = "주문기준일자,결제상태,상품명,수량,실판매금액(원)";
    private static final String PRODUCT = "고기국수";
    private static final LocalDate FIRST = LocalDate.of(2021, 6, 25);
    private static final LocalDate LAST = FIRST.plusDays(2);
    private static final PromotionImpactController.Period PERIOD = new PromotionImpactController.Period(FIRST, LAST);

    @Test
    void usesTheNewestOverlappingFileAndCountsDeclaredDaysWithoutOrders() {
        var older = csv(HEADER + "\n2021-06-25,완료,고기국수,9,90000\n2021-06-26,완료,고기국수,2,17000", null, null);
        var newest = csv("\uFEFF" + HEADER + "\n2021-06-25,결제완료,고기국수,1,\"8,500\"\n2021-06-25,취소,고기국수,1,8500",
                FIRST, LAST);
        assertThat(ProductPosArchive.summarize(List.of(newest, older), PRODUCT, PERIOD).totals())
                .isEqualTo(new PromotionImpactController.Totals(1, 8500, 1));
        assertThat(ProductPosArchive.summarize(List.of(older), PRODUCT, PERIOD).gap())
                .isEqualTo(new PromotionImpactController.Period(LAST, LAST));
    }

    @Test
    void rejectsMissingAmountsAndCoverageThatDoesNotMatchTheOrders() {
        var badAmount = csv(HEADER + "\n2021-06-25,완료,고기국수,1,", FIRST, LAST);
        assertThat(ProductPosArchive.summarize(List.of(badAmount), PRODUCT, PERIOD).gap())
                .isEqualTo(new PromotionImpactController.Period(FIRST, FIRST));
        assertThat(ProductPosArchive.soldOn(List.of(badAmount), PRODUCT, FIRST)).isEqualTo(1L);
        var badCoverage = csv(HEADER + "\n2021-06-30,완료,고기국수,1,8500", FIRST, LAST);
        assertThat(ProductPosArchive.summarize(List.of(badCoverage), PRODUCT, PERIOD).gap()).isEqualTo(PERIOD);
    }

    @Test
    void readsExcelDatesAndKoreanCsv() throws Exception {
        byte[] workbook;
        try (var excel = new XSSFWorkbook(); var bytes = new ByteArrayOutputStream()) {
            var sheet = excel.createSheet("상품 주문");
            var header = sheet.createRow(0);
            var titles = HEADER.split(",");
            for (int i = 0; i < titles.length; i++) header.createCell(i).setCellValue(titles[i]);
            var order = sheet.createRow(1);
            var date = order.createCell(0);
            date.setCellValue(FIRST);
            var style = excel.createCellStyle();
            style.setDataFormat(excel.createDataFormat().getFormat("yyyy-mm-dd"));
            date.setCellStyle(style);
            order.createCell(1).setCellValue("완료");
            order.createCell(2).setCellValue(PRODUCT);
            order.createCell(3).setCellValue(2);
            order.createCell(4).setCellValue(17000);
            excel.write(bytes);
            workbook = bytes.toByteArray();
        }
        var excel = ProductPosArchive.parse(workbook, true, null, null);
        var korean = ProductPosArchive.parse((HEADER + "\n2021/6/26,완료,고기국수,3,25500")
                .getBytes(Charset.forName("MS949")), false, FIRST.plusDays(1), LAST);
        assertThat(ProductPosArchive.summarize(List.of(excel, korean), PRODUCT, PERIOD).totals())
                .isEqualTo(new PromotionImpactController.Totals(5, 42500, 2));
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "SHOP_BUDDY_TEST_WEEKLY_POS_DB", matches = "true")
    void savesBothPeriodsFromArchiveWithoutAnOpenBrowser() {
        var env = System.getenv();
        var source = new DriverManagerDataSource(
                env.getOrDefault("SHOP_BUDDY_DB_URL", "jdbc:postgresql://127.0.0.1:5432/jeju_shop_buddy_dev"),
                env.getOrDefault("SHOP_BUDDY_DB_USER", "jeju_shop_buddy"), env.getOrDefault("SHOP_BUDDY_DB_PASSWORD", ""));
        String schema = "pos_archive_test_" + UUID.randomUUID().toString().replace("-", "");
        JdbcClient jdbc = JdbcClient.create(source);
        jdbc.sql("CREATE SCHEMA " + schema).update();
        try {
            source.setSchema(schema);
            new ResourceDatabasePopulator(new FileSystemResource("../schema.sql"), new FileSystemResource("../seed-jeju-areas.sql"),
                    new FileSystemResource("../seed-aewol-demo.sql")).execute(source);
            var plan = UUID.randomUUID();
            var store = jdbc.sql("SELECT id FROM stores LIMIT 1").query(UUID.class).single();
            String email = jdbc.sql("SELECT email FROM owners LIMIT 1").query(String.class).single();
            jdbc.sql("""
                    INSERT INTO execution_plans (id, analysis_id, strategy_code, strategy_snapshot, promotion_draft,
                        manual_promotion_publication, duration_weeks, start_date, end_date)
                    SELECT :id, a.id, 'CUSTOM', '{"marketing":true}', '{"headline":"고기국수"}',
                        '{"NAVER":{"channel":"NAVER","publishedDate":"2021-07-01","productName":"고기국수"}}',
                        1, DATE '2021-07-01', DATE '2021-07-07' FROM sales_analyses a LIMIT 1
                    """).param("id", plan).update();
            var json = JsonMapper.builder().build();
            var checker = new PromotionArchivePush(new PromotionImpactController(jdbc, json, null, null, null),
                    new ProductPosArchive(jdbc), json);
            LocalDate today = LocalDate.parse("2021-07-08");
            var pending = checker.reconcile(plan, store, email, today);
            assertThat(pending.gapStart()).isEqualTo("2021-06-25");
            assertThat(pending.gapEnd()).isEqualTo("2021-06-30");
            var csv = new StringBuilder(HEADER).append('\n');
            for (int i = 0; i < 6; i++) {
                csv.append(FIRST.plusDays(i)).append(",완료,고기국수,2,17000\n");
                csv.append(FIRST.plusDays(7 + i)).append(",완료,고기국수,3,22500\n");
            }
            jdbc.sql("""
                    INSERT INTO store_pos_files (id, store_id, kind, filename, content)
                    VALUES (:id, :store, 'PRODUCT', 'sample.csv', :content)
                    """).param("id", UUID.randomUUID()).param("store", store)
                    .param("content", csv.toString().getBytes(StandardCharsets.UTF_8)).update();
            assertThat(checker.reconcile(plan, store, email, today).gapStart()).isNull();
            var totals = json.readTree(jdbc.sql("SELECT promotion_impact FROM execution_plans WHERE id = :id")
                    .param("id", plan).query(String.class).single());
            assertThat(totals.path("before").path("quantity").asLong()).isEqualTo(12);
            assertThat(totals.path("before").path("amount").asLong()).isEqualTo(102000);
            assertThat(totals.path("after").path("quantity").asLong()).isEqualTo(18);
            assertThat(totals.path("after").path("amount").asLong()).isEqualTo(135000);
        } finally {
            source.setSchema(null);
            jdbc.sql("DROP SCHEMA " + schema + " CASCADE").update();
        }
    }

    private static ProductPosArchive.Days csv(String rows, LocalDate start, LocalDate end) {
        return ProductPosArchive.parse(rows.getBytes(StandardCharsets.UTF_8), false, start, end);
    }
}
