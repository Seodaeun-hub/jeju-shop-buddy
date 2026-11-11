package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesStrategies.RecommendationContext;
import com.jejushopbuddy.analysis.SalesStrategies.Response;
import com.jejushopbuddy.analysis.SalesStrategies.Suggestion;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
class StrategyRecommendations {
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;

    StrategyRecommendations(JdbcClient jdbc, ObjectMapper json, StrategyAgentClient agent) {
        this.jdbc = jdbc;
        this.json = json;
        this.agent = agent;
    }

    Response save(StrategyAgentClient.Generated generated) {
        var response = generated.response().withId(UUID.randomUUID());
        jdbc.sql("""
                INSERT INTO strategy_recommendations (id, analysis_id, input_fingerprint, snapshot)
                VALUES (:id, :analysisId, :fingerprint, CAST(:snapshot AS jsonb))
                """)
                .param("id", response.recommendationId())
                .param("analysisId", response.analysisId())
                .param("fingerprint", generated.inputFingerprint())
                .param("snapshot", json.writeValueAsString(response))
                .update();
        return response;
    }

    Suggestion select(AnalysisResponse analysis, UUID id, String code) {
        return select(analysis, id, code, null);
    }

    Suggestion select(AnalysisResponse analysis, UUID id, String code, Integer optionIndex) {
        var saved = jdbc.sql("""
                SELECT input_fingerprint, snapshot FROM strategy_recommendations
                WHERE id = :id AND analysis_id = :analysisId
                """)
                .param("id", id)
                .param("analysisId", analysis.id())
                .query((rs, row) -> new Saved(rs.getString("input_fingerprint"),
                        json.readValue(rs.getString("snapshot"), Response.class)))
                .optional().orElseThrow(Unavailable::new);
        if (!saved.fingerprint().equals(agent.fingerprintFor(analysis))) throw new Unavailable();

        var response = saved.response();
        var context = new RecommendationContext(id, response.beforeMonth(), response.afterMonth(), response.contextEvidence());
        if (optionIndex != null) {
            if (optionIndex < 0 || optionIndex >= response.strategies().size()) throw new Unavailable();
            var option = response.strategies().get(optionIndex);
            if (!option.code().equals(code)) throw new Unavailable();
            return option.withRecommendation(context);
        }
        return response.strategies().stream()
                .filter(candidate -> candidate.code().equals(code))
                .findFirst().orElseThrow(Unavailable::new)
                .withRecommendation(context);
    }

    private record Saved(String fingerprint, Response response) {}

    static final class Unavailable extends RuntimeException {}
}
