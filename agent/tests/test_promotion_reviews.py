from datetime import date
import json
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from strategy_agent.promotion_reviews import (
    Observation, Observations, PassageSelection, PointCandidate, PointCandidates, ReviewRequest,
    research_reviews, search_review_urls, verified_points, verified_reviews, review_passages, select_reviews, extractive_point, ReviewSource,
)


class PromotionReviewTests(unittest.TestCase):
    def test_research_uses_audited_points_instead_of_unsupported_generated_texture(self):
        excerpt = "김치찌개와 함께 먹는 솥밥이 맛있었습니다. 윤기나 찰진 식감은 적지 않았습니다."
        observations = PassageSelection(passageIds=[1])
        proposed = PointCandidates(points=[PointCandidate(sentence="윤기와 찰진 솥밥의 식감을 먼저 소개해 보세요.",
                                                        anchors=["솥밥"], sourceIds=["r1"])])
        audited = PointCandidates(points=[PointCandidate(sentence="김치찌개와 함께 즐기는 솥밥을 먼저 소개해 보세요.",
                                                      anchors=["솥밥"], sourceIds=["r1"])])
        models = [MagicMock(), MagicMock(), MagicMock()]
        for model, result in zip(models, [observations, proposed, audited]):
            model.invoke.return_value = result
        with patch.dict("os.environ", {"STRATEGY_AI_API_KEY": "test-key"}), \
                patch("strategy_agent.promotion_reviews.search_review_urls", return_value=["https://example.tistory.com/1"]), \
                patch("strategy_agent.promotion_reviews.read_matching_page", return_value="2021. 2. 14. " + excerpt), \
                patch("strategy_agent.promotion_reviews.structured_model", side_effect=models):
            result = research_reviews(ReviewRequest(storeName="검증 식당", address="하가로 159", subject="김치찌개",
                                                    referenceDate="2021-06-01"))
        self.assertEqual([p.sentence for p in result.points], [audited.points[0].sentence])
        self.assertNotIn("찰진", result.points[0].sentence)

    def test_empty_first_search_is_retried_inside_the_same_request(self):
        excerpt = "김치찌개 국물 맛이 좋아서 맛있게 먹었습니다."
        proposal = PointCandidates(points=[PointCandidate(sentence="김치찌개 국물 맛을 중심으로 소개해 보세요.", anchors=["국물"], sourceIds=["r1"])])
        models = [MagicMock(), MagicMock(), MagicMock()]
        for model, value in zip(models, [PassageSelection(passageIds=[1]), proposal, proposal]):
            model.invoke.return_value = value
        def search(*args, broad=False):
            return ["https://example.tistory.com/1"] if broad else []
        with patch.dict("os.environ", {"STRATEGY_AI_API_KEY": "test-key"}), \
                patch("strategy_agent.promotion_reviews.search_review_urls", side_effect=search) as searches, \
                patch("strategy_agent.promotion_reviews.read_matching_page", return_value="2021. 2. 14. " + excerpt), \
                patch("strategy_agent.promotion_reviews.structured_model", side_effect=models):
            result = research_reviews(ReviewRequest(storeName="검증 식당", address="하가로 159", subject="김치찌개", referenceDate="2021-06-01"))
        self.assertEqual(len(result.sources), 1)
        self.assertEqual(len(result.points), 1)
        self.assertEqual(searches.call_count, 6)
        self.assertEqual([call.kwargs["broad"] for call in searches.call_args_list].count(True), 3)

    def test_exact_menu_passages_do_not_include_the_next_egg_roll_sentence(self):
        page = "2021. 2. 14. 흑돼지 김치찌개는 육수가 졸아야 더 맛있습니다. 그리고 계란말이는 뜨거웠습니다."
        request = ReviewRequest(storeName="검증 식당", address="하가로 159", subject="김치찌개", referenceDate="2021-06-01")
        passages = review_passages([("https://example.tistory.com/1", page)], request.subject, date(2021, 6, 1))
        self.assertEqual(len(passages), 1)
        self.assertNotIn("계란말이", passages[0]["excerpt"])
        with patch("strategy_agent.promotion_reviews.structured_model") as model:
            model.return_value.invoke.return_value = PassageSelection(passageIds=[1, 999])
            found = select_reviews([("https://example.tistory.com/1", page)], request, date(2021, 6, 1))
        self.assertEqual(found[0][1], passages[0]["excerpt"])
        self.assertEqual(found[0][0].dateLabel, "2021. 2. 14.")

    def test_old_related_post_date_cannot_relabel_a_future_article(self):
        page = "2025. 3. 20. 김치찌개를 맛있게 먹었습니다. 관련 글 2021. 2. 14. 김치찌개 후기."
        self.assertEqual(review_passages([("https://example.tistory.com/1", page)], "김치찌개", date(2021, 6, 1)), [])

    def test_date_zero_padding_does_not_reject_the_same_actual_date(self):
        excerpt = "김치찌개 육수가 좋아서 한 그릇을 맛있게 먹었습니다."
        found = verified_reviews(Observations(reviews=[Observation(page=1, dateText="2021-02-14", excerpt=excerpt)]),
                                 [("https://example.tistory.com/1", "2021. 2. 14. " + excerpt)], date(2021, 6, 1))
        self.assertEqual(len(found), 1)

    def test_extractive_fallback_is_actual_short_menu_evidence_not_invented_copy(self):
        source = ReviewSource(id="r1", url="https://example.tistory.com/1", title="후기", dateLabel="2021. 2. 14.")
        excerpt = "흑돼지 김치찌개는 육수가 졸아야 더 자극적이고 맛있습니다."
        points = extractive_point([(source, excerpt)], "김치찌개")
        self.assertEqual(points[0].sentence, excerpt)
        self.assertEqual(points[0].sourceIds, ["r1"])
        self.assertEqual(points[0].anchors, ["육수"])
        self.assertEqual(extractive_point([(source, "계란말이는 정말 고소하고 맛있었습니다.")], "김치찌개"), [])
        self.assertEqual(extractive_point([(source, "김치찌개 메뉴가 있다는 안내를 읽었습니다.")], "김치찌개"), [])

    def test_navigation_menu_and_quantity_lines_are_not_review_passages(self):
        page = ("2021. 2. 14. 김치찌개 https://example.com/menu . 김치찌개는 2인분 이상 주문합니다. "
                "김치찌개 국물이 참 좋았습니다. 태그 김치찌개 Related Articles 댓글달기.")
        passages = review_passages([("https://example.tistory.com/1", page)], "김치찌개", date(2021, 6, 1))
        self.assertEqual([p["excerpt"] for p in passages], ["김치찌개 국물이 참 좋았습니다."])

    def test_empty_model_selection_keeps_exact_dated_personal_experience_not_ads(self):
        request = ReviewRequest(storeName="검증 식당", address="하가로 159", subject="김치찌개", referenceDate="2021-06-01")
        excerpt = "김치찌개 국물이 깔끔해서 맛있게 먹었습니다."
        with patch("strategy_agent.promotion_reviews.structured_model") as model:
            model.return_value.invoke.return_value = PassageSelection(passageIds=[])
            reviews = select_reviews([("https://example.tistory.com/1", "2021. 2. 14. " + excerpt)], request, date(2021, 6, 1))
            self.assertEqual(reviews[0][1], excerpt)
            self.assertEqual(select_reviews([("https://example.tistory.com/1", "2021. 2. 14. 협찬 " + excerpt)], request, date(2021, 6, 1)), [])

    def test_rehearsal_keeps_only_the_reference_dates_180_day_window(self):
        excerpt = "흑돼지 김치찌개와 따뜻한 솥밥을 맛있게 먹었습니다."
        labels = ["2021. 2. 14.", "2021. 6. 1.", "2021. 6. 2.", "2020. 1. 26.", "3개월 전"]
        pages = [(f"https://example.tistory.com/{i}", f"{label} {excerpt} {i}") for i, label in enumerate(labels)]
        observations = Observations(reviews=[
            Observation(page=i + 1, dateText=label, excerpt=excerpt + f" {i}")
            for i, label in enumerate(labels)
        ])
        with patch("strategy_agent.promotion_reviews.actual_today", return_value=date(2026, 11, 18)):
            found = verified_reviews(observations, pages, date(2021, 6, 1))
        self.assertEqual([source.dateLabel for source, _ in found], ["2021. 6. 1.", "2021. 2. 14."])

    def test_search_uses_reference_year_and_an_upper_bound(self):
        request = ReviewRequest(storeName="더애월 본점", address="제주시 애월읍 하가로 159", subject="김치찌개",
                                referenceDate=date(2021, 6, 1))
        with patch("strategy_agent.promotion_reviews.OpenAI") as client:
            search_review_urls("test-key", request, date(2020, 12, 3), "site:tistory.com")
            payload = client.return_value.__enter__.return_value.responses.create.call_args.kwargs
        search = json.loads(payload["input"])
        self.assertEqual(search["referenceDate"], "2021-06-01")
        self.assertIn("before:2021-06-02", search["query"])
        self.assertIn("after:2020-12-02", search["query"])

    def test_default_research_uses_actual_today_and_future_dates_are_rejected(self):
        with patch("strategy_agent.promotion_reviews.actual_today", return_value=date(2026, 11, 18)), \
                patch.dict("os.environ", {"STRATEGY_AI_API_KEY": "test-key"}), \
                patch("strategy_agent.promotion_reviews.search_review_urls", return_value=[]) as search:
            research_reviews(ReviewRequest(storeName="더애월", address="하가로 159", subject="김치찌개"))
            self.assertTrue(all(call.args[2] == date(2026, 5, 22) for call in search.call_args_list))
            with self.assertRaises(ValidationError):
                ReviewRequest(storeName="더애월", address="하가로 159", subject="김치찌개", referenceDate="2026-11-19")

    def test_counts_readable_recent_unique_reviews(self):
        excerpt = "고기국수 육수가 담백해서 그릇을 다 비웠어요."
        pages = [
            ("https://test.tistory.com/1", f"2026. 9. 12. {excerpt}"),
            ("https://test.tistory.com/2", f"2026. 9. 12. {excerpt}"),
            ("https://test.tistory.com/3", "2025. 9. 12. 부드러운 고명도 참 좋았어요."),
        ]
        found = verified_reviews(Observations(reviews=[
            Observation(page=1, dateText="2026. 9. 12.", excerpt=excerpt),
            Observation(page=2, dateText="2026. 9. 12.", excerpt=excerpt),
            Observation(page=3, dateText="2025. 9. 12.", excerpt="부드러운 고명도 참 좋았어요."),
            Observation(page=1, dateText="2026. 9. 11.", excerpt=excerpt),
            Observation(page=1, dateText="2026. 9. 12.", excerpt="쫄깃한 식감이 끝까지 남았어요."),
        ]), pages, date(2026, 11, 12))
        self.assertEqual([source.url for source, _ in found], [pages[0][0]])
        proposals = PointCandidates(points=[
            PointCandidate(sentence="담백한 육수로 고기국수 한 그릇을 소개해 보세요.", anchors=["육수"], sourceIds=["r1"]),
            PointCandidate(sentence="쫄깃한 식감으로 고기국수 한 그릇을 소개해 보세요.", anchors=["식감"], sourceIds=["r1"]),
        ])
        self.assertEqual([point.anchors for point in verified_points(proposals, found)], [["육수"]])


if __name__ == "__main__":
    unittest.main()
