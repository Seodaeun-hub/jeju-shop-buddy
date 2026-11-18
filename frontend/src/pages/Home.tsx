import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Citrus } from '../components/ui'
import { LandingIllustration } from '../components/LandingIllustration'
import { LandingDemoStory } from '../components/LandingDemoStory'
import '../styles/home.css'

function useConversationReveal() {
  const ref = useRef<HTMLHeadingElement>(null)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    if (typeof IntersectionObserver === 'undefined') { setRevealed(true); return }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= .6) setRevealed(true)
      else if (entry.boundingClientRect.top >= 0) setRevealed(false)
    }, { threshold: .6 })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return { ref, revealed }
}

export function Home() {
  const conversation = useConversationReveal()
  return <>
    <section className="landing-hero" aria-labelledby="landing-title">
      <LandingIllustration>
        <div className="shell landing-intro">
          <p className="landing-intro-label">제주 소상공인을 위한 매출 짝꿍</p>
          <h1 id="landing-title">매출이 줄었을 때,<br />무엇부터 해볼까요?</h1>
          <p>우리 가게 매출과 제주 상권을 함께 보고, 오늘 할 일을 정해요.</p>
          <div className="actions"><Link to="/stores" className="button primary">가게짝꿍 시작하기 <span aria-hidden="true">→</span></Link></div>
        </div>
      </LandingIllustration>
      <a href="#landing-questions" className="landing-scroll-cue" aria-label="다음 섹션으로 이동"><span aria-hidden="true" /></a>
    </section>
    <section id="landing-questions" className="landing-dialogue" aria-labelledby="landing-questions-title">
      <div className="shell landing-question" data-revealed={conversation.revealed}>
        <h2 id="landing-questions-title" ref={conversation.ref}>사장님, 요즘 뭐가 고민이세요?</h2>
        <ul className="landing-prompts">
          <li>요즘 오후에 손님이 왜 줄었을까요?</li>
          <li>우리 가게만 매출이 줄어든 걸까요?</li>
          <li>가게에서 무엇부터 해볼까요?</li>
        </ul>
        <div className="landing-story-heading"><Citrus /><p>그럴 때 필요한 게 <strong>가게짝꿍</strong>이에요.</p></div>
      </div>
    </section>
    <LandingDemoStory />
    <section className="landing-start" aria-labelledby="landing-start-title">
      <div className="shell landing-start-content">
        <h2 id="landing-start-title">우리 가게 매출도<br />살펴볼까요?</h2>
        <Link to="/stores" className="button primary">가게짝꿍 시작하기 <span aria-hidden="true">→</span></Link>
      </div>
    </section>
  </>
}
