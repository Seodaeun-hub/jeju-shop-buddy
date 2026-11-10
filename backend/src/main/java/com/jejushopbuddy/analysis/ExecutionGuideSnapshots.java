package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.StrategyAgentClient.GuideResponse;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
class ExecutionGuideSnapshots {
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;

    ExecutionGuideSnapshots(JdbcClient jdbc, ObjectMapper json, StrategyAgentClient agent) {
        this.jdbc = jdbc;
        this.json = json;
        this.agent = agent;
    }

    GuideResponse save(AnalysisResponse analysis, UUID recommendationId, String strategyCode,
                       String channel, GuideResponse guide) {
        var snapshot = guide.withSnapshot(UUID.randomUUID(), channel);
        jdbc.sql("""
                INSERT INTO execution_guide_snapshots (id, analysis_id, recommendation_id, strategy_code, input_fingerprint, snapshot)
                VALUES (:id, :analysisId, :recommendationId, :strategyCode, :fingerprint, CAST(:snapshot AS jsonb))
                """)
                .param("id", snapshot.guideId())
                .param("analysisId", analysis.id())
                .param("recommendationId", recommendationId)
                .param("strategyCode", strategyCode)
                .param("fingerprint", agent.fingerprintFor(analysis))
                .param("snapshot", json.writeValueAsString(snapshot))
                .update();
        return snapshot;
    }

    GuideResponse select(AnalysisResponse analysis, UUID recommendationId, String strategyCode, UUID guideId) {
        return jdbc.sql("""
                SELECT snapshot FROM execution_guide_snapshots
                WHERE id = :id AND analysis_id = :analysisId AND strategy_code = :strategyCode
                    AND recommendation_id IS NOT DISTINCT FROM CAST(:recommendationId AS uuid)
                    AND input_fingerprint = :fingerprint
                """)
                .param("id", guideId)
                .param("analysisId", analysis.id())
                .param("recommendationId", recommendationId)
                .param("strategyCode", strategyCode)
                .param("fingerprint", agent.fingerprintFor(analysis))
                .query((rs, row) -> json.readValue(rs.getString("snapshot"), GuideResponse.class))
                .optional().orElseThrow(Unavailable::new);
    }

    static final class Unavailable extends RuntimeException {}
}
