package com.jejushopbuddy.analysis;

import java.security.Principal;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
class ConcernCheckController {
    private final SalesAnalysisReader analyses;
    private final ObjectMapper json;
    private final StrategyAgentClient agent;

    ConcernCheckController(SalesAnalysisReader analyses, ObjectMapper json, StrategyAgentClient agent) {
        this.analyses = analyses;
        this.json = json;
        this.agent = agent;
    }

    @PostMapping("/api/analyses/{id}/concern-check")
    JsonNode check(@PathVariable UUID id, Principal owner) {
        var analysis = analyses.find(id, owner.getName())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        String concern = analysis.concern();
        if (concern == null || concern.isBlank() || concern.length() > 1000) {
            return json.createObjectNode().put("status", "CLARIFICATION_REQUIRED")
                    .put("detail", "확인할 고민을 1,000자 이내로 입력해 주세요.");
        }

        var hourlySales = analyses.findHourlySales(id, owner.getName())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        var payload = json.createObjectNode().put("concern", concern);
        payload.set("monthlySales", json.valueToTree(analysis.monthlySales()));
        payload.set("hourlySales", json.readTree(hourlySales));
        payload.set("productSales", json.valueToTree(analysis.productSales()));
        return agent.concernCheck(payload).orElseGet(() -> json.createObjectNode().put("status", "UNAVAILABLE")
                .put("detail", "AI가 고민을 확인할 수 없어요. 잠시 후 다시 시도해 주세요."));
    }
}
