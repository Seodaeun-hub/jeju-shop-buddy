import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from strategy_agent import api
from strategy_agent.execution_guide import GuideSelection, build_guide_graph, load_catalog

ENDPOINT = "/internal/execution-guide"
PLACE = "NAVER_PLACE_HOURS"
ORDER = "NAVER_ORDER_HOURS"


class ExecutionGuideTests(unittest.TestCase):
    def post(self, selector, *, focus=None, channel="NAVER", uses_order="UNKNOWN"):
        graph = build_guide_graph(load_catalog(), selector)
        with patch.object(api, "guide_graph", graph), TestClient(api.app) as client:
            response = client.post(ENDPOINT, json={
                "schemaVersion": "1.0",
                "strategyCode": "OUTREACH",
                "industryCode": "KOREAN_RESTAURANT",
                "channel": channel,
                "focus": focus,
                "naverReservationOrOrder": uses_order,
            })
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_pos_focus_has_official_sources_and_conditional_order_step(self):
        def select(_, matches):
            self.assertEqual({match["source"].id for match in matches}, {PLACE, ORDER})
            return GuideSelection(orderedChunkIds=[f"{PLACE}#edit", f"{ORDER}#schedule"])

        result = self.post(select, focus={"label": "오후 2~5시", "metric": "COUNT"})
        self.assertEqual(result["status"], "OK")
        store, place, order = result["steps"]
        self.assertEqual(store["kind"], "STORE_CHECK")
        self.assertIn("오후 2~5시", store["text"])
        self.assertEqual(store["sourceIds"], [])
        self.assertEqual(place["sourceIds"], [PLACE])
        self.assertEqual(order["sourceIds"], [ORDER])
        self.assertEqual(order["when"], "네이버 예약·주문을 이용한다면")
        self.assertEqual([source["id"] for source in result["sources"]], [PLACE, ORDER])
        self.assertTrue(all(source["url"].startswith("https://help.naver.com/") for source in result["sources"]))

    def test_monthly_focus_has_no_specific_time(self):
        result = self.post(lambda *_: GuideSelection(orderedChunkIds=[f"{PLACE}#edit"]))
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["steps"][0]["text"], "매장에서 실제로 식사 주문을 받는 시간, 휴게시간과 주문 마감을 확인해요.")
        self.assertEqual([source["id"] for source in result["sources"]], [PLACE])

    def test_missing_channel_guide_skips_the_model(self):
        def unexpected(*_):
            self.fail("A model call should require matching documents")

        result = self.post(unexpected, channel="IN_STORE", focus={"label": "오후 2~5시", "metric": "COUNT"})
        self.assertEqual(result["status"], "NO_RELEVANT_GUIDE")
        self.assertEqual(result["sources"], [])
        self.assertEqual([step["kind"] for step in result["steps"]], ["STORE_CHECK"])
        self.assertIn("매장 입구", result["steps"][0]["text"])

    def test_disabled_reservations_are_excluded_even_on_fallback(self):
        def select(_, matches):
            self.assertEqual([match["source"].id for match in matches], [PLACE])
            return GuideSelection(orderedChunkIds=[f"{ORDER}#schedule"])

        result = self.post(select, uses_order="NO")
        self.assertEqual(result["status"], "CURATED_FALLBACK")
        self.assertEqual([source["id"] for source in result["sources"]], [PLACE])

    def test_timeout_returns_reviewed_sources(self):
        def timeout(*_):
            raise TimeoutError

        result = self.post(timeout)
        self.assertEqual(result["status"], "CURATED_FALLBACK")
        self.assertEqual([source["id"] for source in result["sources"]], [PLACE, ORDER])
