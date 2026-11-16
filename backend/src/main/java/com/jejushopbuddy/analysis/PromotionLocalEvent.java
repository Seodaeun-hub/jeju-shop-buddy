package com.jejushopbuddy.analysis;

import java.time.LocalDate;
import java.util.List;

record PromotionLocalEvent(String id, String name, LocalDate startDate, LocalDate endDate,
                           String venue, String sourceUrl, String captionLine) {
    private static final PromotionLocalEvent CITRUS_EXPO = new PromotionLocalEvent(
            "jeju-citrus-expo-2026", "2026 제주감귤박람회",
            LocalDate.of(2026, 11, 19), LocalDate.of(2026, 11, 23), "서귀포농업기술센터 일원",
            "https://agri.jeju.go.kr/seogwipo/notice/notice.htm?act=view&seq=62210",
            "제주 나들이를 계획 중이라면 2026 제주감귤박람회 소식도 참고해 보세요. "
                    + "11월 19~23일, 서귀포농업기술센터 일원에서 열려요.");

    static List<PromotionLocalEvent> forPlan(LocalDate start, LocalDate end, LocalDate publishDate) {
        return CITRUS_EXPO.applies(start, end, publishDate) ? List.of(CITRUS_EXPO) : List.of();
    }

    boolean applies(LocalDate start, LocalDate end, LocalDate publishDate) {
        return !endDate.isBefore(start) && !startDate.isAfter(end)
                && !publishDate.isAfter(endDate) && !publishDate.isAfter(end);
    }

    PromotionLocalEvent forCaption(String storeName, String subject, boolean hasOffer) {
        String opening = name + "를 보러 제주 나들이를 계획 중이세요? ";
        String invitation = hasOffer
                ? "이번 제주 일정에 " + storeName + "에서 " + subject + " 한 번 맛보는 건 어떠세요?"
                : storeName + "의 ‘" + subject + "’ 소식도 이번 제주 일정에 참고해 보세요.";
        return new PromotionLocalEvent(id, name, startDate, endDate, venue, sourceUrl, opening + invitation);
    }

    static String captionFooter(String offer, PromotionLocalEvent event) {
        if (event == null) return offer;
        return offer == null ? event.captionLine() : event.captionLine() + "\n\n" + offer;
    }
}
