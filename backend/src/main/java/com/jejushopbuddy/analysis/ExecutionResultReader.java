package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.ExecutionResultWriter.Comparison;
import com.jejushopbuddy.analysis.ExecutionResultWriter.Period;
import com.jejushopbuddy.analysis.ExecutionResultWriter.Result;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
class ExecutionResultReader {
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    ExecutionResultReader(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    Optional<LatestResult> findLatest(UUID planId, String ownerEmail) {
        return jdbc.sql("""
                SELECT r.id, r.scope, r.before_start, r.before_end, r.before_days, r.before_amount,
                       r.before_count, r.after_start, r.after_end, r.after_days, r.after_amount,
                       r.after_count, r.comparison, r.created_at
                FROM execution_plans p
                JOIN sales_analyses a ON a.id = p.analysis_id
                JOIN stores s ON s.id = a.store_id
                JOIN owners o ON o.id = s.owner_id
                LEFT JOIN LATERAL (
                    SELECT * FROM execution_results
                    WHERE plan_id = p.id ORDER BY registration_no DESC LIMIT 1
                ) r ON TRUE
                WHERE p.id = :planId AND o.email = :ownerEmail
                """)
                .param("planId", planId)
                .param("ownerEmail", ownerEmail)
                .query((rs, row) -> {
                    UUID id = rs.getObject("id", UUID.class);
                    if (id == null) {
                        return new LatestResult(null);
                    }
                    return new LatestResult(new Result(id, planId, rs.getString("scope"),
                            period(rs, "before"), period(rs, "after"),
                            json.readValue(rs.getString("comparison"), Comparison.class),
                            rs.getObject("created_at", OffsetDateTime.class)));
                })
                .optional();
    }

    private static Period period(ResultSet rs, String prefix) throws SQLException {
        return new Period(rs.getObject(prefix + "_start", LocalDate.class),
                rs.getObject(prefix + "_end", LocalDate.class), rs.getInt(prefix + "_days"),
                rs.getObject(prefix + "_amount", Long.class), rs.getObject(prefix + "_count", Long.class));
    }

    record LatestResult(Result result) {}
}
