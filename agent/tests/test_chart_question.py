import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from strategy_agent import api
from strategy_agent.chart_question import build_question_graph
from strategy_agent.chart_question_schemas import QuestionIntent

AGENT = Path(__file__).resolve().parents[1]
PERIOD = {"before": "2021-04", "after": "2021-05"}
QUESTIONS = [
    ("우리 가게 매출이 얼마나 줄었고 주변도 비슷했나요?", ["SALES", "MARKET"], {}),
    ("제주 경기는 어땠고, 우리 가게는 언제 많이 줄었어요?", ["BSI", "TIME_SLOT"], {}),
    ("그럼 그 시간대에 뭘 먼저 확인해요?", ["TIME_SLOT", "STRATEGY", "GUIDE"], {}),
    ("그때 리뷰에도 오후 주문 안내 불편이 있었나요?", ["REVIEWS"], {"reviewTopic": "AFTERNOON_ORDER"}),
    ("그 계획을 실행한 뒤 좋아졌나요?", ["PLAN", "RESULT"], {}),
]


def fixture(mode="pos"):
    sales = json.loads((AGENT / "tests/fixtures" / f"aewol-{mode}.json").read_text(encoding="utf-8"))
    catalog = json.loads((AGENT / "strategy_agent/execution_guide_catalog.json").read_text(encoding="utf-8"))
    labels = {"DEMO_POS": "애월 가상 한식당 POS", "MANUAL_MONTHLY": "사업주 월별 직접 입력",
              "JEJU_DATAHUB": "제주데이터허브", "SEMAS_BSI": "소상공인시장진흥공단"}
    urls = {"JEJU_DATAHUB": "https://data.edmgr.kr/dataView.do?id=jejudatahub-net-748",
            "SEMAS_BSI": "https://www.data.go.kr/data/3060077/fileData.do"}
    metrics = []
    for row in sales["evidence"]:
        fact = {key: value for key, value in row.items() if key not in {"source", "type"}}
        fact.update(kind="METRIC", metric=row["type"], chart=row["type"], period=PERIOD,
                    source={"label": labels.get(row["source"], row["source"]), "url": urls.get(row["source"])})
        metrics.append(fact)
    guides = [
        {"id": f"g{index}", "kind": "GUIDE", "label": doc["title"], "action": doc["chunks"][0]["action"],
         "when": "네이버 예약·주문을 이용하는 경우" if index == 2 else None,
         "source": {"label": doc["publisher"], "url": doc["url"]}}
        for index, doc in enumerate(catalog["documents"], start=1)
    ]
    reviews = [
        {"id": key, "kind": "REVIEW", "date": day, "topic": topic, "excerpt": excerpt,
         "source": {"label": "매장 등록 가상 리뷰"}}
        for key, day, topic, excerpt in [
            ("r1", "2021-05-12", "AFTERNOON_ORDER", "오후에 식사 주문을 받는지 헷갈렸어요."),
            ("r2", "2021-05-19", "AFTERNOON_ORDER", "쉬는 시간인지 주문 가능한 시간인지 구분하기 어려웠어요."),
            ("r3", "2021-06-02", "AFTERNOON_ORDER", "오후 주문 시간이 헷갈렸어요."),
            ("r4", "2021-05-20", "PARKING", "주차장 입구를 찾기 어려웠어요."),
            ("r5", "2021-05-21", "WAIT_TIME", "예상보다 기다리는 시간이 길었어요."),
        ]
    ]
    plan = {"id": "p1", "kind": "PLAN", "planId": "plan-1", "label": "주문 안내 점검하기",
            "strategyCode": "OUTREACH", "completed": 1, "total": 4, "source": {"label": "저장된 실행 계획"}}
    result = {
        "id": "x1", "kind": "RESULT", "planId": "plan-1", "scope": "같은 요일 오후 2~5시",
        "before": {"start": "2026-11-03", "end": "2026-11-09", "businessDays": 5},
        "after": {"start": "2026-11-10", "end": "2026-11-16", "businessDays": 5},
        "dailyAverageSales": {"before": 100000, "after": 150000, "unit": "KRW", "changePercent": 50.0},
        "dailyAveragePayments": {"before": 6, "after": 8, "unit": "COUNT", "changePercent": 33.33},
        "source": {"label": "저장된 실행 결과 · 시연용 가상 입력"},
    }
    strategy = {"id": "s1", "kind": "STRATEGY", "code": "OUTREACH", "label": plan["label"],
                "reason": "감소한 구간에 실제 주문 가능 시간과 공개 안내를 대조해 보세요.",
                "evidenceIds": ["e1", "e2", "e3"] if mode == "pos" else ["e1", "e3"],
                "source": {"label": "저장된 추천 전략"}}
    return {
        "schemaVersion": "1.0", "chart": "MONTHLY_SALES",
        "context": {"comparisonPeriod": list(PERIOD.values())},
        "availableEvidence": [*metrics, strategy, *guides, *reviews, plan, result],
        "allowedActions": [
            {"type": kind, "targetId": target}
            for kind, target in [
                ("OPEN_STRATEGY", "OUTREACH"), ("OPEN_EXECUTION_GUIDE", "OUTREACH"),
                ("OPEN_REVIEWS", "AFTERNOON_ORDER"), ("OPEN_REVIEWS", "PARKING"),
                ("OPEN_PLAN_RESULTS", "plan-1"), ("ADD_TIME_SERIES", "AMOUNT"), ("SELECT_PLAN", "plan-1"),
            ]
        ],
    }


def classified(intents, **kwargs):
    return QuestionIntent.model_validate({
        "intents": intents, "timeMetric": None, "reviewTopic": None, "strategyCode": None,
        "focusEvidenceId": None, "reviewPeriod": None, "largestTimeDrop": False, "resultMetric": None,
        **kwargs,
    })


class ChartQuestionTest(unittest.TestCase):
    def ask(self, payload, question, intent=None):
        graph = build_question_graph(lambda _: intent) if intent else api.question_graph
        with patch.object(api, "question_graph", graph):
            response = TestClient(api.app).post("/internal/chart-questions", json={**payload, "question": question})
        self.assertEqual(response.status_code, 200, response.text)
        answer = response.json()
        originals = {fact["id"]: fact for fact in payload["availableEvidence"]}
        returned = {fact["id"]: fact for fact in answer["evidence"]}
        self.assertEqual(set(returned), {key for section in answer["sections"] for key in section["evidenceIds"]})
        for key, fact in returned.items():
            for field, value in originals[key].items():
                if field == "source":
                    self.assertEqual({k: fact[field][k] for k in value}, value)
                else:
                    self.assertEqual(fact[field], value)
        self.assertTrue(all(action in payload["allowedActions"] for action in answer["actions"]))
        return answer

    def assert_text(self, answer, *expected):
        text = "\n".join(section["text"] for section in answer["sections"])
        for word in expected:
            self.assertIn(word, text)

    def aewol_conversation(self, live):
        payload = fixture()
        answers = []
        questions = []
        for question, intents, options in QUESTIONS:
            answer = self.ask(payload, question, None if live else classified(intents, **options))
            self.assertEqual(answer["status"], "ANSWERED", answer)
            questions.append(question)
            payload["context"].update(focusedEvidenceIds=answer["focusedEvidenceIds"], recentQuestions=questions.copy())
            answers.append(answer)
        sales, bsi, guide, reviews, result = answers
        self.assert_text(sales, "32,379,500원", "29,581,000원", "-8.64%", "2,049,456,994원", "2,199,885,864원", "+7.34%")
        self.assert_text(bsi, "63.1", "64.4", "+1.3p", "오후 2~5시 결제 건수", "337건", "189건")
        self.assert_text(guide, "주문 안내 점검하기", "라스트오더", "네이버 예약·주문을 이용하는 경우")
        self.assertEqual({fact["id"] for fact in guide["evidence"] if fact["kind"] == "GUIDE"}, {"g1", "g2"})
        self.assertEqual([fact["id"] for fact in reviews["evidence"]], ["r1", "r2"])
        self.assert_text(reviews, "2021-04 ~ 2021-05", "2건")
        self.assertEqual(result["planId"], "plan-1")
        self.assert_text(result, "4개 중 1개", "100,000원", "150,000원", "+50.00%", "6건", "8건", "+33.33%")

    def test_aewol_conversation(self):
        self.aewol_conversation(live=False)

    def assert_economy_and_time_answer(self, answer):
        self.assertEqual(answer["status"], "ANSWERED", answer)
        self.assertEqual(answer["intents"], ["BSI", "TIME_SLOT"])
        self.assertEqual([fact["id"] for fact in answer["evidence"]], ["e4", "e2"])
        self.assertEqual(answer["missingInputs"], [])
        self.assertEqual(answer["actions"], [])
        self.assertIsNone(answer["planId"])
        self.assert_text(answer, "63.1", "64.4", "오후 2~5시 결제 건수", "337건", "189건")

    def test_saved_custom_strategy_and_plan_allow_chart_questions(self):
        payload = fixture()
        for fact in payload["availableEvidence"]:
            if fact["kind"] == "STRATEGY":
                fact.update(code="CUSTOM", label=None)
            elif fact["kind"] == "PLAN":
                fact["strategyCode"] = "CUSTOM"
        payload["allowedActions"].append({"type": "OPEN_STRATEGY", "targetId": "CUSTOM"})

        answer = self.ask(payload, QUESTIONS[1][0], classified(["BSI", "TIME_SLOT"], largestTimeDrop=True))
        self.assert_economy_and_time_answer(answer)

        answer = self.ask(payload, "맞춤 전략은 뭔가요?", classified(["STRATEGY"], strategyCode="CUSTOM"))
        self.assert_text(answer, "맞춤 대응 전략")
        self.assertIn({"type": "OPEN_STRATEGY", "targetId": "CUSTOM"}, answer["actions"])

    def test_economy_and_time_does_not_pick_up_execution_intents(self):
        payload = fixture()
        payload["context"].update(recentQuestions=[QUESTIONS[0][0]], focusedEvidenceIds=["e1", "e3"])
        wrong_intent = classified(["BSI", "TIME_SLOT", "PLAN", "RESULT"], timeMetric="KRW")
        self.assert_economy_and_time_answer(self.ask(payload, QUESTIONS[1][0], wrong_intent))
        payload["availableEvidence"] = [fact for fact in payload["availableEvidence"] if fact["kind"] not in {"PLAN", "RESULT"}]
        self.assert_economy_and_time_answer(self.ask(payload, QUESTIONS[1][0], wrong_intent))

    def test_combined_question_can_explicitly_ask_for_execution_results(self):
        answer = self.ask(fixture(), "제주 BSI와 결제가 줄어든 시간대, 실행 결과도 알려주세요.",
                          classified(["BSI", "TIME_SLOT", "RESULT"], timeMetric="COUNT"))
        self.assertEqual(answer["status"], "ANSWERED")
        self.assertEqual(answer["planId"], "plan-1")
        self.assert_text(answer, "63.1", "337건", "+50.00%", "+33.33%")

    def test_market_follow_up_compares_both_changes_even_if_classified_as_market_only(self):
        payload = fixture()
        payload["chart"] = "MARKET_CARD_SALES"
        first = "같은 기간 상권 카드 이용액은 어떻게 달라졌나요?"
        single = self.ask(payload, first, classified(["MARKET"]))
        self.assertEqual([fact["id"] for fact in single["evidence"]], ["e3"])
        payload["context"].update(recentQuestions=[first], focusedEvidenceIds=["e3"])
        question = "우리 가게랑 비교했을 때 상권 카드 이용액은 어떻게 달라졌나요?"
        answer = self.ask(payload, question, classified(["MARKET"]))
        self.assert_text(answer, "-8.64%", "+7.34%", "15.98%p 낮았어요")
        self.assertEqual(answer["sections"][-1]["evidenceIds"], ["e1", "e3"])
        self.assertEqual([fact["id"] for fact in answer["evidence"]], ["e1", "e3"])

        payload["availableEvidence"] = [fact for fact in payload["availableEvidence"] if fact["id"] != "e3"]
        missing = self.ask(payload, question, classified(["MARKET"]))
        self.assertEqual(missing["status"], "PARTIAL")
        self.assertEqual([fact["id"] for fact in missing["evidence"]], ["e1"])
        self.assertEqual(missing["missingInputs"][0]["code"], "MARKET_CARD_SALES")
        self.assertNotIn("%p", " ".join(section["text"] for section in missing["sections"]))

    def test_declining_time_question_reports_no_drop_when_all_slots_improved(self):
        payload = fixture()
        for fact in payload["availableEvidence"]:
            if fact.get("metric") == "TIME_SERIES":
                fact["after"] = fact["before"] + 1
        answer = self.ask(payload, "결제가 줄어든 시간대가 있나요?", classified(["TIME_SLOT"], timeMetric="COUNT"))
        self.assert_text(answer, "결제 건수가 줄어든 구간이 없어요")
        self.assertTrue(answer["evidence"])

    def test_growing_menu_and_time_band_cite_both_saved_metrics(self):
        payload = fixture()
        period = {"before": "2026-08", "after": "2026-09"}
        payload["context"] = {"comparisonPeriod": list(period.values()), "focusedEvidenceIds": ["afternoon-count"]}
        payload["availableEvidence"] = [
            {"id": key, "kind": "METRIC", "metric": metric, "label": label, "unit": unit,
             "before": before, "after": after, "period": period, "source": {"label": source}}
            for key, metric, label, unit, before, after, source in [
                ("pork-quantity", "ITEM_SALES", "고기국수", "QUANTITY", 100, 120, "저장된 품목별 판매 자료"),
                ("pork-revenue", "ITEM_SALES", "고기국수", "KRW", 850000, 1020000, "저장된 품목별 판매 자료"),
                ("dumpling-revenue", "ITEM_SALES", "만두", "KRW", 90000, 80000, "저장된 품목별 판매 자료"),
                ("afternoon-count", "TIME_SERIES", "오후 2~5시", "COUNT", 4, 1, "저장된 시간대별 자료"),
                ("afternoon-revenue", "TIME_SERIES", "오후 2~5시", "KRW", 34000, 8500, "저장된 결제 POS 시간대별 집계"),
                ("lunch-count", "TIME_SERIES", "오후 2시 전", "COUNT", 100, 120, "저장된 시간대별 자료"),
                ("lunch-revenue", "TIME_SERIES", "오후 2시 전", "KRW", 850000, 1020000, "저장된 결제 POS 시간대별 집계"),
            ]
        ]
        answer = self.ask(payload, "8월에서 9월로 매출이 늘어난 메뉴와 시간대가 어디인지 알려줘. "
                          "두 달의 메뉴 판매량과 매출, 그 시간대의 결제 건수와 매출을 각각 비교하고 근거와 출처를 보여줘.",
                          classified(["ITEM_SALES", "TIME_SLOT"], timeMetric="KRW"))
        self.assertEqual(answer["status"], "ANSWERED")
        self.assert_text(answer, "고기국수 판매량", "100개", "120개", "고기국수 실판매금액",
                         "850,000원", "1,020,000원", "오후 2시 전 결제 건수", "100건", "120건", "오후 2시 전 매출액")
        self.assertEqual([fact["id"] for fact in answer["evidence"]],
                         ["pork-quantity", "pork-revenue", "lunch-count", "lunch-revenue"])

    def test_falling_menu_and_time_band_choose_largest_revenue_drop(self):
        payload = fixture()
        period = {"before": "2026-08", "after": "2026-09"}
        payload["context"] = {"comparisonPeriod": list(period.values()), "focusedEvidenceIds": ["dumpling-revenue"]}
        payload["availableEvidence"] = [
            {"id": key, "kind": "METRIC", "metric": metric, "label": label, "unit": unit,
             "before": before, "after": after, "period": period, "source": {"label": source}}
            for key, metric, label, unit, before, after, source in [
                ("dumpling-quantity", "ITEM_SALES", "만두", "QUANTITY", 80, 80, "저장된 품목별 판매 자료"),
                ("dumpling-revenue", "ITEM_SALES", "만두", "KRW", 480000, 480000, "저장된 품목별 판매 자료"),
                ("rice-quantity", "ITEM_SALES", "공깃밥", "QUANTITY", 40, 5, "저장된 품목별 판매 자료"),
                ("rice-revenue", "ITEM_SALES", "공깃밥", "KRW", 40000, 5000, "저장된 품목별 판매 자료"),
                ("pork-quantity", "ITEM_SALES", "고기국수", "QUANTITY", 120, 100, "저장된 품목별 판매 자료"),
                ("pork-revenue", "ITEM_SALES", "고기국수", "KRW", 1020000, 850000, "저장된 품목별 판매 자료"),
                ("lunch-count", "TIME_SERIES", "오후 2시 전", "COUNT", 90, 90, "저장된 시간대별 자료"),
                ("lunch-revenue", "TIME_SERIES", "오후 2시 전", "KRW", 605000, 605000, "저장된 결제 POS 시간대별 집계"),
                ("afternoon-count", "TIME_SERIES", "오후 2~5시", "COUNT", 70, 50, "저장된 시간대별 자료"),
                ("afternoon-revenue", "TIME_SERIES", "오후 2~5시", "KRW", 545000, 375000, "저장된 결제 POS 시간대별 집계"),
            ]
        ]
        intent = classified(["ITEM_SALES", "TIME_SLOT"], timeMetric="KRW", largestTimeDrop=True,
                            focusEvidenceId="dumpling-revenue")
        for question in ("8월에서 9월로 매출이 가장 많이 줄어든 메뉴와 시간대를 알려줘.",
                         "매출이 가장 많이 감소한 메뉴와 시간대의 판매량, 결제 건수와 매출의 출처를 보여줘."):
            with self.subTest(question=question):
                answer = self.ask(payload, question, intent)
                self.assertEqual(answer["status"], "ANSWERED")
                self.assert_text(answer, "고기국수 판매량", "120개", "100개", "고기국수 실판매금액",
                                 "1,020,000원", "850,000원", "오후 2~5시 결제 건수", "70건", "50건", "오후 2~5시 매출액")
                self.assertEqual([fact["id"] for fact in answer["evidence"]],
                                 ["pork-quantity", "pork-revenue", "afternoon-count", "afternoon-revenue"])

        answer = self.ask(payload, "판매량이 가장 많이 줄어든 메뉴를 알려줘.", classified(["ITEM_SALES"]))
        self.assertEqual([fact["id"] for fact in answer["evidence"]], ["rice-quantity", "rice-revenue"])

    def test_declining_menu_revenue_needs_amounts_and_reports_when_none_fell(self):
        payload = fixture()
        payload["availableEvidence"] = [
            {"id": "menu-quantity", "kind": "METRIC", "metric": "ITEM_SALES", "label": "고기국수",
             "unit": "QUANTITY", "before": 120, "after": 100},
        ]
        question = "매출이 가장 많이 줄어든 메뉴는 뭐야?"
        intent = classified(["ITEM_SALES"])
        answer = self.ask(payload, question, intent)
        self.assertEqual(answer["status"], "MISSING_DATA")
        self.assertEqual(answer["missingInputs"][0]["code"], "ITEM_SALES_KRW")

        payload["availableEvidence"].append(
            {"id": "menu-revenue", "kind": "METRIC", "metric": "ITEM_SALES", "label": "고기국수",
             "unit": "KRW", "before": 850000, "after": 850000},
        )
        answer = self.ask(payload, question, intent)
        self.assertEqual(answer["status"], "ANSWERED")
        self.assert_text(answer, "실판매금액이 줄어든 메뉴가 없어요")
        self.assertEqual([fact["id"] for fact in answer["evidence"]], ["menu-revenue"])

    def test_monthly_only_and_count_instead_of_amount(self):
        question = "몇 시에 매출이 가장 많이 줄었어요?"
        intent = classified(["TIME_SLOT"], timeMetric="KRW", largestTimeDrop=True)
        missing = self.ask(fixture("monthly"), question, intent)
        self.assertEqual(missing["status"], "MISSING_DATA")
        self.assertEqual(missing["missingInputs"][0]["code"], "TIME_SERIES_AMOUNT")
        self.assertEqual(missing["actions"], [{"type": "ADD_TIME_SERIES", "targetId": "AMOUNT"}])
        partial = self.ask(fixture(), question, intent)
        self.assertEqual(partial["status"], "PARTIAL")
        self.assert_text(partial, "시간대별 매출액", "결제 건수", "189건")
        overlapping_intent = classified(["TIME_SLOT", "SALES"], largestTimeDrop=True)
        answer = self.ask(fixture("monthly"), question, overlapping_intent)
        self.assertEqual(answer["status"], "MISSING_DATA")
        self.assertEqual(answer["evidence"], [])
        self.assertEqual(answer["missingInputs"][0]["code"], "TIME_SERIES_AMOUNT")
        combined = self.ask(fixture("monthly"), "월별 매출과 매출이 가장 많이 줄어든 시간대를 알려주세요.",
                            classified(["SALES", "TIME_SLOT"], timeMetric="KRW"))
        self.assertEqual(combined["status"], "PARTIAL")
        self.assertEqual([fact["metric"] for fact in combined["evidence"]], ["MONTHLY_SALES"])

    def test_partial_market_and_missing_operational_data(self):
        payload = fixture()
        for fact in payload["availableEvidence"]:
            if fact["id"] in {"e3", "e4"}:
                fact["after"] = None
        answer = self.ask(payload, "매출과 상권·BSI, 판매량·원가·재고도 알려줘",
                          classified(["SALES", "MARKET", "BSI", "ITEM_SALES", "COST", "STOCK"]))
        self.assertEqual(answer["status"], "PARTIAL")
        self.assertEqual([fact["id"] for fact in answer["evidence"]], ["e1"])
        self.assertEqual({entry["code"] for entry in answer["missingInputs"]},
                         {"MARKET_CARD_SALES", "JEJU_BSI", "ITEM_SALES", "UNIT_COST", "STOCK"})

    def test_review_topic_and_explicit_period(self):
        for topic, key in [("PARKING", "r4"), ("WAIT_TIME", "r5")]:
            answer = self.ask(fixture(), "그때 리뷰 불편은?", classified(["REVIEWS"], reviewTopic=topic))
            self.assertEqual([fact["id"] for fact in answer["evidence"]], [key])
        period = {"before": "2021-06", "after": "2021-06"}
        answer = self.ask(fixture(), "6월 주문 안내 리뷰는?", classified(["REVIEWS"], reviewPeriod=period))
        self.assertEqual([fact["id"] for fact in answer["evidence"]], ["r3"])
        answer = self.ask(fixture(), "6월 주차 리뷰는?", classified(["REVIEWS"], reviewPeriod=period, reviewTopic="PARKING"))
        self.assertEqual(answer["status"], "MISSING_DATA")
        self.assert_text(answer, "2021-06 ~ 2021-06")

    def test_ambiguous_plan_and_no_result_for_selected_plan(self):
        payload = fixture()
        other_plan = {"id": "p2", "kind": "PLAN", "planId": "plan-2", "completed": 0, "total": 2}
        payload["availableEvidence"].append(other_plan)
        intent = classified(["RESULT"], focusEvidenceId="p2")
        answer = self.ask(payload, "실행 결과는 어땠나요?", intent)
        self.assertEqual(answer["status"], "CLARIFICATION_REQUIRED")
        self.assertEqual(answer["actions"], [{"type": "SELECT_PLAN", "targetId": "plan-1"}])
        payload["context"]["planId"] = "plan-2"
        answer = self.ask(payload, "그 계획의 결과는?", intent)
        self.assertEqual(answer["status"], "PARTIAL")
        self.assertEqual([fact["id"] for fact in answer["evidence"]], ["p2"])
        self.assertEqual(answer["missingInputs"][0]["code"], "RESULT")

    def test_missing_official_guide_and_out_of_scope(self):
        payload = fixture()
        answer = self.ask(payload, "재고 전략 공식 링크 알려줘", classified(["GUIDE"], strategyCode="INVENTORY"))
        self.assertEqual(answer["status"], "MISSING_DATA")
        self.assertEqual(answer["missingInputs"][0]["code"], "OFFICIAL_GUIDE")
        self.assertEqual(answer["evidence"], [])
        answer = self.ask(payload, "매장과 상관없는 질문", classified(["OUT_OF_SCOPE"]))
        self.assertEqual(answer["status"], "OUT_OF_SCOPE")
        self.assertEqual(answer["actions"], [])

    def test_model_failure_is_service_unavailable(self):
        def unavailable(_):
            raise TimeoutError

        with patch.object(api, "question_graph", build_question_graph(unavailable)):
            response = TestClient(api.app).post("/internal/chart-questions", json={**fixture(), "question": "매출은?"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "QA_UNAVAILABLE")

    @unittest.skipUnless(os.getenv("RUN_LIVE_CHART_QA") == "1", "Live OpenAI verification is opt-in")
    def test_live_aewol_and_missing_data(self):
        self.aewol_conversation(live=True)
        for _ in range(3):
            answer = self.ask(fixture("monthly"), "몇 시에 매출이 가장 많이 줄었어요?")
            self.assertEqual(answer["status"], "MISSING_DATA")
            self.assertEqual(answer["evidence"], [])
            self.assertEqual(answer["missingInputs"][0]["code"], "TIME_SERIES_AMOUNT")

    @unittest.skipUnless(os.getenv("RUN_LIVE_CHART_QA") == "1", "Live OpenAI verification is opt-in")
    def test_live_economy_time_and_execution_questions(self):
        payload = fixture()
        payload["context"].update(recentQuestions=[QUESTIONS[0][0]], focusedEvidenceIds=["e1", "e3"])
        without_plan = {**payload, "availableEvidence": [
            fact for fact in payload["availableEvidence"] if fact["kind"] not in {"PLAN", "RESULT"}
        ]}
        for scenario in [without_plan, payload, without_plan, payload, without_plan]:
            self.assert_economy_and_time_answer(self.ask(scenario, QUESTIONS[1][0]))
        for _ in range(2):
            result = self.ask(payload, QUESTIONS[-1][0])
            self.assertEqual(result["status"], "ANSWERED", result)
            self.assertEqual(result["planId"], "plan-1")
            self.assert_text(result, "4개 중 1개", "100,000원", "150,000원", "+50.00%", "6건", "8건", "+33.33%")
