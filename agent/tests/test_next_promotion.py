import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from strategy_agent import api
from strategy_agent.next_promotion import ExplanationFocus

ENDPOINT = "/internal/next-promotion-explanation"
AEWOL_POS = {
    "before": {"quantity": 214, "amount": 1853500, "recordedDays": 12},
    "after": {"quantity": 280, "amount": 2100000, "recordedDays": 12},
    "advice": {"action": "RETEST", "beforeAveragePrice": 8661.21, "afterAveragePrice": 7500},
}


class NextPromotionTests(unittest.TestCase):
    def test_aewol_explains_all_metrics_and_limits_for_every_model_focus(self):
        with TestClient(api.app) as client, patch("strategy_agent.next_promotion.structured_model") as model:
            for lead, first in (
                ("SALES_VOLUME", "판매량은 늘었어요."),
                ("SALES_AMOUNT", "실판매금액은 늘었어요."),
                ("AVERAGE_PRICE", "개당 평균 실판매금액은 줄었어요."),
            ):
                with self.subTest(lead=lead):
                    model.return_value.invoke.return_value = ExplanationFocus(lead=lead)
                    response = client.post(ENDPOINT, json=AEWOL_POS)
                    self.assertEqual(response.status_code, 200)
                    explanation = response.json()["explanation"]
                    self.assertTrue(explanation.startswith(first))
                    for expected in (
                        "판매량은 늘었어요.",
                        "실판매금액은 늘었어요.",
                        "개당 평균 실판매금액은 줄었어요.",
                        "실제 할인 적용 여부나 실제 이익을 판단할 수 없어요.",
                    ):
                        self.assertIn(expected, explanation)

    def test_unsupported_discount_claim_from_model_is_rejected(self):
        with TestClient(api.app) as client, patch("strategy_agent.next_promotion.structured_model") as model:
            model.return_value.invoke.return_value = {
                "lead": "AVERAGE_PRICE",
                "explanation": "평균 가격이 내려가 할인이 적용되었음을 알 수 있어요.",
            }
            response = client.post(ENDPOINT, json=AEWOL_POS)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["detail"]["code"], "NEXT_PROMOTION_EXPLANATION_UNAVAILABLE")
