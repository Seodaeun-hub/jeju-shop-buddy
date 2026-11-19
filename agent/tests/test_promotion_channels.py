import unittest
from unittest.mock import patch

from strategy_agent.promotion_channels import (
    ChannelCopy, ChannelPosts, ChannelRequest, Finding, PostCopy, Research, ResearchFinding,
    checked_findings, generate_channels, write_channels,
    normalized_text, research_store, audit_channel_claims, CopyAudit, AuditedSentence,
)

def model_posts(instagram: str, naver: str, daangn: str) -> ChannelPosts:
    def post(text: str) -> PostCopy:
        return PostCopy(title="", opening=text, menu="", closing="")
    return ChannelPosts(instagram=post(instagram), naver=post(naver), daangn=post(daangn))


class PromotionChannelsTest(unittest.TestCase):
    def setUp(self):
        self.request = ChannelRequest(storeName="자매국수", address="제주특별자치도 제주시 항골남길 46 1층",
                                      subject="고기국수", tone="FRIENDLY", avoidPhrases="인생 맛집", promotion=True)
        self.audit = patch("strategy_agent.promotion_channels.audit_channel_claims", side_effect=lambda copies, *args: copies)
        self.audit.start()
        self.addCleanup(self.audit.stop)

    def test_keeps_only_same_address_with_consulted_source(self):
        official = "https://store.example/menu"
        excerpt = "고기국수에 치자로 만든 노란 면발을 사용해요."
        fields = {"sourceExcerpt": excerpt, "url": official}
        findings = checked_findings(Research(findings=[
            ResearchFinding(kind="MENU", text="고기국수에 치자면을 사용해요.", pageAddress="제주시 항골남길 46", **fields),
            ResearchFinding(kind="MENU", text="다른 지점의 신메뉴", pageAddress="제주시 항골남길 460", **fields),
            ResearchFinding(kind="HOURS", text="오전부터 운영", pageAddress="제주시 항골남길 46-2", **fields),
            ResearchFinding(kind="MENU", text="비빔국수의 양념", pageAddress="제주시 항골남길 46", **fields),
            ResearchFinding(kind="STORE", text="검증되지 않은 페이지", pageAddress="제주시 항골남길 46",
                            sourceExcerpt=excerpt, url="https://other.example"),
            ResearchFinding(kind="STORE", text="페이지에 없는 주장", pageAddress="제주시 항골남길 46",
                            sourceExcerpt="페이지에 적혀 있지 않은 주장을 사실로 넣었습니다.", url=official),
        ]), self.request.address, {official: normalized_text(excerpt)}, self.request.subject)
        self.assertEqual([(item.text, item.url) for item in findings], [("고기국수에 치자면을 사용해요.", official)])

    def test_copy_cannot_override_price_or_avoid_phrases(self):
        for unusable in ["고기국수는 5,000원이에요.", "인생 맛집에 놀러 오세요."]:
            with self.subTest(unusable=unusable), patch("strategy_agent.promotion_channels.structured_model") as model:
                model.return_value.invoke.return_value = model_posts(unusable, "메뉴 소식", "이웃에게 전하는 메뉴")
                with self.assertRaises(ValueError):
                    write_channels(self.request, [])

    def test_search_failure_still_writes_a_draft(self):
        copy = ChannelCopy(instagram="고기국수 한 그릇", naver="고기국수 소식", daangn="고기국수 소개")
        with patch("strategy_agent.promotion_channels.research_store", side_effect=TimeoutError), \
                patch("strategy_agent.promotion_channels.write_channels", return_value=copy) as write:
            result = generate_channels(self.request)
        self.assertEqual(result.findings, [])
        self.assertEqual(result.drafts, copy)
        write.assert_called_once_with(self.request, [])

    def test_selected_photo_is_preview_only_not_a_source_for_the_writer(self):
        photo = "data:image/jpeg;base64,AA=="
        request = self.request.model_copy(update={"photoDataUrl": photo, "tone": "SHORT"})
        with patch("strategy_agent.promotion_channels.structured_model") as model:
            model.return_value.invoke.return_value = model_posts(
                instagram="고기국수 한 그릇", naver="고기국수 소식", daangn="고기국수 소개",
            )
            write_channels(request, [])
        message = model.return_value.invoke.call_args.args[0][-1]
        self.assertNotIn(photo, message.content[0]["text"])
        self.assertEqual(len(message.content), 1)
        self.assertNotIn("image_url", str(message.content))

    def test_evidence_audit_drops_unconfirmed_ingredients_and_serving_claims(self):
        self.audit.stop()
        request = ChannelRequest.model_validate({**self.request.model_dump(), "subject": "김치찌개", "reviewPoints": [
            {"sentence": "육수가 졸아들면 맛이 더 또렷해져요.", "anchors": ["육수"]}
        ]})
        copies = {"instagram": "김치찌개 어떠세요? 두부와 파를 올려 드려요. 육수가 졸아들면 맛이 또렷해져요.",
                  "naver": "김치찌개 안내. 뚝배기째 제공합니다.", "daangn": "이웃에게 김치찌개를 소개해요."}
        audit = CopyAudit(sentences=[
            AuditedSentence(id=1, kind="INVITATION", evidenceIds=[]),
            AuditedSentence(id=2, kind="UNSUPPORTED", evidenceIds=[]),
            AuditedSentence(id=3, kind="FACT", evidenceIds=["review-0"]),
            AuditedSentence(id=4, kind="FACT", evidenceIds=["menu"]),
            AuditedSentence(id=5, kind="UNSUPPORTED", evidenceIds=[]),
            AuditedSentence(id=6, kind="INVITATION", evidenceIds=[]),
        ])
        with patch("strategy_agent.promotion_channels.structured_model") as model:
            model.return_value.invoke.return_value = audit
            result = audit_channel_claims(copies, request, [])
        self.assertNotIn("두부", result["instagram"])
        self.assertNotIn("파를", result["instagram"])
        self.assertNotIn("뚝배기", result["naver"])
        self.assertIn("육수", result["instagram"])

    def test_audit_rejects_missing_decisions_and_unknown_evidence(self):
        self.audit.stop()
        copies = {"instagram": "고기국수 안내."}
        with patch("strategy_agent.promotion_channels.structured_model") as model:
            model.return_value.invoke.return_value = CopyAudit(sentences=[])
            with self.assertRaisesRegex(ValueError, "incomplete copy evidence audit"):
                audit_channel_claims(copies, self.request, [])
            model.return_value.invoke.return_value = CopyAudit(sentences=[AuditedSentence(id=1, kind="FACT", evidenceIds=["made-up"])])
            self.assertEqual(audit_channel_claims(copies, self.request, []), {"instagram": ""})

    def test_serving_claim_cannot_be_labeled_as_a_casual_invitation(self):
        self.audit.stop()
        with patch("strategy_agent.promotion_channels.structured_model") as model:
            model.return_value.invoke.return_value = CopyAudit(sentences=[AuditedSentence(id=1, kind="INVITATION", evidenceIds=[])])
            result = audit_channel_claims({"instagram": "뚝배기에 담아 드릴게요."}, self.request, [])
        self.assertEqual(result["instagram"], "")

    def test_rewriting_tone_uses_saved_findings_without_searching(self):
        findings = [Finding(kind="MENU", text="고기국수에 치자면을 사용해요.", url="https://store.example/menu")]
        request = self.request.model_copy(update={"tone": "SHORT", "savedFindings": findings})
        copy = ChannelCopy(instagram="치자면 고기국수", naver="치자면을 쓴 고기국수 소식", daangn="이웃에게 치자면 고기국수를 소개해요.")
        with patch("strategy_agent.promotion_channels.research_store") as search, \
                patch("strategy_agent.promotion_channels.write_channels", return_value=copy) as write:
            result = generate_channels(request)
        search.assert_not_called()
        write.assert_called_once_with(request, findings)
        self.assertEqual(result.drafts, copy)

    def test_completed_search_is_used_when_the_other_returns_no_report(self):
        url = "https://store.example/menu"
        excerpt = "고기국수에 치자로 만든 노란 면발을 사용해요."
        result = Research(findings=[
            ResearchFinding(kind="MENU", text="고기국수에 치자면을 사용해요.", pageAddress="제주시 항골남길 46",
                            sourceExcerpt=excerpt, url=url),
        ])
        with patch.dict("os.environ", {"STRATEGY_AI_API_KEY": "test"}), \
                patch("strategy_agent.promotion_channels.search_urls", side_effect=lambda *args, primary: (
                    [url] if primary else []
                )), patch("strategy_agent.promotion_channels.read_matching_page", return_value=normalized_text(excerpt)), \
                patch("strategy_agent.promotion_channels.structured_model") as model:
            model.return_value.invoke.return_value = result
            findings = research_store(self.request)
        self.assertEqual([finding.url for finding in findings], [url])

    def test_safe_copy_survives_when_an_unconfirmed_line_is_dropped(self):
        with patch("strategy_agent.promotion_channels.structured_model") as model:
            model.return_value.invoke.return_value = model_posts(
                instagram="고기국수 한 그릇 어떠세요? 오늘만 5,000원이에요.",
                naver="자매국수 고기국수 안내. 쫄깃한 면을 준비했어요. 예약하실 수 있어요.",
                daangn="동네 이웃에게 고기국수 소식을 전해요.",
            )
            result = write_channels(self.request, [])
        self.assertEqual(result.instagram, "고기국수 한 그릇 어떠세요?")
        self.assertEqual(result.naver, "자매국수 고기국수 안내.")
