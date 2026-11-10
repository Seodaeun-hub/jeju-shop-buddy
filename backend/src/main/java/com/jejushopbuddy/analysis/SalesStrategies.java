package com.jejushopbuddy.analysis;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesAnalysisController.MonthlySale;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSlot;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
final class SalesStrategies {
    private final JejuMarketContext marketContext;

    SalesStrategies(JejuMarketContext marketContext) {
        this.marketContext = marketContext;
    }

    Response from(AnalysisResponse analysis) {
        long beforeAmount = amountFor(analysis, analysis.beforeMonth());
        long afterAmount = amountFor(analysis, analysis.afterMonth());
        var monthly = new Evidence("MONTHLY_SALES", "AMOUNT", null, beforeAmount, afterAmount);
        var context = marketContext.forStore(analysis.storeId(), analysis.beforeMonth(), analysis.afterMonth()).context();
        var series = analysis.timeSeries();
        Evidence decline = series == null ? null : series.rows().stream()
                .filter(slot -> slot.before() > slot.after())
                .max(Comparator.comparingLong((TimeSlot slot) -> slot.before() - slot.after()))
                .map(slot -> new Evidence("TIME_SERIES", series.metric(), slot.label(), slot.before(), slot.after()))
                .orElse(null);

        String monthlyTrend = afterAmount < beforeAmount ? "월별 매출이 줄었어요."
                : afterAmount > beforeAmount ? "월별 매출이 늘었어요." : "월별 매출이 같아요.";
        String timeContext = series == null ? "시간대별 자료를 추가하면 어느 구간을 먼저 볼지 확인할 수 있어요."
                : "저장된 시간대 자료에서 감소한 구간이 없어요.";
        boolean count = decline != null && decline.metric().equals("COUNT");
        String declineReason = decline == null ? null
                : decline.label() + " 구간의 " + (count ? "결제 건수가" : "매출액이") + " 줄었어요.";
        var priorityEvidence = List.of(decline == null ? monthly : decline);

        var outreachEvidence = new ArrayList<>(priorityEvidence);
        String outreachReason = decline == null ? monthlyTrend + " " + timeContext
                : declineReason + " 실제 주문 가능 시간과 매장 안내가 일치하는지 확인해 보세요.";
        var card = context.card();
        boolean diverged = afterAmount < beforeAmount && card != null && card.after().compareTo(card.before()) > 0;
        if (card != null) {
            if (decline != null) outreachEvidence.add(monthly);
            outreachEvidence.add(new Evidence("MARKET_CARD_SALES", "AMOUNT", null, card.before(), card.after()));
        }
        if (diverged) {
            outreachReason = "매장 월별 매출은 " + percent(monthly.before(), monthly.after()) + " 줄었지만, 같은 기간 같은 읍·면·동·업종의 카드 이용액은 "
                    + (card.before().signum() == 0 ? "" : percent(card.before(), card.after()) + " ")
                    + "늘었어요. " + (decline == null ? "실제 주문 가능 시간과 매장 안내가 일치하는지 확인해 보세요."
                            : declineReason + " 해당 시간대의 주문 안내부터 확인해 보세요.");
        }
        var bsi = context.bsi();
        if (bsi != null) {
            outreachEvidence.add(new Evidence("JEJU_BSI", "INDEX", null, bsi.before(), bsi.after()));
            outreachReason += " 제주 전체 소상공인 체감 BSI는 " + bsi.before() + "에서 " + bsi.after()
                    + "로 바뀌었어요. 제주 경기 흐름을 참고하는 지표예요.";
        }

        var outreach = new Suggestion("OUTREACH", "주문 안내 점검하기",
                decline != null || diverged ? "RECOMMENDED" : "AVAILABLE", outreachReason,
                List.copyOf(outreachEvidence), List.of(),
                "안내를 수정했다면 같은 요일·시간대의 하루 평균 " + (count ? "결제 건수를" : "매출액을") + " 비교해요.");
        var promotion = new Suggestion("PROMOTION", "시간대 한정 혜택 검토하기", "NEEDS_INPUT",
                (decline == null ? monthlyTrend + " " + timeContext : declineReason)
                        + " 할인안을 검토하려면 주문당 비용과 예산이 필요해요.",
                priorityEvidence, List.of("메뉴별 판매가와 주문당 비용", "할인 예산 한도"),
                "혜택을 실행하면 결제 건수와 할인 적용 후 주문당 남는 금액을 확인해요.");
        var inventory = new Suggestion("INVENTORY", "발주량 검토하기", "NEEDS_INPUT",
                monthlyTrend + " 발주량은 품목별 재고와 예상 사용량을 확인한 뒤 검토해요.",
                List.of(monthly), List.of("품목별 현재 재고", "다음 입고까지 예상 사용량", "입고 예정량"),
                "확정 발주량과 실행 후 남은 재고를 같은 단위로 기록해요.");

        return new Response(analysis.id(), analysis.beforeMonth(), analysis.afterMonth(),
                List.of(outreach, promotion, inventory), "RULES", List.of());
    }

    private static String percent(BigDecimal before, BigDecimal after) {
        var rate = after.subtract(before).abs().movePointRight(2).divide(before, 2, RoundingMode.HALF_UP);
        return rate.toPlainString() + "%";
    }

    static long amountFor(AnalysisResponse analysis, String month) {
        return analysis.monthlySales().stream()
                .filter(sale -> sale.month().equals(month))
                .mapToLong(MonthlySale::amount)
                .findFirst().orElseThrow();
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Response(UUID analysisId, String beforeMonth, String afterMonth, List<Suggestion> strategies,
                    String recommendationSource, List<Evidence> contextEvidence, UUID recommendationId) {
        Response(UUID analysisId, String beforeMonth, String afterMonth, List<Suggestion> strategies,
                 String recommendationSource, List<Evidence> contextEvidence) {
            this(analysisId, beforeMonth, afterMonth, strategies, recommendationSource, contextEvidence, null);
        }

        Response withId(UUID id) {
            return new Response(analysisId, beforeMonth, afterMonth, strategies, recommendationSource, contextEvidence, id);
        }
    }

    record RecommendationContext(UUID id, String beforeMonth, String afterMonth, List<Evidence> contextEvidence) {}

    record CustomerNotice(String concern, String text, String placement) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Suggestion(String code, String title, String status, String reason, List<Evidence> evidence,
                      List<String> missingInputs, String followUp, List<StoreReviewService.Review> reviewEvidence,
                      ReviewTopic reviewTopic, String nextAction, RecommendationContext recommendation,
                      StrategyAgentClient.GuideResponse executionGuide, CustomerNotice customerNotice) {
        Suggestion(String code, String title, String status, String reason, List<Evidence> evidence,
                   List<String> missingInputs, String followUp) {
            this(code, title, status, reason, evidence, missingInputs, followUp, null, null, null, null, null, null);
        }

        Suggestion(String code, String title, String status, String reason, List<Evidence> evidence,
                   List<String> missingInputs, String followUp, List<StoreReviewService.Review> reviewEvidence,
                   ReviewTopic reviewTopic) {
            this(code, title, status, reason, evidence, missingInputs, followUp, reviewEvidence, reviewTopic, null, null, null, null);
        }

        Suggestion withRecommendation(RecommendationContext context) {
            return new Suggestion(code, title, status, reason, evidence, missingInputs, followUp,
                    reviewEvidence, reviewTopic, nextAction, context, executionGuide, customerNotice);
        }

        Suggestion withExecutionGuide(StrategyAgentClient.GuideResponse guide) {
            return new Suggestion(code, title, status, reason, evidence, missingInputs, followUp,
                    reviewEvidence, reviewTopic, nextAction, recommendation, guide, customerNotice);
        }

        Suggestion withCustomerNotice(CustomerNotice notice) {
            return new Suggestion(code, title, status, reason, evidence, missingInputs, followUp,
                    reviewEvidence, reviewTopic, nextAction, recommendation, executionGuide, notice);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Evidence(String source, String metric, String label, BigDecimal before, BigDecimal after) {
        Evidence(String source, String metric, String label, long before, long after) {
            this(source, metric, label, BigDecimal.valueOf(before), BigDecimal.valueOf(after));
        }
    }
}
