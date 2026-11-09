package com.jejushopbuddy.analysis;

import java.util.List;
import java.util.regex.Pattern;

enum ReviewTopic {
    AFTERNOON_ORDER("오후 주문 안내", "오후 식사 주문 안내 개선",
            "매장 입구와 지도에 실제 주문 가능 시간과 메뉴를 적어요.",
            "오후 2~5시에도 식사 주문을 받아요.",
            "같은 요일·오후 2~5시의 하루 평균 결제 건수를 비교해요.",
            List.of("오후에 주문받는 시간과 메뉴 확인하기", "안내 문구 확인하기",
                    "매장 입구와 지도에 주문 안내 추가하기", "오후 2~5시 결제 건수 확인하기"),
            "오후|점심\\s*이후", "식사|주문", "헷갈|몰랐|몰라|알기\\s*어려|안내가\\s*없"),
    PARKING("주차 불편", "주차 안내 개선",
            "이용 가능한 주차장과 입구 위치를 확인해 매장 안내와 지도에 표시해요.",
            "주차 위치와 이용 조건을 확인하고 안내를 개선할게요.",
            "안내를 수정한 뒤 주차 문의와 같은 불편이 담긴 리뷰가 줄었는지 확인해요.",
            List.of("이용 가능한 주차장과 입구 확인하기", "주차 위치와 이용 조건 정리하기",
                    "매장 안내와 지도에 주차 정보 반영하기", "주차 문의와 리뷰 다시 확인하기"),
            "주차", "어렵|어려|힘들|헷갈|몰랐|몰라|불편|부족|복잡|만차|자리.{0,5}없|안내.{0,5}없|찾.{0,5}못"),
    WAIT_TIME("대기시간 불편", "대기시간 안내 개선",
            "혼잡한 시간에 실제 대기시간을 기록하고, 손님에게 예상 대기시간과 순서를 안내해요.",
            "실제 대기시간을 확인하고 대기 안내를 개선할게요.",
            "혼잡한 시간대의 실제 대기시간과 대기 관련 불편 리뷰를 비교해요.",
            List.of("혼잡 시간대와 실제 대기시간 기록하기", "예상 대기시간과 순서 안내 정하기",
                    "입구에서 대기 안내 적용하기", "대기시간과 관련 리뷰 다시 확인하기"),
            "대기|기다|웨이팅|줄을\\s*서",
            "오래|길었|길어|길고|길다|길어서|한참|불편|힘들|답답|지쳤|느렸|안내.{0,5}없|넘게|지나도|모르|몰랐|몰라");

    final String label;
    final String title;
    final String action;
    final String confirmation;
    final String followUp;
    final List<String> checklist;
    private final List<Pattern> signals;
    private static final Pattern NEGATED = Pattern.compile("어렵지\\s*않|힘들지\\s*않|불편하지\\s*않|헷갈리지\\s*않|오래\\s*기다리지\\s*않|길지\\s*않");

    ReviewTopic(String label, String title, String action, String confirmation,
                String followUp, List<String> checklist, String... signals) {
        this.label = label;
        this.title = title;
        this.action = action;
        this.confirmation = confirmation;
        this.followUp = followUp;
        this.checklist = checklist;
        this.signals = java.util.Arrays.stream(signals).map(Pattern::compile).toList();
    }

    boolean matches(String text) {
        for (String sentence : text.split("[.!?\\r\\n]+")) {
            if (!NEGATED.matcher(sentence).find() && signals.stream().allMatch(p -> p.matcher(sentence).find())) return true;
        }
        return false;
    }
}
