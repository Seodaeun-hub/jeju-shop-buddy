import unittest
from unittest.mock import patch

from strategy_agent.concern_check import ConcernIntent, ConcernRequest, check_concerns, compare_concern


def intent(question, metric, **fields):
    return ConcernIntent.model_validate({
        "question": question, "metric": metric, "period": "LATEST_TWO",
        "dayFilter": None, "beforeMonth": None, "afterMonth": None,
        "startHour": None, "endHour": None, "expectedDirection": None,
        "needsClarification": False, "productName": None, "nextStep": None,
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
