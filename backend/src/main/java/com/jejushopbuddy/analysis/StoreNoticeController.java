package com.jejushopbuddy.analysis;

import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
class StoreNoticeController {
    private final ExecutionPlanReader plans;
    private final StrategyAgentClient agent;

    StoreNoticeController(ExecutionPlanReader plans, StrategyAgentClient agent) {
        this.plans = plans;
        this.agent = agent;
    }

    @PostMapping("/api/plans/{id}/store-notice")
    Draft generate(@PathVariable UUID id, @RequestBody Input input, Principal owner) {
        var plan = plans.find(id, owner.getName())
                .filter(item -> item.strategy().code().equals("OUTREACH"))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (input.template() == null || input.template().isBlank() || input.template().length() > 500
                || input.values() == null || input.values().size() > 12
                || input.values().entrySet().stream().anyMatch(entry -> entry.getKey().isBlank()
                        || entry.getKey().length() > 100 || entry.getValue() == null
                        || entry.getValue().isBlank() || entry.getValue().length() > 120)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        var notice = plan.strategy().customerNotice();
        return agent.storeNotice(new AgentInput(input.template(), input.values(),
                notice == null ? "" : notice.concern(), notice == null ? "" : notice.placement()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE));
    }

    record Input(String template, Map<String, String> values) {}

    record AgentInput(String template, Map<String, String> values, String concern, String placement) {}

    record Draft(String title, String message) {}
}
