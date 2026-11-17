import unittest
from unittest.mock import patch

from strategy_agent.concern_check import ConcernIntent, ConcernRequest, check_concerns, compare_concern


def intent(question, metric, **fields):
    return ConcernIntent.model_validate({
        "question": question, "metric": metric, "period": "LATEST_TWO",
        "dayFilter": None, "beforeMonth": None, "afterMonth": None,
        "startHour": None, "endHour": None, "expectedDirection": None,
        "needsClarification": False, "productName": None, "nextStep": None,
        "ranking": None,
        **fields,
    })


class ConcernCheckTest(unittest.TestCase):
    def setUp(self):
        self.request = ConcernRequest.model_validate({
            "concern": "지난달보다 점심 매출이 줄었어요. 홍보는 어떻게 할까요? 평일 손님 수는 줄었나요? 고기국수 판매량은요?",
            "monthlySales": [{"month": "2021-04", "amount": 1000}, {"month": "2021-05", "amount": 800}],
            "hourlySales": {
                month: [{"amount": value, "count": 1} for _ in range(24)]
                for month, value in [("2021-04", 10), ("2021-05", 12)]
            },
            "productSales": [{"productName": "고기국수", "before": 214, "after": 280}],
        })

    def test_multiple_concerns_keep_individual_evidence_and_answers(self):
        concerns = [
            intent("지난달보다 점심 매출이 줄었어요.", "AMOUNT", period="PREVIOUS_MONTH",
                   startHour=11, endHour=14, expectedDirection="DECREASE"),
            intent("홍보는 어떻게 할까요?", "PROMOTION"),
            intent("평일 손님 수는 줄었나요?", "VISITORS", dayFilter="WEEKDAY"),
            intent("고기국수 판매량은요?", "PRODUCT", productName="고기국수"),
        ]
        with patch("strategy_agent.concern_check.extract_intents", return_value=concerns):
            results = check_concerns(self.request)["results"]

        self.assertEqual([row["question"] for row in results], [row.question for row in concerns])
        self.assertEqual([row["status"] for row in results], ["COMPARED", "GUIDANCE", "MISSING_DATA", "COMPARED"])
        self.assertEqual((results[0]["before"], results[0]["after"], results[0]["changeRate"]), (30, 36, 20))
        self.assertIn("예상과 달리", results[0]["answer"])
        self.assertIn("방문객", results[2]["detail"])
        self.assertEqual((results[3]["productName"], results[3]["before"], results[3]["after"]), ("고기국수", 214, 280))

    def test_missing_hourly_data_only_requests_the_relevant_months(self):
        result = compare_concern(self.request.model_copy(update={"hourlySales": {}}),
                                 intent("점심 매출", "AMOUNT", startHour=11, endHour=14))
        self.assertEqual(result["posMonths"], ["2021-04", "2021-05"])

    def test_rankings_feed_related_order_and_promotion_guidance(self):
        concern = "8월보다 9월 매출이 줄었어요. 어떤 메뉴와 시간대에서 매출이 가장 많이 줄었는지 확인하고, 다음 발주량과 홍보 방법을 정하고 싶어요."
        request = ConcernRequest.model_validate({
            "concern": concern,
            "monthlySales": [{"month": "2026-08", "amount": 1500000}, {"month": "2026-09", "amount": 1330000}],
            "hourlySales": {},
            "productSales": [
                {"productName": "고기국수", "before": 120, "after": 100, "beforeRevenue": 1020000, "afterRevenue": 850000},
                {"productName": "물만두", "before": 40, "after": 10, "beforeRevenue": 240000, "afterRevenue": 180000},
            ],
            "timeEvidence": [
                {"id": key, "kind": "METRIC", "metric": "TIME_SERIES", "label": label, "unit": unit,
                 "before": before, "after": after, "period": {"before": "2026-08", "after": "2026-09"}}
                for key, label, unit, before, after in [
                    ("lunch", "오후 2시 전", "KRW", 700000, 690000),
                    ("afternoon-amount", "오후 2~5시", "KRW", 545000, 375000),
                    ("afternoon-count", "오후 2~5시", "COUNT", 70, 50),
                ]
            ],
        })
        ranking = intent("어떤 메뉴와 시간대에서 매출이 가장 많이 줄었는지", "RANKING", expectedDirection="DECREASE",
                         ranking={"menuUnit": "KRW", "timeUnit": "KRW"})
        concerns = [intent("8월보다 9월 매출이 줄었어요.", "AMOUNT", expectedDirection="DECREASE"), ranking,
                    intent("다음 발주량", "ORDER_PLANNING"), intent("홍보 방법을 정하고 싶어요", "PROMOTION")]
        with patch("strategy_agent.concern_check.extract_intents", return_value=concerns):
            results = check_concerns(request)["results"]
        self.assertEqual([result["status"] for result in results], ["COMPARED", "COMPARED", "GUIDANCE", "GUIDANCE"])
        for text in ("고기국수", "120개에서 100개", "오후 2~5시", "70건에서 50건"):
            self.assertIn(text, results[1]["answer"])
        self.assertIn("고기국수의 예상 판매량", results[2]["answer"])
        self.assertEqual(results[2]["action"], "INVENTORY")
        self.assertIn("오후 2~5시 고기국수 홍보", results[3]["answer"])
        self.assertEqual(results[3]["action"], "PROMOTION")

        single = compare_concern(request, intent("가장 판매량이 많이 줄어든 메뉴", "RANKING", expectedDirection="DECREASE",
                                                ranking={"menuUnit": "QUANTITY", "timeUnit": None}))
        self.assertIn("물만두", single["answer"])
        partial = compare_concern(request.model_copy(update={"timeEvidence": []}), ranking)
        self.assertIn("고기국수", partial["answer"])
        self.assertIn("시간대별 결제 자료", partial["detail"])

    def test_product_revenue_is_not_inferred_from_quantity(self):
        result = compare_concern(self.request, intent("고기국수 매출액", "PRODUCT_REVENUE", productName="고기국수"))
        self.assertEqual(result["status"], "MISSING_DATA")
        self.assertIn("실판매금액", result["detail"])

    def test_product_revenue_uses_reported_amounts(self):
        self.request.concern = "고기국수 매출액은 얼마나 달라졌나요?"
        product = self.request.productSales[0]
        product.beforeRevenue = 1_853_500
        product.afterRevenue = 2_100_000

        result = compare_concern(self.request, intent("고기국수 매출액", "PRODUCT_REVENUE", productName="고기국수"))

        self.assertEqual(result["status"], "COMPARED")
        self.assertEqual((result["before"], result["after"]), (1_853_500, 2_100_000))
        self.assertIn("실판매금액", result["answer"])
