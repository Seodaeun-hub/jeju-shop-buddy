package com.jejushopbuddy.analysis;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import com.jejushopbuddy.analysis.SalesAnalysisController.MonthlySale;
import com.jejushopbuddy.analysis.SalesAnalysisController.TimeSlot;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

final class SalesStrategies {
    private SalesStrategies() {}

    static Response from(AnalysisResponse analysis) {
        var monthly = new Evidence("MONTHLY_SALES", "AMOUNT", null,
                amountFor(analysis, analysis.beforeMonth()), amountFor(analysis, analysis.afterMonth()));
        var series = analysis.timeSeries();
        Evidence decline = series == null ? null : series.rows().stream()
                .filter(slot -> slot.before() > slot.after())
                .max(Comparator.comparingLong((TimeSlot slot) -> slot.before() - slot.after()))
                .map(slot -> new Evidence("TIME_SERIES", series.metric(), slot.label(), slot.before(), slot.after()))
                .orElse(null);

        String monthlyTrend = monthly.after() < monthly.before() ? "월별 매출이 줄었어요."
                : monthly.after() > monthly.before() ? "월별 매출이 늘었어요." : "월별 매출이 같아요.";
        String timeContext = series == null ? "시간대별 자료를 추가하면 어느 구간을 먼저 볼지 확인할 수 있어요."
                : "저장된 시간대 자료에서 감소한 구간이 없어요.";
        boolean count = decline != null && decline.metric().equals("COUNT");
        String declineReason = decline == null ? null
                : decline.label() + " 구간의 " + (count ? "결제 건수가" : "매출액이") + " 줄었어요.";
        var priorityEvidence = List.of(decline == null ? monthly : decline);

        var outreach = new Suggestion("OUTREACH", "주문 안내 점검하기",
                decline == null ? "AVAILABLE" : "RECOMMENDED",
                decline == null ? monthlyTrend + " " + timeContext
                        : declineReason + " 실제 주문 가능 시간과 매장 안내가 일치하는지 확인해 보세요.",
                priorityEvidence, List.of(),
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
                List.of(outreach, promotion, inventory));
    }

    private static long amountFor(AnalysisResponse analysis, String month) {
        return analysis.monthlySales().stream()
                .filter(sale -> sale.month().equals(month))
                .mapToLong(MonthlySale::amount)
                .findFirst().orElseThrow();
    }

    record Response(UUID analysisId, String beforeMonth, String afterMonth, List<Suggestion> strategies) {}

    record Suggestion(String code, String title, String status, String reason, List<Evidence> evidence,
                      List<String> missingInputs, String followUp) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Evidence(String source, String metric, String label, long before, long after) {}
}
