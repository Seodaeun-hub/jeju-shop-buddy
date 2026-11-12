from datetime import date
import unittest

from strategy_agent.promotion_reviews import (
    Observation, Observations, PointCandidate, PointCandidates, verified_points, verified_reviews,
)


class PromotionReviewTests(unittest.TestCase):
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
