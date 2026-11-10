from typing import Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from .model import structured_model
from .schemas import Contract


class PeriodTotals(Contract):
    quantity: int
    amount: int
    recordedDays: int


class Advice(Contract):
    action: Literal["RETEST", "REVIEW_TERMS", "CHECK_DATA"]
    beforeAveragePrice: float | None
    afterAveragePrice: float | None


class NextPromotionRequest(Contract):
    before: PeriodTotals
    after: PeriodTotals
    advice: Advice


class NextPromotionExplanation(Contract):
    explanation: str


class ExplanationState(TypedDict):
    request: NextPromotionRequest
    result: NextPromotionExplanation


class ExplanationFocus(Contract):
    lead: Literal["SALES_VOLUME", "SALES_AMOUNT", "AVERAGE_PRICE"]


PROMPT = """소상공인에게 다음 행사 제안의 근거를 설명할 때 먼저 보여줄 POS 지표를 고르세요.
SALES_VOLUME은 판매량, SALES_AMOUNT는 실판매금액, AVERAGE_PRICE는 개당 평균 실판매금액입니다.
입력의 행사 전후 수치와 서버가 정한 제안 유형을 보고 가장 먼저 읽을 만한 지표 하나를 lead에 반환하세요.
지표의 변화와 확인할 수 없는 내용은 서버가 직접 설명합니다.
"""


def change_sentence(label: str, before: int | float | None, after: int | float | None) -> str:
    if before is None or after is None:
        return f"{label} 비교할 수 없어요."
    if after == before:
        return f"{label} 같았어요."
    return f"{label} {'늘었어요' if after > before else '줄었어요'}."


def next_step(request: NextPromotionRequest) -> str:
    if request.advice.action == "RETEST":
        return "같은 할인 조건으로 한 번 더 시험하면서 실제 할인 적용 수량과 원가를 기록해 보세요."
    if request.advice.action == "REVIEW_TERMS":
        return "실제 할인 적용 수량과 원가를 확인한 뒤 할인 조건을 검토해 보세요."

    gaps = []
    if request.before.recordedDays != request.after.recordedDays:
        gaps.append("주문이 기록된 날짜 수가 달라요.")
    if request.before.quantity == 0:
        gaps.append("행사 전 판매 기록이 없어요.")
    return " ".join([*gaps, "두 POS 파일의 기간과 영업일을 먼저 확인해 보세요."])


def build_next_promotion_graph():
    def explain(state: ExplanationState):
        request = state["request"]
        draft = structured_model(ExplanationFocus).invoke([
            SystemMessage(content=PROMPT),
            HumanMessage(content=request.model_dump_json()),
        ])
        focus = ExplanationFocus.model_validate(draft)
        metrics = {
            "SALES_VOLUME": change_sentence("판매량은", request.before.quantity, request.after.quantity),
            "SALES_AMOUNT": change_sentence("실판매금액은", request.before.amount, request.after.amount),
            "AVERAGE_PRICE": change_sentence(
                "개당 평균 실판매금액은", request.advice.beforeAveragePrice, request.advice.afterAveragePrice,
            ),
        }
        lead = metrics.pop(focus.lead)
        explanation = " ".join([
            lead, *metrics.values(),
            "이 POS 집계만으로는 실제 할인 적용 여부나 실제 이익을 판단할 수 없어요.",
            next_step(request),
        ])
        return {"result": NextPromotionExplanation(explanation=explanation)}

    graph = StateGraph(ExplanationState)
    graph.add_node("explain_saved_advice", explain)
    graph.add_edge(START, "explain_saved_advice")
    graph.add_edge("explain_saved_advice", END)
    return graph.compile()
