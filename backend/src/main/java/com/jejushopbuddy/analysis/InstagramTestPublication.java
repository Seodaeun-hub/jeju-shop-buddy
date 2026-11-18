package com.jejushopbuddy.analysis;

import java.time.LocalDate;

final class InstagramTestPublication {
    private InstagramTestPublication() {}

    static boolean available(boolean connected, boolean optedIn, boolean rehearsing) {
        return connected && optedIn && rehearsing;
    }

    static String notice(LocalDate referenceDate, LocalDate actualDate) {
        return "[가게짝꿍 가상 시연 · 테스트 게시]\n"
                + "시연 기준일: " + referenceDate + " / 실제 게시일: " + actualDate + "\n"
                + "과거 자료를 재현한 기능 검증용 게시물입니다. 실제 매장의 공식 홍보·현재 진행하는 판매 행사가 아닙니다.\n"
                + "음식 사진은 AI 예시이며 매출·원가·할인 조건은 가상 시연 자료입니다.";
    }

    static String caption(String draft, LocalDate referenceDate, LocalDate actualDate) {
        return notice(referenceDate, actualDate) + "\n\n" + draft;
    }
}
