import json
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from strategy_agent import api
from strategy_agent.graph import build_graph
from strategy_agent.schemas import ModelRecommendation, ModelRecommendationDraft, Recommendation, RecommendationDraft

FIXTURES = Path(__file__).parent / "fixtures"
ENDPOINT = "/internal/strategy-recommendations"


def fixture(name):
    return json.loads((FIXTURES / f"aewol-{name}.json").read_text(encoding="utf-8"))


def draft(request):
    has_time = request.availability.timeSeries == "AVAILABLE"
    return RecommendationDraft(recommendations=[
        Recommendation(
            strategyCode=candidate.code,
            status="RECOMMENDED" if candidate.code == "OUTREACH" else candidate.status,
            reason="매장 매출이 줄었어요.",
            evidenceIds=(
                ["e1", "e2", "e3"] if has_time else ["e1", "e3"]
            ) if candidate.code == "OUTREACH" else ["e1"],
            missingInputs=candidate.missingInputs,
            nextAction="자료를 확인해요.",
            followUp="같은 조건에서 비교해요.",
            title=None,
            steps=[],
        )
        for candidate in request.strategies
    ])


class StrategyTests(unittest.TestCase):
    def post(self, payload, generator=draft):
        with patch.object(api, "graph", build_graph(generator)), TestClient(api.app) as client:
            return client.post(ENDPOINT, json=payload)

    def test_aewol_pos_uses_time_series_and_separates_bsi(self):
        request = fixture("pos")
        def time_only_draft(payload):
            result = draft(payload)
            result.recommendations[0].evidenceIds = ["e2"]
            return result

        response = self.post(request, time_only_draft)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["analysisId"], request["analysisId"])
        self.assertEqual(result["inputFingerprint"], request["inputFingerprint"])
        self.assertEqual(result["contextEvidenceIds"], ["e4"])
        first = result["recommendations"][0]
        self.assertEqual((first["strategyCode"], first["status"]), ("OUTREACH", "RECOMMENDED"))
        self.assertCountEqual(first["evidenceIds"], ["e1", "e2", "e3"])
        self.assertIn("결제 건수", first["followUp"])

    def test_aewol_monthly_keeps_external_evidence_and_requires_time_series_for_promotion(self):
        response = self.post(fixture("monthly"))
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["contextEvidenceIds"], ["e4"])
        first, promotion, _ = result["recommendations"]
        self.assertEqual(first["evidenceIds"], ["e1", "e3"])
        self.assertIn("같은 지역·업종의 카드 이용액은 늘었어요", first["reason"])
        self.assertNotIn("방문", first["reason"])
        self.assertIn("하루 평균 매출", first["followUp"])
        self.assertEqual(promotion["status"], "NEEDS_INPUT")
        self.assertIn("TIME_SERIES", promotion["missingInputs"])

    def test_monthly_evidence_missing_skips_model(self):
        request = fixture("monthly")
        request["availability"]["monthlySales"] = "MISSING"
        request["evidence"] = [item for item in request["evidence"] if item["id"] != "e1"]

        def unexpected_call(_):
            self.fail("Model should not run without monthly sales")

        result = self.post(request, unexpected_call).json()
        self.assertEqual(result["status"], "INSUFFICIENT_DATA")
        self.assertEqual(result["requiredInputs"], ["MONTHLY_SALES"])
        self.assertEqual(result["recommendations"], [])

    def test_unavailable_or_context_only_evidence_is_rejected(self):
        for evidence_id in ("e2", "e4"):
            with self.subTest(evidence_id=evidence_id):
                def bad_draft(request):
                    result = draft(request)
                    result.recommendations[0].evidenceIds.append(evidence_id)
                    return result

                result = self.post(fixture("monthly"), bad_draft).json()
                self.assertEqual(result["status"], "FALLBACK_REQUIRED")
                self.assertEqual(result["recommendations"], [])

    def test_required_inputs_cannot_be_skipped(self):
        def bad_draft(request):
            result = draft(request)
            result.recommendations[1].status = "AVAILABLE"
            result.recommendations[1].missingInputs = []
            return result

        result = self.post(fixture("monthly"), bad_draft).json()
        self.assertEqual(result["status"], "FALLBACK_REQUIRED")

    def test_marketing_concern_can_use_custom_strategies_without_unrelated_candidates(self):
        request = fixture("pos")
        request["concern"] = "우리 가게를 어떻게 홍보할지 고민돼요."
        request["strategies"].append({"code": "CUSTOM", "status": "AVAILABLE", "missingInputs": []})

        def marketing_draft(payload):
            return RecommendationDraft(recommendations=[
                Recommendation(strategyCode="CUSTOM", status="RECOMMENDED", title="메뉴 사진으로 방문 안내하기",
                               reason="오후 결제가 줄어든 시간대를 중심으로 방문을 안내해 보세요.",
                               evidenceIds=["e2"], missingInputs=[], nextAction="안내할 메뉴와 사진을 고르세요.",
                               steps=["메뉴 사진 고르기", "방문 안내를 게시하기"], followUp="같은 요일의 오후 결제를 비교해요."),
                Recommendation(strategyCode="CUSTOM", status="AVAILABLE", title="매장 앞에서 메뉴 알리기",
                               reason="월별 매출이 줄어 매장 앞 안내의 반응을 확인할 수 있어요.",
                               evidenceIds=["e1"], missingInputs=[], nextAction="매장 앞에서 보이는 안내를 확인하세요.",
                               steps=["대표 메뉴 정하기", "매장 앞 안내에 메뉴 추가하기"], followUp="같은 조건의 하루 평균 매출을 비교해요."),
                *draft(payload).recommendations[1:3],
            ])

        result = self.post(request, marketing_draft).json()
        self.assertEqual(result["status"], "OK")
        self.assertEqual([item["strategyCode"] for item in result["recommendations"]], ["CUSTOM", "CUSTOM"])
        self.assertEqual(result["recommendations"][0]["steps"][1], "방문 안내를 게시하기")

    def test_model_timeout_returns_rule_fallback_status(self):
        def timed_out(_):
            raise TimeoutError

        result = self.post(fixture("pos"), timed_out).json()
        self.assertEqual(result["status"], "FALLBACK_REQUIRED")
        self.assertEqual(result["recommendations"], [])

    def test_explicit_concerns_are_covered_in_input_order_even_if_model_omits_them(self):
        request = fixture("pos")
        request["concern"] = "발주량도 걱정이고 매출이 줄었어요. 가게를 알리고 싶고 할인은 하지 않을래요."
        request["strategies"].append({"code": "CUSTOM", "status": "AVAILABLE", "missingInputs": []})

        def incomplete_draft(payload):
            return RecommendationDraft(recommendations=[
                draft(payload).recommendations[0],
                Recommendation(strategyCode="CUSTOM", status="AVAILABLE", title="홍보와 발주 전반 점검",
                               reason="여러 고민을 함께 검토해요.", evidenceIds=["e1"], missingInputs=[],
                               nextAction="우선 확인할 항목을 골라요.", followUp="확인한 내용을 기록해요.",
                               steps=["홍보할 메뉴 고르기", "발주량 확인하기"]),
            ])

        result = self.post(request, incomplete_draft).json()
        self.assertEqual(result["status"], "OK")
        self.assertEqual([card["strategyCode"] for card in result["recommendations"]], ["INVENTORY", "OUTREACH", "CUSTOM"])
        self.assertIn("홍보", result["recommendations"][2]["title"])
        self.assertNotIn("발주", result["recommendations"][2]["title"])
        self.assertEqual(result["recommendations"][2]["evidenceIds"], ["e1", "e2"])

    def test_market_spending_only_describes_money_and_unsafe_actions_are_replaced(self):
        request = fixture("pos")
        request["concern"] = "홍보 방법이 고민돼요."
        request["strategies"].append({"code": "CUSTOM", "status": "AVAILABLE", "missingInputs": []})

        def unsupported_inference(_):
            return ModelRecommendationDraft(recommendations=[
                ModelRecommendation(concernType="MARKETING", strategyCode="CUSTOM", status="RECOMMENDED",
                                    title="가게 홍보하기", reason="상권 카드 이용액이 늘어 방문객도 늘었어요.",
                                    evidenceIds=["e3"], missingInputs=[], nextAction="사진과 소식을 준비해요.",
                                    steps=["사진 고르기", "방문객이 늘어난 상권을 타깃으로 게시하기"],
                                    followUp="같은 요일의 결제 건수를 비교해요."),
                ModelRecommendation(concernType="MARKETING", strategyCode="CUSTOM", status="AVAILABLE",
                                    title="SNS로 가게 알리기", reason="상권 카드 이용액 증가가 고객 수 증가를 뜻해요.",
                                    evidenceIds=["e3"], missingInputs=[], nextAction="게시할 소식을 정해요.",
                                    steps=["사진 고르기", "채널에 소식을 올리기"], followUp="게시 반응을 기록해요."),
            ])

        result = self.post(request, unsupported_inference).json()
        self.assertEqual(result["status"], "OK")
        self.assertEqual(len(result["recommendations"]), 1)
        card = result["recommendations"][0]
        self.assertIn("카드 이용액은 늘었어요", card["reason"])
        self.assertNotIn("방문객", json.dumps(card, ensure_ascii=False))
        self.assertNotIn("고객 수", card["reason"])
        self.assertEqual(card["title"], "SNS로 가게 알리기")

    def test_reviews_costs_and_visitor_concerns_get_distinct_plans(self):
        request = fixture("pos")
        request["concern"] = "리뷰가 신경 쓰이고 원가가 부담이에요. 손님 수가 실제로 줄었는지도 궁금해요."
        request["strategies"].append({"code": "CUSTOM", "status": "AVAILABLE", "missingInputs": []})
        result = self.post(request, lambda _: RecommendationDraft(recommendations=[])).json()
        self.assertEqual(result["status"], "OK")
        cards = result["recommendations"]
        self.assertEqual(len(cards), 3)
        self.assertIn("리뷰", cards[0]["title"])
        self.assertIn("원가", cards[1]["title"])
        self.assertIn("별도 집계", cards[2]["reason"])
        self.assertIn("직접 집계", cards[2]["followUp"])
