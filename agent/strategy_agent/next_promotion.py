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


PROMPT = """소상공인에게 서버가 이미 정한 다음 행사 제안의 이유를 한국어 두세 문장으로 설명하세요.
입력의 행사 전후 판매량, 실판매금액, 개당 평균 실판매금액을 비교해 증가·감소·동일을 정확히 설명하세요.
개당 평균 실판매금액이 비어 있으면 비교할 수 없다고 하세요. 숫자와 기호는 화면에 따로 표시하므로 쓰지 마세요.
RETEST는 현재 할인 조건으로 한 번 더 시험하는 제안입니다. 판매량과 실판매금액이 늘어난 점,
개당 평균 실판매금액이 어떻게 달라졌는지, 실제 할인 적용 수량과 원가가 없어 실제 이익을 판단할 수 없다는 점을 연결하세요.
REVIEW_TERMS는 할인 조건을 검토하는 제안입니다. 실제 할인 적용 수량과 원가 확인부터 제안하세요.
CHECK_DATA는 비교 자료를 확인하는 제안입니다. 주문 기록일 수 차이 또는 행사 전 판매량이 없는 이유 중 입력에 맞는 것만 말하세요.
매출 증감의 원인을 단정하거나 이익, 효과, 향후 매출을 보장하지 마세요. 할인율이나 새 가격을 제시하지 마세요.
출력은 explanation 필드에 넣고 제목, 표, 목록, 링크를 쓰지 마세요.
"""


def build_next_promotion_graph():
    def explain(state: ExplanationState):
        request = state["request"]
        draft = structured_model(NextPromotionExplanation).invoke([
            SystemMessage(content=PROMPT),
            HumanMessage(content=request.model_dump_json()),
        ])
        explanation = NextPromotionExplanation.model_validate(draft).explanation.strip()
        metrics = ("판매량", "실판매금액", "개당 평균")
        if (not explanation or len(explanation) > 360 or not explanation.isprintable()
                or any(char.isnumeric() for char in explanation)
                or (request.advice.action == "RETEST"
                    and not all(term in explanation for term in (*metrics, "할인 적용 수량", "원가")))):
            raise ValueError("invalid next promotion explanation")
        return {"result": NextPromotionExplanation(explanation=explanation)}

    graph = StateGraph(ExplanationState)
    graph.add_node("explain_saved_advice", explain)
    graph.add_edge(START, "explain_saved_advice")
    graph.add_edge("explain_saved_advice", END)
    return graph.compile()
