import logging
from collections.abc import Callable, Sequence
from typing import NotRequired, TypedDict

from langchain_core.exceptions import OutputParserException
from langgraph.graph import END, START, StateGraph
from openai import OpenAIError

from .model import generate_draft
from .schemas import Recommendation, RecommendationDraft, ResultStatus, StrategyRequest, StrategyResponse

logger = logging.getLogger(__name__)

ALLOWED_EVIDENCE = {
    "OUTREACH": {"MONTHLY_SALES", "TIME_SERIES", "MARKET_CARD_SALES"},
    "PROMOTION": {"MONTHLY_SALES", "TIME_SERIES"},
    "INVENTORY": {"MONTHLY_SALES"},
}


class StrategyState(TypedDict):
    request: StrategyRequest
    draft: NotRequired[RecommendationDraft]
    result: NotRequired[StrategyResponse]


def response(
    request: StrategyRequest, status: ResultStatus, recommendations: Sequence[Recommendation] = ()
) -> StrategyResponse:
    return StrategyResponse(
        schemaVersion=request.schemaVersion,
        analysisId=request.analysisId,
        inputFingerprint=request.inputFingerprint,
        status=status,
        contextEvidenceIds=[item.id for item in request.evidence if item.type == "JEJU_BSI"],
        requiredInputs=["MONTHLY_SALES"] if status == "INSUFFICIENT_DATA" else [],
        recommendations=list(recommendations),
    )


def check_input(state: StrategyState):
    request = state["request"]
    if request.availability.monthlySales == "MISSING":
        return {"result": response(request, "INSUFFICIENT_DATA")}
    return {}


def validate_recommendations(state: StrategyState):
    request = state["request"]
    cards = state["draft"].recommendations.copy()
    candidates = {item.code: item for item in request.strategies}
    evidence = {item.id: item.type for item in request.evidence}

    def reject(code: str):
        logger.warning("Strategy draft rejected: %s", code)
        return {"result": response(request, "FALLBACK_REQUIRED")}

    if len(cards) != len(candidates) or {card.strategyCode for card in cards} != candidates.keys():
        return reject("candidate_set")

    needs_input_seen = False
    for index, card in enumerate(cards):
        candidate = candidates[card.strategyCode]
        if card.status != candidate.status and not (
            index == 0 and candidate.status == "AVAILABLE" and card.status == "RECOMMENDED"
        ):
            return reject("status_transition")
        if needs_input_seen and card.status != "NEEDS_INPUT":
            return reject("candidate_order")
        needs_input_seen = card.status == "NEEDS_INPUT"
        if card.missingInputs != candidate.missingInputs:
            return reject("missing_inputs")
        if (
            not card.evidenceIds
            or len(card.evidenceIds) != len(set(card.evidenceIds))
            or any(evidence.get(item) not in ALLOWED_EVIDENCE[card.strategyCode] for item in card.evidenceIds)
        ):
            return reject("evidence_reference")
        if not all(text.strip() for text in (card.reason, card.nextAction, card.followUp)):
            return reject("empty_text")

    facts = {item.id: item for item in request.evidence}
    monthly = next((item for item in facts.values() if item.type == "MONTHLY_SALES"), None)
    market = next((item for item in facts.values() if item.type == "MARKET_CARD_SALES"), None)
    diverged = monthly and market and monthly.after < monthly.before and market.after > market.before
    for index, card in enumerate(cards):
        if card.strategyCode != "OUTREACH":
            continue
        ids = card.evidenceIds.copy()
        reason = card.reason
        if diverged:
            ids = list(dict.fromkeys([monthly.id, market.id, *ids]))
            reason = "매장 매출은 줄었고 같은 지역·업종의 카드 이용액은 늘었어요."
            declines = [item for item in facts.values() if item.type == "TIME_SERIES" and item.after < item.before]
            if declines:
                slot = max(declines, key=lambda item: item.before - item.after)
                if slot.id not in ids:
                    ids.append(slot.id)
                metric = "결제 건수가" if slot.unit == "COUNT" else "매출액이"
                reason += f" {slot.label} 구간의 {metric} 줄어서 해당 시간대의 주문 안내부터 확인해 볼 만해요."
            else:
                reason += " 매장과 지도에 표시된 주문 가능 시간이 실제 운영과 일치하는지 확인해 볼 만해요."

        units = {facts[item].unit for item in ids if facts[item].type == "TIME_SERIES"}
        follow_up = "안내를 바꿨다면 비슷한 영업 조건에서 하루 평균 매출을 비교해요."
        if "COUNT" in units:
            follow_up = "안내를 바꿨다면 같은 요일·시간대의 영업일당 평균 결제 건수를 비교해요."
        elif "KRW" in units:
            follow_up = "안내를 바꿨다면 같은 요일·시간대의 영업일당 평균 매출액을 비교해요."
        cards[index] = card.model_copy(update={"evidenceIds": ids, "reason": reason, "followUp": follow_up})

    return {"result": response(request, "OK", cards)}


def build_graph(draft_generator: Callable[[StrategyRequest], RecommendationDraft] = generate_draft):
    def draft_recommendations(state: StrategyState):
        request = state["request"]
        try:
            draft = RecommendationDraft.model_validate(draft_generator(request))
        except (OpenAIError, OutputParserException, ValueError, TimeoutError) as error:
            logger.warning("Strategy generation failed: %s", type(error).__name__)
            return {"result": response(request, "FALLBACK_REQUIRED")}
        return {"draft": draft}

    graph = StateGraph(StrategyState)
    graph.add_node("check_input", check_input)
    graph.add_node("draft_recommendations", draft_recommendations)
    graph.add_node("validate_recommendations", validate_recommendations)
    graph.add_edge(START, "check_input")
    graph.add_conditional_edges(
        "check_input",
        lambda state: "stop" if "result" in state else "draft",
        {"stop": END, "draft": "draft_recommendations"},
    )
    graph.add_conditional_edges(
        "draft_recommendations",
        lambda state: "stop" if "result" in state else "validate",
        {"stop": END, "validate": "validate_recommendations"},
    )
    graph.add_edge("validate_recommendations", END)
    return graph.compile()
