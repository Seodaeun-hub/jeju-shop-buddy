import json
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from strategy_agent import api
from strategy_agent.graph import build_graph
from strategy_agent.schemas import Recommendation, RecommendationDraft

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

    def test_model_timeout_returns_rule_fallback_status(self):
        def timed_out(_):
            raise TimeoutError

        result = self.post(fixture("pos"), timed_out).json()
        self.assertEqual(result["status"], "FALLBACK_REQUIRED")
        self.assertEqual(result["recommendations"], [])
