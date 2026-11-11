import logging
from collections.abc import Callable, Sequence
from typing import NotRequired, TypedDict

from langchain_core.exceptions import OutputParserException
from langgraph.graph import END, START, StateGraph
from openai import OpenAIError

from .model import generate_draft
from .schemas import Candidate, ConcernType, Evidence, ModelRecommendationDraft, Recommendation, RecommendationDraft
from .schemas import ResultStatus, StrategyRecommendation, StrategyRequest, StrategyResponse
from .strategy_concerns import CUSTOM_PLANS, UNSUPPORTED_MEASUREMENT, WORKFLOWS, WORKFLOW_PLANS
from .strategy_concerns import complete_concern, explicit_concerns, observed_change, strategy_concern

logger = logging.getLogger(__name__)

ALLOWED_EVIDENCE = {
    "OUTREACH": {"MONTHLY_SALES", "TIME_SERIES", "MARKET_CARD_SALES"},
    "PROMOTION": {"MONTHLY_SALES", "TIME_SERIES"},
    "INVENTORY": {"MONTHLY_SALES"},
    "CUSTOM": {"MONTHLY_SALES", "TIME_SERIES", "MARKET_CARD_SALES"},
}


class StrategyState(TypedDict):
    request: StrategyRequest
    draft: NotRequired[RecommendationDraft | ModelRecommendationDraft]
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
        recommendations=[
            StrategyRecommendation(
                **card.model_dump(exclude={"concernType"}),
                marketing=card.strategyCode == "CUSTOM" and strategy_concern(card) == "MARKETING",
            )
            for card in recommendations
        ],
    )


def check_input(state: StrategyState):
    request = state["request"]
    if request.availability.monthlySales == "MISSING":
        return {"result": response(request, "INSUFFICIENT_DATA")}
    return {}


def card_error(card: Recommendation, candidate: Candidate | None, facts: dict[str, Evidence],
               allow_recommended: bool) -> str | None:
    if candidate is None:
        return "unknown_workflow"
    if card.status != candidate.status and not (
        allow_recommended and candidate.status == "AVAILABLE" and card.status == "RECOMMENDED"
    ):
        return "status_transition"
    if card.missingInputs != candidate.missingInputs:
        return "missing_inputs"
    if (not card.evidenceIds or len(card.evidenceIds) != len(set(card.evidenceIds))
        or any(key not in facts or facts[key].type not in ALLOWED_EVIDENCE[card.strategyCode] for key in card.evidenceIds)):
        return "evidence_reference"
    if not all(text.strip() for text in (card.reason, card.nextAction, card.followUp)):
        return "empty_text"
    if card.strategyCode == "CUSTOM":
        title = (card.title or "").strip()
        if not title or len(title) > 80 or not 2 <= len(card.steps) <= 4:
            return "custom_plan"
        if len(set(card.steps)) != len(card.steps) or any(not step.strip() or len(step) > 150 for step in card.steps):
            return "custom_steps"
    return None


def cover_concerns(request: StrategyRequest, cards: list[Recommendation],
                   concerns: list[ConcernType]) -> list[Recommendation]:
    requested = set(concerns)
    remaining = [card for card in cards if len(requested.intersection(explicit_concerns(card.title or ""))) <= 1]
    covered = []
    for concern in concerns:
        code = WORKFLOWS.get(concern, "CUSTOM")
        card = next((item for item in remaining
                     if item.strategyCode == code and strategy_concern(item) == concern), None)
        if card:
            remaining.remove(card)
        else:
            card = complete_concern(request, concern)
            if card is None:
                continue
        covered.append(card)
    covered_titles = {card.title.strip() for card in covered if card.title}
    covered.extend(card for card in remaining if card.strategyCode == "CUSTOM" and card.title.strip() not in covered_titles and (
        strategy_concern(card) == "OTHER" or (len(concerns) == 1 and strategy_concern(card) == concerns[0])
    ))
    candidates = {item.code: item for item in request.strategies}
    return [card.model_copy(update={"status": (
        "RECOMMENDED" if index == 0 and candidates[card.strategyCode].status == "AVAILABLE"
        else candidates[card.strategyCode].status
    )}) for index, card in enumerate(covered[:12])]


def ground_card(card: Recommendation, facts: dict[str, Evidence]) -> Recommendation:
    ids = card.evidenceIds.copy()
    plan = (WORKFLOW_PLANS | CUSTOM_PLANS).get(strategy_concern(card))
    guidance = plan.rationale if plan else "이 자료를 바탕으로 제안한 실행 방법을 시험해 볼 만해요."
    follow_up = card.followUp
    if card.strategyCode == "OUTREACH":
        monthly = next((fact for fact in facts.values() if fact.type == "MONTHLY_SALES"), None)
        market = next((fact for fact in facts.values() if fact.type == "MARKET_CARD_SALES"), None)
        if monthly and market and monthly.after < monthly.before and market.after > market.before:
            ids = list(dict.fromkeys([monthly.id, market.id, *ids]))
            decline = max((fact for fact in facts.values() if fact.type == "TIME_SERIES" and fact.after < fact.before),
                          key=lambda fact: fact.before - fact.after, default=None)
            if decline and decline.id not in ids:
                ids.append(decline.id)
        units = {facts[key].unit for key in ids if facts[key].type == "TIME_SERIES"}
        follow_up = "안내를 바꿨다면 비슷한 영업 조건에서 하루 평균 매출을 비교해요."
        if "COUNT" in units:
            follow_up = "안내를 바꿨다면 같은 요일·시간대의 영업일당 평균 결제 건수를 비교해요."
        elif "KRW" in units:
            follow_up = "안내를 바꿨다면 같은 요일·시간대의 영업일당 평균 매출액을 비교해요."
    reason = " ".join([*(observed_change(facts[key]) for key in ids), guidance])
    return card.model_copy(update={"reason": reason, "evidenceIds": ids, "followUp": follow_up})


def validate_recommendations(state: StrategyState):
    request = state["request"]
    candidates = {item.code: item for item in request.strategies}
    facts = {item.id: item for item in request.evidence}
    concerns = explicit_concerns(request.concern) if "CUSTOM" in candidates else []

    def reject(code: str):
        logger.warning("Strategy draft rejected: %s", code)
        return {"result": response(request, "FALLBACK_REQUIRED")}

    proposed = state["draft"].recommendations
    if not concerns and not 1 <= len(proposed) <= 12:
        return reject("candidate_set")

    cards = []
    custom_titles = set()
    used_workflows = set()
    for index, card in enumerate(proposed):
        error = card_error(card, candidates.get(card.strategyCode), facts, bool(concerns) or index == 0)
        if error:
            if not concerns:
                return reject(error)
            continue
        if any(UNSUPPORTED_MEASUREMENT.search(text) for text in (card.title or "", card.nextAction, card.followUp, *card.steps)):
            if concerns:
                continue
            replacement = complete_concern(request, strategy_concern(card))
            if replacement is None:
                continue
            card = replacement
        if card.strategyCode == "CUSTOM":
            title = card.title.strip()
            if title in custom_titles:
                continue
            custom_titles.add(title)
        else:
            if card.strategyCode in used_workflows:
                if not concerns:
                    return reject("candidate_set")
                continue
            used_workflows.add(card.strategyCode)
            card = card.model_copy(update={"title": None, "steps": []})
        cards.append(card)

    if concerns:
        cards = cover_concerns(request, cards, concerns)
    if not cards:
        return reject("candidate_set")
    return {"result": response(request, "OK", [ground_card(card, facts) for card in cards])}


def build_graph(draft_generator: Callable[[StrategyRequest], RecommendationDraft | ModelRecommendationDraft] = generate_draft):
    def draft_recommendations(state: StrategyState):
        request = state["request"]
        try:
            generated = draft_generator(request)
            draft = generated if isinstance(generated, ModelRecommendationDraft) else RecommendationDraft.model_validate(generated)
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
