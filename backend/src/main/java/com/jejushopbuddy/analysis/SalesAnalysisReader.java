package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesAnalysisController.MonthlySale;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSeries;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSlot;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
class SalesAnalysisReader {
    private final JdbcClient jdbc;

    SalesAnalysisReader(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Optional<AnalysisResponse> find(UUID id, String ownerEmail) {
        var analysis = jdbc.sql("""
                SELECT a.store_id, a.concern, a.before_month, a.after_month, a.created_at
                FROM sales_analyses a
                JOIN stores s ON s.id = a.store_id
                JOIN owners o ON o.id = s.owner_id
                WHERE a.id = :id AND o.email = :ownerEmail
                """)
                .param("id", id)
                .param("ownerEmail", ownerEmail)
                .query((rs, row) -> new SavedAnalysis(rs.getObject("store_id", UUID.class),
                        rs.getString("concern"), month(rs, "before_month"), month(rs, "after_month"),
                        rs.getObject("created_at", OffsetDateTime.class)))
                .optional();
        if (analysis.isEmpty()) {
            return Optional.empty();
        }

        var monthly = jdbc.sql("""
                SELECT sales_month, amount FROM analysis_monthly_sales
                WHERE analysis_id = :id ORDER BY sales_month
                """)
                .param("id", id)
                .query((rs, row) -> new MonthlySale(month(rs, "sales_month"), rs.getLong("amount")))
                .list();
        var saved = analysis.get();
        return Optional.of(new AnalysisResponse(id, saved.storeId(), saved.concern(), saved.beforeMonth(),
                saved.afterMonth(), monthly, findTimeSeries(id).orElse(null), saved.createdAt()));
    }

    private Optional<TimeSeries> findTimeSeries(UUID id) {
        var metric = jdbc.sql("SELECT metric FROM analysis_time_series WHERE analysis_id = :id")
                .param("id", id).query(String.class).optional();
        return metric.map(unit -> new TimeSeries(unit, jdbc.sql("""
                SELECT label, before_value, after_value FROM analysis_time_series_rows
                WHERE analysis_id = :id ORDER BY sort_order
                """)
                .param("id", id)
                .query((rs, row) -> new TimeSlot(rs.getString("label"), rs.getLong("before_value"),
                        rs.getLong("after_value")))
                .list()));
    }

    private static String month(ResultSet rs, String column) throws SQLException {
        return YearMonth.from(rs.getObject(column, LocalDate.class)).toString();
    }

    private record SavedAnalysis(UUID storeId, String concern, String beforeMonth, String afterMonth,
                                 OffsetDateTime createdAt) {}
}
