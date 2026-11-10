package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisInput;
import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSeries;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class SalesAnalysisWriter {
    private final JdbcClient jdbc;
    private final SalesAnalysisReader reader;

    SalesAnalysisWriter(JdbcClient jdbc, SalesAnalysisReader reader) {
        this.jdbc = jdbc;
        this.reader = reader;
    }

    @Transactional
    public Optional<OffsetDateTime> save(UUID id, UUID storeId, String ownerEmail, AnalysisInput input) {
        var createdAt = jdbc.sql("""
                INSERT INTO sales_analyses (id, store_id, name, concern, before_month, after_month, hourly_sales)
                SELECT :id, s.id, :name, :concern, :beforeMonth, :afterMonth, CAST(:hourlySales AS jsonb)
                FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE s.id = :storeId AND o.email = :ownerEmail
                FOR SHARE OF s, o
                RETURNING created_at
                """)
                .param("id", id)
                .param("storeId", storeId)
                .param("ownerEmail", ownerEmail)
                .param("name", input.name())
                .param("concern", input.concern())
                .param("hourlySales", input.hourlySales() == null ? null : input.hourlySales().toString())
                .param("beforeMonth", YearMonth.parse(input.beforeMonth()).atDay(1))
                .param("afterMonth", YearMonth.parse(input.afterMonth()).atDay(1))
                .query((rs, row) -> rs.getObject("created_at", OffsetDateTime.class))
                .optional();
        if (createdAt.isEmpty()) {
            return createdAt;
        }

        for (var month : input.monthlySales()) {
            jdbc.sql("""
                    INSERT INTO analysis_monthly_sales (analysis_id, sales_month, amount)
                    VALUES (:id, :month, :amount)
                    """)
                    .param("id", id)
                    .param("month", YearMonth.parse(month.month()).atDay(1))
                    .param("amount", month.amount())
                    .update();
        }
        if (input.timeSeries() != null) {
            insertTimeSeries(id, input.timeSeries());
        }
        for (var product : input.productSales()) {
            jdbc.sql("""
                    INSERT INTO analysis_product_sales (analysis_id, product_name, before_quantity, after_quantity, price_won)
                    VALUES (:id, :name, :before, :after, :price)
                    """)
                    .param("id", id)
                    .param("name", product.productName())
                    .param("before", product.before())
                    .param("after", product.after())
                    .param("price", product.priceWon(), java.sql.Types.BIGINT)
                    .update();
        }
        return createdAt;
    }

    public boolean attachHourlySales(UUID id, String ownerEmail, String hourlySales) {
        return jdbc.sql("""
                UPDATE sales_analyses a
                SET hourly_sales = COALESCE(a.hourly_sales, '{}'::jsonb) || CAST(:hourlySales AS jsonb)
                FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE a.id = :id AND a.store_id = s.id AND o.email = :email
                """).param("id", id).param("email", ownerEmail).param("hourlySales", hourlySales).update() == 1;
    }

    @Transactional
    public Optional<TimeSeriesUpdate> replaceTimeSeries(UUID id, String ownerEmail, TimeSeries series) {
        // Serialize updates for this analysis, including requests that arrive before it has any time series.
        var owned = jdbc.sql("""
                SELECT a.id FROM sales_analyses a
                JOIN stores s ON s.id = a.store_id
                JOIN owners o ON o.id = s.owner_id
                WHERE a.id = :id AND o.email = :ownerEmail
                FOR UPDATE OF a FOR SHARE OF s, o
                """)
                .param("id", id).param("ownerEmail", ownerEmail).query(UUID.class).optional();
        if (owned.isEmpty()) {
            return Optional.empty();
        }

        // The schema cascades deletion of the old time slots, so omitted slots disappear on replacement.
        boolean created = jdbc.sql("DELETE FROM analysis_time_series WHERE analysis_id = :id")
                .param("id", id).update() == 0;
        insertTimeSeries(id, series);
        return Optional.of(new TimeSeriesUpdate(created, reader.find(id, ownerEmail).orElseThrow()));
    }

    private void insertTimeSeries(UUID id, TimeSeries series) {
        jdbc.sql("INSERT INTO analysis_time_series (analysis_id, metric) VALUES (:id, :metric)")
                .param("id", id)
                .param("metric", series.metric())
                .update();
        int order = 1;
        for (var slot : series.rows()) {
            jdbc.sql("""
                    INSERT INTO analysis_time_series_rows
                        (analysis_id, label, sort_order, before_value, after_value)
                    VALUES (:id, :label, :sortOrder, :before, :after)
                    """)
                    .param("id", id)
                    .param("label", slot.label())
                    .param("sortOrder", order++)
                    .param("before", slot.before())
                    .param("after", slot.after())
                    .update();
        }
    }

    record TimeSeriesUpdate(boolean created, AnalysisResponse analysis) {}
}
