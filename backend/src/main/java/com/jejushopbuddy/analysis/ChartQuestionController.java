package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesAnalysisController.ApiError;
import java.io.IOException;
import java.security.Principal;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/analyses/{analysisId}/questions")
class ChartQuestionController {
    private static final Set<String> CHARTS = Set.of("MONTHLY_SALES", "MARKET_CARD_SALES", "JEJU_BSI", "TIME_SERIES");
    private static final Set<String> VOICE_TYPES = Set.of("audio/mp4", "audio/webm", "audio/wav");
    private static final long MAX_VOICE_BYTES = 2 * 1024 * 1024;
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final SalesAnalysisReader analyses;
    private final ChartQuestionEvidence evidence;
    private final StrategyAgentClient agent;

    ChartQuestionController(JdbcClient jdbc, ObjectMapper json, SalesAnalysisReader analyses,
                            ChartQuestionEvidence evidence, StrategyAgentClient agent) {
        this.jdbc = jdbc;
        this.json = json;
        this.analyses = analyses;
        this.evidence = evidence;
        this.agent = agent;
    }

    @GetMapping
    ResponseEntity<History> history(@PathVariable UUID analysisId, Principal owner) {
        ownedAnalysis(analysisId, owner);
        UUID id = conversation(analysisId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new History(id, id == null ? List.of() : turns(id)));
    }

    @PostMapping
    @Transactional
    public ResponseEntity<Turn> ask(@PathVariable UUID analysisId, @RequestBody Question request, Principal owner) {
        var analysis = ownedAnalysis(analysisId, owner);
        String question = request.question() == null ? "" : request.question().strip();
        if (question.isEmpty() || question.indexOf(0) >= 0 || question.length() > 1000 || request.clientMessageId() == null
                || request.chart() == null || !CHARTS.contains(request.chart())) {
            throw new Failure(HttpStatus.BAD_REQUEST, "INVALID_QUESTION", "질문과 차트를 확인해 주세요.");
        }
        if (request.planId() != null && !ownsPlan(analysisId, request.planId())) throw notFound();

        // Serialize turns per analysis so concurrent submissions build on the latest committed context.
        jdbc.sql("SELECT id FROM sales_analyses WHERE id = :id FOR NO KEY UPDATE")
                .param("id", analysisId).query(UUID.class).optional().orElseThrow(ChartQuestionController::notFound);
        UUID conversation = conversation(analysisId);
        if (request.conversationId() != null && !request.conversationId().equals(conversation)) throw notFound();
        List<Turn> history = conversation == null ? List.of() : turns(conversation);
        for (var turn : history) {
            if (!request.clientMessageId().equals(turn.clientMessageId())) continue;
            if (turn.question().equals(question) && turn.chart().equals(request.chart())
                    && Objects.equals(turn.requestedPlanId(), request.planId())) return response(turn);
            throw new Failure(HttpStatus.CONFLICT, "QUESTION_ID_CONFLICT", "같은 요청 ID로 다른 질문을 보낼 수 없어요.");
        }

        var contextHistory = Boolean.TRUE.equals(request.startFromChart()) ? List.<Turn>of() : history;
        var planId = request.planId() != null ? request.planId() : rememberedPlan(analysisId, contextHistory);
        var context = json.createObjectNode().put("planId", planId == null ? null : planId.toString());
        context.set("comparisonPeriod", json.valueToTree(List.of(analysis.beforeMonth(), analysis.afterMonth())));
        var recent = contextHistory.subList(Math.max(0, contextHistory.size() - 5), contextHistory.size());
        context.set("recentQuestions", json.valueToTree(recent.stream().map(Turn::question).toList()));
        var focus = new LinkedHashSet<String>();
        for (var turn : recent.reversed()) {
            if ("CLARIFICATION_REQUIRED".equals(turn.answer().path("status").asString())) continue;
            for (var id : turn.answer().path("focusedEvidenceIds")) {
                focus.add(id.asString());
            }
        }
        var snapshot = evidence.forAnalysis(analysis, owner.getName(), planId, question, focus);
        focus.retainAll(snapshot.facts().keySet());
        context.set("focusedEvidenceIds", json.valueToTree(focus));
        var payload = json.createObjectNode().put("schemaVersion", "1.0").put("question", question).put("chart", request.chart());
        payload.set("context", context);
        payload.set("availableEvidence", json.valueToTree(snapshot.facts().values()));
        payload.set("allowedActions", json.valueToTree(snapshot.actions()));
        var answer = agent.chartQuestion(payload).orElseThrow(ChartQuestionController::unavailable);
        var verified = verify(answer, snapshot);

        if (conversation == null) {
            conversation = UUID.randomUUID();
            jdbc.sql("INSERT INTO chart_question_conversations (id, analysis_id) VALUES (:id, :analysis)")
                    .param("id", conversation).param("analysis", analysisId).update();
        }
        var turn = new Turn(conversation, UUID.randomUUID(), request.clientMessageId(), question, request.chart(), request.planId(), verified);
        jdbc.sql("""
                INSERT INTO chart_question_turns (id, conversation_id, client_message_id, question, chart, requested_plan_id, answer)
                VALUES (:id, :conversation, :client, :question, :chart, :plan, CAST(:answer AS jsonb))
                """).param("id", turn.turnId()).param("conversation", conversation).param("client", turn.clientMessageId())
                .param("question", question).param("chart", request.chart()).param("plan", request.planId())
                .param("answer", json.writeValueAsString(verified)).update();
        return response(turn);
    }

    @PostMapping(path = "/transcription", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<Transcript> transcribe(@PathVariable UUID analysisId, @RequestParam("audio") MultipartFile audio,
                                          Principal owner) {
        ownedAnalysis(analysisId, owner);
        var type = Objects.toString(audio.getContentType(), "").split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
        if (audio.isEmpty() || audio.getSize() > MAX_VOICE_BYTES || !VOICE_TYPES.contains(type)) {
            throw new Failure(HttpStatus.BAD_REQUEST, "INVALID_VOICE_INPUT", "짧은 질문을 다시 녹음해 주세요.");
        }
        try {
            var input = new VoiceInput(type, audio.getBytes());
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(agent.transcribeQuestion(input)
                    .orElseThrow(ChartQuestionController::transcriptionUnavailable));
        } catch (IOException error) {
            throw transcriptionUnavailable();
        }
    }

    private JsonNode verify(JsonNode answer, ChartQuestionEvidence.Snapshot snapshot) {
        if (!(answer instanceof tools.jackson.databind.node.ObjectNode result)
                || !answer.path("sections").isArray() || !answer.path("actions").isArray()
                || !answer.path("missingInputs").isArray()
                || !Set.of("ANSWERED", "PARTIAL", "MISSING_DATA", "CLARIFICATION_REQUIRED", "OUT_OF_SCOPE")
                    .contains(answer.path("status").asString(""))) throw unavailable();
        var cited = new LinkedHashSet<String>();
        for (var section : answer.path("sections")) {
            if (!section.path("text").isString() || !section.path("evidenceIds").isArray()) throw unavailable();
            for (var id : section.path("evidenceIds")) {
                if (!snapshot.facts().containsKey(id.asString())) throw unavailable();
                cited.add(id.asString());
            }
        }
        for (var action : answer.path("actions")) {
            var key = new ChartQuestionEvidence.Action(action.path("type").asString(), action.path("targetId").asString());
            if (!snapshot.actions().contains(key)) throw unavailable();
        }
        var plan = answer.path("planId");
        if (plan.isString() && !snapshot.actions().contains(
                new ChartQuestionEvidence.Action("SELECT_PLAN", plan.stringValue()))) throw unavailable();
        // Save the server's original facts so links and numbers are never supplied by the model.
        result.set("evidence", json.valueToTree(cited.stream().map(snapshot.facts()::get).toList()));
        result.set("focusedEvidenceIds", json.valueToTree(cited));
        return result;
    }

    private AnalysisResponse ownedAnalysis(UUID analysisId, Principal owner) {
        return analyses.find(analysisId, owner.getName()).orElseThrow(ChartQuestionController::notFound);
    }

    private UUID rememberedPlan(UUID analysisId, List<Turn> turns) {
        for (var turn : turns.reversed()) {
            var value = turn.answer().path("planId");
            if (!value.isString()) continue;
            UUID id = UUID.fromString(value.stringValue());
            if (ownsPlan(analysisId, id)) return id;
        }
        return null;
    }

    private boolean ownsPlan(UUID analysisId, UUID planId) {
        return jdbc.sql("SELECT id FROM execution_plans WHERE id = :id AND analysis_id = :analysis")
                .param("id", planId).param("analysis", analysisId).query(UUID.class).optional().isPresent();
    }

    private UUID conversation(UUID analysisId) {
        return jdbc.sql("SELECT id FROM chart_question_conversations WHERE analysis_id = :id")
                .param("id", analysisId).query(UUID.class).optional().orElse(null);
    }

    private List<Turn> turns(UUID conversation) {
        return jdbc.sql("""
                SELECT id, client_message_id, question, chart, requested_plan_id, answer
                FROM chart_question_turns WHERE conversation_id = :id ORDER BY sequence_no
                """).param("id", conversation).query((rs, row) -> new Turn(conversation, rs.getObject("id", UUID.class),
                rs.getObject("client_message_id", UUID.class), rs.getString("question"), rs.getString("chart"),
                rs.getObject("requested_plan_id", UUID.class), json.readTree(rs.getString("answer")))).list();
    }

    private static ResponseEntity<Turn> response(Turn turn) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(turn);
    }

    private static Failure notFound() {
        return new Failure(HttpStatus.NOT_FOUND, "QUESTION_CONTEXT_NOT_FOUND", "분석, 대화 또는 실행 계획을 찾을 수 없어요.");
    }

    private static Failure unavailable() {
        return new Failure(HttpStatus.SERVICE_UNAVAILABLE, "QA_UNAVAILABLE", "답변을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

    private static Failure transcriptionUnavailable() {
        return new Failure(HttpStatus.SERVICE_UNAVAILABLE, "TRANSCRIPTION_UNAVAILABLE",
                "음성을 글로 바꾸지 못했어요. 다시 녹음하거나 질문을 직접 입력해 주세요.");
    }

    @ExceptionHandler(Failure.class)
    ResponseEntity<ApiError> onFailure(Failure error) {
        return ResponseEntity.status(error.status).body(new ApiError(error.code, error.getMessage(), null));
    }

    private static final class Failure extends RuntimeException {
        private final HttpStatus status;
        private final String code;

        private Failure(HttpStatus status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    record Question(UUID clientMessageId, UUID conversationId, String question, String chart, UUID planId, Boolean startFromChart) {}
    record Turn(UUID conversationId, UUID turnId, UUID clientMessageId, String question, String chart, UUID requestedPlanId, JsonNode answer) {}
    record History(UUID conversationId, List<Turn> turns) {}
    record VoiceInput(String mediaType, byte[] audio) {}
    record Transcript(String text) {}
}
