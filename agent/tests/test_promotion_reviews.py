from datetime import date
import json
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from strategy_agent.promotion_reviews import (
    Observation, Observations, PointCandidate, PointCandidates, ReviewRequest,
    research_reviews, search_review_urls, verified_points, verified_reviews,
)


class PromotionReviewTests(unittest.TestCase):
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
