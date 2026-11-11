import re
from dataclasses import dataclass

from .schemas import ConcernType, Evidence, Recommendation, StrategyCode, StrategyRequest

CONCERN_PATTERNS: dict[ConcernType, str] = {
    "MARKETING": r"홍보|광고|인스타|SNS|블로그|(?:가게|메뉴)\s*(?:를\s*)?알리|가게\s*인지도"
                 r"|(?:메뉴\s*사진|가게\s*소식)[^.!?\n]{0,20}(?:게시|알리|방문\s*안내)",
    "INVENTORY": r"재고|발주|입고|재료\s*(?:가\s*)?남|식재료\s*폐기",
    "SALES": r"매출\s*(?:액)?\s*(?:이|은|도|가)?\s*(?:감소|하락|줄|떨어|급감|부진|내려)|줄어든\s*매출"
             r"|매출\s*감소\s*원인|결제\s*(?:건수)?\s*(?:가|도|는)?\s*(?:줄|감소)|주문\s*안내",
    "DISCOUNT": r"할인|쿠폰|혜택|프로모션|특가",
    "VISITORS": r"방문객|유동\s*인구|방문자|방문\s*(?:수|건수)|(?:고객|손님)\s*수(?!요)"
                r"|(?:손님|방문)\s*(?:이|은|도|가)?\s*(?:줄|늘|감소|증가|뜸)",
    "PROFIT": r"수익|마진|이익|원가|비용|고정비|손익|남는\s*돈",
    "REVIEWS": r"리뷰|후기|별점|평점|불만|악평",
    "MENU": r"메뉴별|품목별\s*판매|판매량|메뉴\s*(?:를\s*)?(?:바꾸|줄이|늘리|정리|구성)"
            r"|인기\s*메뉴|잘\s*팔리는\s*메뉴",
    "OPERATIONS": r"영업\s*시간|근무\s*시간|인력|인건비|직원\s*배치|대기\s*시간|브레이크\s*타임|영업\s*일정",
    "LOYALTY": r"단골|재방문|재구매|반복\s*구매",
}
WORKFLOWS: dict[ConcernType, StrategyCode] = {
    "INVENTORY": "INVENTORY",
    "SALES": "OUTREACH",
    "DISCOUNT": "PROMOTION",
}
EXCLUSION = re.compile(r"^(?:은|는|을|를|도|과|와)?\s*(?:없이|말고|빼고|제외|안\s*하고|안\s*할|안\s*해|하지\s*않)")
UNSUPPORTED_MEASUREMENT = re.compile(
    r"방문객|방문자|유동\s*인구|유입|방문\s*(?:고객|인원|건수|횟수|수(?!요))"
    r"|(?:손님|고객)\s*(?:수(?!요)|인원|유입)|(?:손님|고객|방문)\s*(?:이|은|도|가)?\s*(?:늘|줄|감소|증가|많|적|몰|뜸)"
    r"|찾는\s*(?:사람|고객|손님)|발길|통행량"
    r"|상권\s*(?:의\s*)?(?:카드\s*)?(?:이용|결제|거래)\s*(?:건수|횟수)"
)


def explicit_concerns(text: str) -> list[ConcernType]:
    positions = []
    for concern, pattern in CONCERN_PATTERNS.items():
        for match in re.finditer(pattern, text, re.IGNORECASE):
            if not EXCLUSION.match(text[match.end():].lstrip()):
                positions.append((match.start(), concern))
                break
    return [concern for _, concern in sorted(positions)]


def strategy_concern(card: Recommendation) -> ConcernType:
    for concern, code in WORKFLOWS.items():
        if card.strategyCode == code:
            return concern
    labels = explicit_concerns(card.title or "")
    declared = getattr(card, "concernType", None)
    if declared in labels:
        return declared
    # The title or the work itself must support the model's label.
    if declared and declared != "OTHER" and declared in explicit_concerns(" ".join([card.nextAction, *card.steps])):
        return declared
    return labels[0] if labels else "OTHER"


@dataclass(frozen=True)
class ActionPlan:
    title: str
    rationale: str
    first: str
    steps: tuple[str, ...]
    follow_up: str


CUSTOM_PLANS: dict[ConcernType, ActionPlan] = {
    "MARKETING": ActionPlan(
        "대표 메뉴와 가게 소식 홍보하기", "대표 메뉴와 가게 소식을 알린 뒤 같은 영업 조건의 반응을 비교해 볼 만해요.",
        "알릴 메뉴나 가게 소식을 하나 골라 운영 중인 홍보 채널을 확인해 보세요.",
        ("대표 메뉴 사진과 영업 정보를 준비하기", "운영 중인 채널에 사진과 방문 안내 게시하기"),
        "게시 전후 비슷한 영업일의 하루 평균 매출을 비교해요.",
    ),
    "VISITORS": ActionPlan(
        "요일·시간대별 방문객 수 직접 확인하기", "방문객 수는 별도 집계가 필요해요.",
        "비교할 요일과 시간대를 정하고 방문객 수를 직접 기록해 보세요.",
        ("같은 요일·시간대의 방문객 수를 직접 집계하기", "방문객 집계와 결제 건수를 각각 기록하기"),
        "같은 요일·시간대끼리 직접 집계한 방문객 수를 비교해요.",
    ),
    "PROFIT": ActionPlan(
        "대표 메뉴의 원가와 주문당 이익 확인하기", "이익을 확인하려면 판매가와 함께 원가·비용을 확인해야 해요.",
        "확인할 메뉴의 판매가, 식재료비, 포장비와 수수료 자료를 모아 보세요.",
        ("대표 메뉴의 실제 판매가와 변동 비용 기록하기", "판매가에서 주문당 변동 비용을 빼서 남는 금액 비교하기"),
        "메뉴별 주문당 남는 금액과 확인한 비용을 기록해요.",
    ),
    "REVIEWS": ActionPlan(
        "최근 리뷰에서 반복되는 불편 확인하기", "리뷰에 남은 불편은 최근 후기 원문에서 확인해 볼 만해요.",
        "최근 후기를 열어 주문·응대·대기 관련 불편이 반복되는지 확인해 보세요.",
        ("최근 후기를 확인해 반복되는 불편을 기록하기", "가장 자주 나온 불편 한 가지의 개선안을 정하기"),
        "개선 뒤 같은 불편이 새 후기에 반복되는지 확인해요.",
    ),
    "MENU": ActionPlan(
        "메뉴별 판매량과 품절 기록 확인하기", "메뉴별 차이는 품목별 판매 자료와 품절 기록을 함께 보면 확인할 수 있어요.",
        "비교 기간의 메뉴별 판매량 자료와 품절 기록을 준비해 보세요.",
        ("메뉴별 판매량을 같은 기간끼리 비교하기", "판매량 변화와 품절일을 대조하고 점검할 메뉴 정하기"),
        "점검한 메뉴의 판매량과 품절 여부를 다시 기록해요.",
    ),
    "OPERATIONS": ActionPlan(
        "영업시간과 근무 배치 점검하기", "운영 일정을 바꾸기 전에 실제 영업시간과 근무 기록을 확인해 볼 만해요.",
        "요일별 실제 영업시간, 휴게시간, 근무표를 확인해 보세요.",
        ("실제 영업시간과 안내된 영업시간 대조하기", "같은 요일·시간대의 근무 기록과 결제 자료 비교하기"),
        "운영을 조정했다면 비슷한 영업일의 결제와 대기 기록을 확인해요.",
    ),
    "LOYALTY": ActionPlan(
        "단골 재방문 기록 점검하기", "재방문 여부를 보려면 매장에서 확인할 수 있는 별도의 기록이 필요해요.",
        "이미 기록 중인 스탬프나 예약 내역에서 재방문을 구분할 수 있는지 확인해 보세요.",
        ("매장에서 사용하는 스탬프나 예약 기록 확인하기", "재방문을 비교할 기간과 기록 방법 정하기"),
        "같은 조건에서 기록으로 확인한 재방문을 비교해요.",
    ),
}

WORKFLOW_PLANS: dict[ConcernType, ActionPlan] = {
    "SALES": ActionPlan(
        "주문 안내 점검하기", "결제 흐름이 달라진 구간의 영업 기록과 주문 안내를 먼저 확인해 볼 만해요.",
        "실제 주문 가능 시간과 매장·지도에 표시된 안내를 대조해 보세요.", (),
        "안내를 바꿨다면 비슷한 영업 조건에서 하루 평균 매출을 비교해요.",
    ),
    "INVENTORY": ActionPlan(
        "발주량 검토하기", "발주량을 검토하려면 현재 재고·예상 사용량·입고 예정량이 필요해요.",
        "현재 재고, 예상 사용량과 입고 예정량을 품목별로 적어 보세요.", (),
        "조정 뒤 남은 재고와 실제 사용량을 같은 단위로 기록해요.",
    ),
    "DISCOUNT": ActionPlan(
        "시간대 한정 혜택 검토하기", "할인안을 검토하려면 적용 시간대와 주문당 비용, 예산이 필요해요.",
        "메뉴별 판매가와 주문당 비용, 할인 예산 한도를 확인해 보세요.", (),
        "혜택을 실행했다면 결제 건수와 할인 적용 후 주문당 남는 금액을 확인해요.",
    ),
}


def complete_concern(request: StrategyRequest, concern: ConcernType) -> Recommendation | None:
    code = WORKFLOWS.get(concern, "CUSTOM")
    candidate = next((item for item in request.strategies if item.code == code), None)
    plan = (CUSTOM_PLANS if code == "CUSTOM" else WORKFLOW_PLANS).get(concern)
    monthly = next((fact for fact in request.evidence if fact.type == "MONTHLY_SALES"), None)
    if not candidate or not plan or not monthly:
        return None

    evidence_ids = [monthly.id]
    steps = plan.steps
    first = plan.first
    follow_up = plan.follow_up
    if concern in {"MARKETING", "SALES", "DISCOUNT"}:
        decline = max((fact for fact in request.evidence if fact.type == "TIME_SERIES" and fact.before > fact.after),
                      key=lambda fact: fact.before - fact.after, default=None)
        if decline:
            evidence_ids.append(decline.id)
            if concern == "MARKETING":
                metric = "결제 건수를" if decline.unit == "COUNT" else "매출액을"
                steps = (steps[0], "감소한 시간대에 맞춰 운영 중인 채널에 사진과 방문 안내 게시하기")
                follow_up = f"게시 전후 같은 요일·시간대의 영업일당 평균 {metric} 비교해요."
    return Recommendation(strategyCode=code, status=candidate.status, title=plan.title if code == "CUSTOM" else None,
                          reason=plan.rationale, evidenceIds=evidence_ids, missingInputs=candidate.missingInputs,
                          nextAction=first, followUp=follow_up, steps=list(steps))


def observed_change(fact: Evidence) -> str:
    direction = "줄었어요" if fact.after < fact.before else "늘었어요" if fact.after > fact.before else "같았어요"
    if fact.type == "MARKET_CARD_SALES":
        return f"같은 지역·업종의 카드 이용액은 {direction}."
    if fact.type == "TIME_SERIES":
        metric = "결제 건수가" if fact.unit == "COUNT" else "매출액이"
        label = fact.label if fact.label and not UNSUPPORTED_MEASUREMENT.search(fact.label) else "해당 시간대"
        return f"{label} 구간의 {metric} {direction}."
    return f"매장 월별 매출이 {direction}."
