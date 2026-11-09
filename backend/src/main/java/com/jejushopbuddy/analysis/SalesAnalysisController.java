package com.jejushopbuddy.analysis;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.security.Principal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
class SalesAnalysisController {
    private static final long MAX_VALUE = 9_007_199_254_740_991L;

    private final SalesAnalysisWriter writer;
    private final SalesAnalysisReader reader;
    private final SalesStrategies salesStrategies;
    private final StoreReviewService reviews;
    private final ExecutionPlanWriter planWriter;
    private final ExecutionPlanReader planReader;
    private final ExecutionResultWriter resultWriter;
    private final ExecutionResultReader resultReader;

    SalesAnalysisController(SalesAnalysisWriter writer, SalesAnalysisReader reader,
                            ExecutionPlanWriter planWriter, ExecutionPlanReader planReader,
                            ExecutionResultWriter resultWriter, ExecutionResultReader resultReader, SalesStrategies salesStrategies, StoreReviewService reviews) {
        this.writer = writer;
        this.reader = reader;
        this.salesStrategies = salesStrategies;
        this.reviews = reviews;
        this.planWriter = planWriter;
        this.planReader = planReader;
        this.resultWriter = resultWriter;
        this.resultReader = resultReader;
    }

    @GetMapping(path = "/api/analyses/{analysisId}", produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> get(@PathVariable String analysisId, Principal owner) {
        UUID id = parseId(analysisId, "INVALID_ANALYSIS_ID", "분석 ID 형식을 확인해 주세요.", "analysisId");
        var analysis = reader.find(id, owner.getName());
        if (analysis.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("ANALYSIS_NOT_FOUND", "매출 분석을 찾을 수 없어요.", null));
        }
        return ResponseEntity.ok(analysis.get());
    }

    @GetMapping(path = "/api/analyses/{analysisId}/strategies", produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> strategies(@PathVariable String analysisId, Principal owner) {
        UUID id = parseId(analysisId, "INVALID_ANALYSIS_ID", "분석 ID 형식을 확인해 주세요.", "analysisId");
        var analysis = reader.find(id, owner.getName());
        if (analysis.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("ANALYSIS_NOT_FOUND", "매출 분석을 찾을 수 없어요.", null));
        }
        return ResponseEntity.ok(salesStrategies.from(analysis.get()));
    }

    @GetMapping("/api/analyses/{analysisId}/reviews")
    ResponseEntity<?> reviewInsights(@PathVariable String analysisId, Principal owner) {
        var analysis = reader.find(reviewAnalysisId(analysisId), owner.getName());
        if (analysis.isEmpty()) return reviewAnalysisNotFound();
        return ResponseEntity.ok(reviews.insight(analysis.get().storeId()));
    }

    @PostMapping(path = "/api/analyses/{analysisId}/reviews", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> addReview(@PathVariable String analysisId, @RequestBody JsonNode body, Principal owner) {
        var analysis = reader.find(reviewAnalysisId(analysisId), owner.getName());
        if (analysis.isEmpty()) return reviewAnalysisNotFound();
        fields(body, Set.of("date", "text"), null);
        var dateValue = body.path("date");
        LocalDate date;
        try {
            if (!dateValue.isString() || !dateValue.stringValue().matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) {
                throw invalid("INVALID_REVIEW_DATE", "리뷰 날짜를 입력해 주세요.", "date");
            }
            date = LocalDate.parse(dateValue.stringValue());
        } catch (DateTimeParseException failure) {
            throw invalid("INVALID_REVIEW_DATE", "리뷰 날짜를 확인해 주세요.", "date");
        }
        var textValue = body.path("text");
        String text = textValue.isString() ? textValue.stringValue().strip() : "";
        if (date.getYear() < 1) throw invalid("INVALID_REVIEW_DATE", "리뷰 날짜를 확인해 주세요.", "date");
        if (text.isEmpty() || text.indexOf(0) >= 0 || text.codePointCount(0, text.length()) > 1000) {
            throw invalid("INVALID_REVIEW_TEXT", "리뷰 내용을 1~1,000자로 입력해 주세요.", "text");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(reviews.add(analysis.get().storeId(), date, text));
    }

    @PostMapping(path = "/api/analyses/{analysisId}/review-plans", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> createReviewPlan(@PathVariable String analysisId, @RequestBody JsonNode body, Principal owner) {
        var id = reviewAnalysisId(analysisId);
        var analysis = reader.find(id, owner.getName());
        if (analysis.isEmpty()) return reviewAnalysisNotFound();
        fields(body, Set.of("topic", "confirmed"), null);
        var topicValue = body.get("topic");
        ReviewTopic topic;
        try {
            topic = topicValue == null ? ReviewTopic.AFTERNOON_ORDER : ReviewTopic.valueOf(topicValue.asText());
        } catch (IllegalArgumentException failure) {
            throw invalid("INVALID_REVIEW_TOPIC", "리뷰 개선 주제를 확인해 주세요.", "topic");
        }
        if (!body.path("confirmed").isBoolean() || !body.path("confirmed").booleanValue()) {
            throw invalid("REVIEW_ACTION_UNCONFIRMED", "개선 조치를 진행할 수 있는지 확인해 주세요.", "confirmed");
        }
        var insight = reviews.insight(analysis.get().storeId()).topics().stream()
                .filter(candidate -> candidate.topic() == topic).findFirst();
        if (insight.isEmpty()) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(new ApiError("REVIEW_PATTERN_NOT_FOUND", "같은 불편이 담긴 리뷰가 두 건 이상 필요해요.", null));
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(planWriter.createReviewPlan(id, insight.get()));
    }

    private static UUID reviewAnalysisId(String value) {
        return parseId(value, "INVALID_ANALYSIS_ID", "분석 ID 형식을 확인해 주세요.", "analysisId");
    }

    private static ResponseEntity<ApiError> reviewAnalysisNotFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ApiError("ANALYSIS_NOT_FOUND", "매출 분석을 찾을 수 없어요.", null));
    }

    @GetMapping(path = "/api/plans/{planId}", produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> getPlan(@PathVariable String planId, Principal owner) {
        UUID id = parseId(planId, "INVALID_PLAN_ID", "실행 계획 ID 형식을 확인해 주세요.", "planId");
        var plan = planReader.find(id, owner.getName());
        if (plan.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_NOT_FOUND", "실행 계획을 찾을 수 없어요.", null));
        }
        return ResponseEntity.ok(plan.get());
    }

    @GetMapping(path = "/api/plans/{planId}/results", produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> getLatestResult(@PathVariable String planId, Principal owner) {
        UUID id = parseId(planId, "INVALID_PLAN_ID", "실행 계획 ID 형식을 확인해 주세요.", "planId");
        var latest = resultReader.findLatest(id, owner.getName());
        if (latest.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_NOT_FOUND", "실행 계획을 찾을 수 없어요.", null));
        }
        var result = latest.get().result();
        return result == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(result);
    }

    @PostMapping(path = "/api/plans/{planId}/results", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> createResult(@PathVariable String planId, @RequestBody JsonNode body, Principal owner) {
        UUID id = parseId(planId, "INVALID_PLAN_ID", "실행 계획 ID 형식을 확인해 주세요.", "planId");
        var result = resultWriter.create(id, owner.getName(), readResult(body));
        if (result.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_NOT_FOUND", "실행 계획을 찾을 수 없어요.", null));
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result.get());
    }

    @PutMapping(path = "/api/plans/{planId}/results/{resultId}", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> replaceResult(@PathVariable String planId, @PathVariable String resultId,
                                    @RequestBody JsonNode body, Principal owner) {
        UUID plan = parseId(planId, "INVALID_PLAN_ID", "실행 계획 ID 형식을 확인해 주세요.", "planId");
        UUID id = parseId(resultId, "INVALID_PLAN_RESULT_ID", "실행 결과 ID 형식을 확인해 주세요.", "resultId");
        var replacement = resultWriter.replace(plan, id, owner.getName(), readResult(body));
        if (replacement.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_NOT_FOUND", "실행 계획을 찾을 수 없어요.", null));
        }
        var result = replacement.get().result();
        if (result == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_RESULT_NOT_FOUND", "이 실행 계획에서 수정할 결과를 찾을 수 없어요.", null));
        }
        return ResponseEntity.ok(result);
    }

    @DeleteMapping("/api/plans/{planId}/results/{resultId}")
    ResponseEntity<?> deleteResult(@PathVariable String planId, @PathVariable String resultId, Principal owner) {
        UUID plan = parseId(planId, "INVALID_PLAN_ID", "실행 계획 ID 형식을 확인해 주세요.", "planId");
        UUID id = parseId(resultId, "INVALID_PLAN_RESULT_ID", "실행 결과 ID 형식을 확인해 주세요.", "resultId");
        return switch (resultWriter.delete(plan, id, owner.getName())) {
            case DELETED -> ResponseEntity.noContent().build();
            case PLAN_NOT_FOUND -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_NOT_FOUND", "실행 계획을 찾을 수 없어요.", null));
            case RESULT_NOT_FOUND -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_RESULT_NOT_FOUND", "이 실행 계획에서 삭제할 결과를 찾을 수 없어요.", null));
        };
    }

    private static ExecutionResultWriter.Input readResult(JsonNode body) {
        fields(body, Set.of("scope", "before", "after"), null);
        var scopeNode = body.path("scope");
        if (!scopeNode.isString()) {
            throw invalidResult("공통 비교 기준을 입력해 주세요.", "scope");
        }
        String scope = scopeNode.stringValue();
        if (scope.isBlank() || scope.indexOf(0) >= 0 || scope.codePointCount(0, scope.length()) > 100) {
            throw invalidResult("공통 비교 기준은 1~100자로 입력해 주세요.", "scope");
        }
        var before = resultPeriod(body.path("before"), "before");
        var after = resultPeriod(body.path("after"), "after");
        if (!before.end().isBefore(after.start())) {
            throw invalidResult("실행 후 기간은 실행 전 기간이 끝난 뒤 시작해야 해요.", "after.start");
        }
        if ((before.amount() == null) != (after.amount() == null)) {
            throw invalidResult("매출을 비교하려면 두 기간에 모두 입력해 주세요.",
                    before.amount() == null ? "before.amount" : "after.amount");
        }
        if ((before.count() == null) != (after.count() == null)) {
            throw invalidResult("결제 건수를 비교하려면 두 기간에 모두 입력해 주세요.",
                    before.count() == null ? "before.count" : "after.count");
        }
        return new ExecutionResultWriter.Input(scope, before, after);
    }

    private static ExecutionResultWriter.Period resultPeriod(JsonNode node, String field) {
        if (!node.isObject()) {
            throw invalidResult("비교 기간을 입력해 주세요.", field);
        }
        fields(node, Set.of("start", "end", "days", "amount", "count"), field);
        LocalDate start = resultDate(node.path("start"), field + ".start");
        LocalDate end = resultDate(node.path("end"), field + ".end");
        if (end.isBefore(start)) {
            throw invalidResult("종료일은 시작일보다 앞설 수 없어요.", field + ".end");
        }
        var days = node.path("days");
        long calendarDays = ChronoUnit.DAYS.between(start, end) + 1;
        if (!days.isIntegralNumber() || !days.canConvertToInt() || days.intValue() < 1 || days.intValue() > calendarDays) {
            throw invalidResult("영업일 수는 1일 이상이고 비교 기간 이하여야 해요.", field + ".days");
        }
        Long amount = node.has("amount") ? number(node.get("amount"), field + ".amount", "INVALID_PLAN_RESULT") : null;
        Long count = node.has("count") ? number(node.get("count"), field + ".count", "INVALID_PLAN_RESULT") : null;
        if (amount == null && count == null) {
            throw invalidResult("매출 또는 결제 건수를 입력해 주세요.", field);
        }
        return new ExecutionResultWriter.Period(start, end, days.intValue(), amount, count);
    }

    private static LocalDate resultDate(JsonNode node, String field) {
        if (node.isString() && node.stringValue().matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) {
            try {
                return LocalDate.parse(node.stringValue());
            } catch (DateTimeParseException ignored) {
                // Return the field error for any invalid calendar date.
            }
        }
        throw invalidResult("날짜를 YYYY-MM-DD 형식으로 입력해 주세요.", field);
    }

    private static InvalidAnalysis invalidResult(String message, String field) {
        return invalid("INVALID_PLAN_RESULT", message, field);
    }

    @PatchMapping(path = "/api/plans/{planId}/checklist/{itemId}", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> updateChecklist(@PathVariable String planId, @PathVariable String itemId,
                                      @RequestBody JsonNode body, Principal owner) {
        UUID plan = parseId(planId, "INVALID_PLAN_ID", "실행 계획 ID 형식을 확인해 주세요.", "planId");
        UUID item = parseId(itemId, "INVALID_CHECKLIST_ITEM_ID", "체크리스트 항목 ID 형식을 확인해 주세요.", "itemId");
        var completed = body.path("completed");
        if (!body.isObject() || body.size() != 1 || !completed.isBoolean()) {
            throw invalid("INVALID_CHECKLIST_STATUS", "완료 상태를 true 또는 false로 보내 주세요.", "completed");
        }
        var updated = planWriter.updateChecklist(plan, item, owner.getName(), completed.booleanValue());
        if (!updated.planFound()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("PLAN_NOT_FOUND", "실행 계획을 찾을 수 없어요.", null));
        }
        if (updated.item() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("CHECKLIST_ITEM_NOT_FOUND", "이 실행 계획에서 체크리스트 항목을 찾을 수 없어요.", null));
        }
        return ResponseEntity.ok(updated.item());
    }

    @PostMapping(path = "/api/analyses/{analysisId}/plans", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> createPlan(@PathVariable String analysisId, @RequestBody JsonNode body, Principal owner) {
        UUID id = parseId(analysisId, "INVALID_ANALYSIS_ID", "분석 ID 형식을 확인해 주세요.", "analysisId");
        fields(body, Set.of("strategyCode", "conditions"), null);
        var code = body.get("strategyCode");
        if (code == null || !code.isString() || !Set.of("OUTREACH", "PROMOTION", "INVENTORY").contains(code.stringValue())) {
            throw invalid("INVALID_STRATEGY_CODE", "대응 전략을 선택해 주세요.", "strategyCode");
        }
        String strategyCode = code.stringValue();
        var conditions = planConditions(body.get("conditions"), strategyCode);
        var result = planWriter.create(id, owner.getName(), strategyCode, conditions);
        if (result.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("ANALYSIS_NOT_FOUND", "매출 분석을 찾을 수 없어요.", null));
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result.get());
    }

    private static ExecutionPlanWriter.Conditions planConditions(JsonNode node, String strategyCode) {
        String errorCode = "INVALID_PLAN_CONDITIONS";
        if (node == null || !node.isObject()) {
            throw invalid(errorCode, "실행 조건을 입력해 주세요.", "conditions");
        }
        fields(node, Set.of("durationWeeks", "budgetWon", "channel"), "conditions");
        var weeks = node.get("durationWeeks");
        if (weeks == null || !weeks.isIntegralNumber() || !weeks.canConvertToInt()
                || !Set.of(1, 2, 4).contains(weeks.intValue())) {
            throw invalid(errorCode, "실행 기간은 1주, 2주, 4주 중에서 선택해 주세요.", "conditions.durationWeeks");
        }
        var budget = node.get("budgetWon");
        var channel = node.get("channel");
        if (strategyCode.equals("INVENTORY")) {
            if (budget != null || channel != null) {
                throw invalid(errorCode, "발주량 검토에는 예산과 홍보 채널을 입력하지 않아요.", "conditions");
            }
            return new ExecutionPlanWriter.Conditions(weeks.intValue(), null, null);
        }
        long budgetWon = number(budget, "conditions.budgetWon", errorCode);
        if (channel == null || !channel.isString() || !Set.of("INSTAGRAM", "STORE_NOTICE").contains(channel.stringValue())) {
            throw invalid(errorCode, "실행 채널을 선택해 주세요.", "conditions.channel");
        }
        return new ExecutionPlanWriter.Conditions(weeks.intValue(), budgetWon, channel.stringValue());
    }

    @PutMapping(path = "/api/analyses/{analysisId}/time-series", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> putTimeSeries(@PathVariable String analysisId, @RequestBody JsonNode body, Principal owner) {
        UUID id = parseId(analysisId, "INVALID_ANALYSIS_ID", "분석 ID 형식을 확인해 주세요.", "analysisId");
        var result = writer.replaceTimeSeries(id, owner.getName(), readTimeSeries(body, ""));
        if (result.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("ANALYSIS_NOT_FOUND", "매출 분석을 찾을 수 없어요.", null));
        }
        var saved = result.get();
        return ResponseEntity.status(saved.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(saved.analysis());
    }

    @PostMapping(path = "/api/stores/{storeId}/analyses", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> create(@PathVariable String storeId, @RequestBody JsonNode body, Principal owner) {
        UUID store = parseId(storeId, "INVALID_STORE_ID", "매장 ID 형식을 확인해 주세요.", "storeId");
        AnalysisInput input = readInput(body);
        UUID id = UUID.randomUUID();
        var createdAt = writer.save(id, store, owner.getName(), input);
        if (createdAt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("STORE_NOT_FOUND", "매장을 찾을 수 없어요.", null));
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(new AnalysisResponse(
                id, store, input.concern(), input.beforeMonth(), input.afterMonth(), input.monthlySales(),
                input.timeSeries(), createdAt.get()));
    }

    private static UUID parseId(String value, String code, String message, String field) {
        try {
            UUID id = UUID.fromString(value);
            if (id.toString().equalsIgnoreCase(value)) {
                return id;
            }
        } catch (IllegalArgumentException ignored) {
            // Use the same error for all invalid UUID formats.
        }
        throw invalid(code, message, field);
    }

    private static AnalysisInput readInput(JsonNode body) {
        fields(body, Set.of("concern", "monthlySales", "timeSeries"), null);
        var concern = body.get("concern");
        if (concern != null && (!concern.isString() || concern.stringValue().indexOf(0) >= 0)) {
            throw invalid("INVALID_REQUEST", "고민은 글로 입력해 주세요.", "concern");
        }

        var monthly = body.get("monthlySales");
        if (monthly == null || !monthly.isArray() || monthly.size() < 2) {
            throw invalid("INVALID_MONTHLY_SALES", "서로 다른 두 달 이상의 매출을 입력해 주세요.", "monthlySales");
        }
        var months = new TreeMap<YearMonth, Long>();
        for (var row : monthly) {
            fields(row, Set.of("month", "amount"), "monthlySales");
            var month = row.get("month");
            if (month == null || !month.isString() || !month.stringValue().matches("[0-9]{4}-(0[1-9]|1[0-2])")) {
                throw invalid("INVALID_MONTHLY_SALES", "매출 월을 YYYY-MM 형식으로 입력해 주세요.", "monthlySales");
            }
            var value = YearMonth.parse(month.stringValue());
            if (months.putIfAbsent(value, number(row.get("amount"), "monthlySales.amount", "INVALID_REQUEST")) != null) {
                throw invalid("DUPLICATE_SALES_MONTH", "같은 달의 매출은 한 번만 입력해 주세요.", "monthlySales");
            }
        }
        var ordered = months.entrySet().stream()
                .map(month -> new MonthlySale(month.getKey().toString(), month.getValue())).toList();
        var timeSeries = body.get("timeSeries");
        return new AnalysisInput(concern == null ? null : concern.stringValue(), ordered,
                timeSeries == null ? null : readTimeSeries(timeSeries, "timeSeries."));
    }

    private static TimeSeries readTimeSeries(JsonNode node, String prefix) {
        fields(node, Set.of("metric", "rows"), prefix.isEmpty() ? null : "timeSeries");
        String rowsField = prefix + "rows";
        var metric = node.get("metric");
        if (metric == null || !metric.isString() || !Set.of("AMOUNT", "COUNT").contains(metric.stringValue())) {
            throw invalid("INVALID_TIME_SERIES", "시간대 자료의 단위를 확인해 주세요.", prefix + "metric");
        }
        var rows = node.get("rows");
        if (rows == null || !rows.isArray() || rows.isEmpty()) {
            throw invalid("INVALID_TIME_SERIES", "시간대별 자료를 한 구간 이상 입력해 주세요.", rowsField);
        }
        var labels = new HashSet<String>();
        var result = new ArrayList<TimeSlot>();
        for (var row : rows) {
            fields(row, Set.of("label", "before", "after"), rowsField);
            var labelNode = row.get("label");
            String label = labelNode != null && labelNode.isString() ? labelNode.stringValue().strip() : "";
            if (label.isEmpty() || label.indexOf(0) >= 0) {
                throw invalid("INVALID_TIME_SERIES", "시간대 구간 이름을 입력해 주세요.", rowsField);
            }
            if (!labels.add(label)) {
                throw invalid("INVALID_TIME_SERIES", "같은 시간대 구간 이름을 중복 입력할 수 없어요.", rowsField);
            }
            result.add(new TimeSlot(label, number(row.get("before"), rowsField + ".before", "INVALID_TIME_SERIES"),
                    number(row.get("after"), rowsField + ".after", "INVALID_TIME_SERIES")));
        }
        return new TimeSeries(metric.stringValue(), List.copyOf(result));
    }

    private static long number(JsonNode value, String field, String code) {
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()
                || value.longValue() < 0 || value.longValue() > MAX_VALUE) {
            throw invalid(code, "0 이상이며 허용 범위 안의 정수를 입력해 주세요.", field);
        }
        return value.longValue();
    }

    private static void fields(JsonNode node, Set<String> allowed, String path) {
        if (!node.isObject()) {
            throw invalid("INVALID_REQUEST", "입력값을 JSON 객체로 보내 주세요.", path);
        }
        for (String field : node.propertyNames()) {
            if (!allowed.contains(field)) {
                throw invalid("INVALID_REQUEST", "지원하지 않는 입력 항목이에요.", path == null ? field : path + "." + field);
            }
        }
    }

    @ExceptionHandler(InvalidAnalysis.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError invalidAnalysis(InvalidAnalysis failure) {
        return failure.error;
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError invalidJson() {
        return new ApiError("INVALID_REQUEST", "매출 분석 정보를 올바른 JSON 형식으로 입력해 주세요.", null);
    }

    private static InvalidAnalysis invalid(String code, String message, String field) {
        return new InvalidAnalysis(new ApiError(code, message, field));
    }

    private static final class InvalidAnalysis extends RuntimeException {
        private final ApiError error;

        InvalidAnalysis(ApiError error) {
            this.error = error;
        }
    }

    record AnalysisInput(String concern, List<MonthlySale> monthlySales, TimeSeries timeSeries) {
        String beforeMonth() {
            return monthlySales.get(monthlySales.size() - 2).month();
        }

        String afterMonth() {
            return monthlySales.getLast().month();
        }
    }

    record MonthlySale(String month, long amount) {}
    record TimeSeries(String metric, List<TimeSlot> rows) {}
    record TimeSlot(String label, long before, long after) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record AnalysisResponse(UUID id, UUID storeId, String concern, String beforeMonth, String afterMonth,
                            List<MonthlySale> monthlySales, TimeSeries timeSeries, OffsetDateTime createdAt) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ApiError(String code, String message, String field) {}
}
