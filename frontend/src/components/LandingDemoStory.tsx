import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Citrus } from './ui'
import { landingDemo as demo, landingSteps } from '../data/landingDemo'
import { changeRate, formatRate, won } from '../data/shop'
import '../styles/landing-demo-story.css'

const foodPhoto = new URL('../assets/kimchi-jjigae-ai.png', import.meta.url).href
const style = (values: Record<string, string | number>) => values as CSSProperties
const external = { target: '_blank', rel: 'noreferrer' } as const

function PairBars({ before, after, unit }: { before: number; after: number; unit: string }) {
  const max = Math.max(before, after, 1)
  return <div className="journey-pair-bars">{[before, after].map((value, index) => <div key={index}>
    <span>{index ? '비교 후' : '비교 전'}</span><span className="journey-track"><i style={{ width: `${value / max * 100}%` }}><b /></i></span>
    <strong>{value}{unit}</strong></div>)}</div>
}

function SalesScene() {
  return <div className="journey-sales-scene">
    <div className="journey-inputs"><span className="journey-input-pos">▤ 4·5월 POS <small>가상 시연 CSV</small></span>
      <Citrus /><span className="journey-input-public">제주데이터허브 <small>실제 공개자료</small></span></div>
    <svg className="journey-data-path" viewBox="0 0 460 45" fill="none" aria-hidden="true"><path d="M70 0 V20 Q70 35 90 35 H370 Q390 35 390 20 V0 M230 35 V45" /></svg>
    <div className="journey-rate-grid"><div><span>상권 카드 이용액</span><strong>{formatRate(changeRate(...demo.market))}</strong><small>실제 자료</small></div>
      <div><span>우리 가게 매출</span><strong>{formatRate(changeRate(...demo.sales))}</strong><small>가상 POS</small></div></div>
    <div className="journey-sales-plot"><span>2021년 4월 → 5월 · 가상 매출</span>
      <svg viewBox="0 0 460 160" role="img" aria-label="4월 16,342,500원에서 5월 14,508,000원으로 감소">
        <path className="journey-chart-guide" d="M20 40H440 M20 90H440 M20 140H440" />
        <path className="journey-chart-line" d="M40 45 C160 45 290 130 420 130" pathLength="1" />
        <circle cx="40" cy="45" r="6" /><circle cx="420" cy="130" r="6" />
        <text x="20" y="25">{won(demo.sales[0])}</text><text x="440" y="110" textAnchor="end">{won(demo.sales[1])}</text>
      </svg>
    </div>
    <p className="journey-scene-note">제주시 애월읍 · 한식 음식점업<br />카드 이용액과 매장 실매출은 다른 지표예요.</p>
  </div>
}

function EvidenceScene() {
  return <div className="journey-chat-scene">
    <div className="journey-voice"><span aria-hidden="true">{[0, 1, 2, 3, 4].map(n => <i key={n} style={style({ '--wave-delay': `${n * .12}s` })} />)}</span>말로 묻고, 고친 뒤 보내기</div>
    <p className="journey-question">가장 많이 줄어든 메뉴와 시간대를 알려줘.</p>
    <div className="journey-ai-reply"><Citrus /><div><strong>가게짝꿍 · 답변 예시</strong>
      <p>매출이 가장 많이 줄어든 메뉴는 <b>김치찌개</b>예요. 판매량은 <b>610→462인분</b>, 매출은 <b>488만→369만 6천 원</b>으로 줄었어요.</p>
      <p>결제가 가장 많이 줄어든 시간대는 <b>오후 2~5시</b>로, <b>208→104건</b>이에요.</p></div></div>
    <div className="journey-evidence-cards"><div><span>메뉴 근거</span><strong>김치찌개</strong><PairBars before={610} after={462} unit="" /></div>
      <div><span>시간대 근거</span><strong>14:00–17:00</strong><PairBars before={208} after={104} unit="건" /></div></div>
    <p className="journey-scene-note">출처 · 가상 4·5월 상품 주문·결제 CSV<br />메뉴와 시간대는 각각의 집계예요.</p>
  </div>
}

function InventoryScene() {
  const values = [30, 32, 28, 22, 24, 20]
  return <div className="journey-stock-scene">
    <header><span>2021.06.05 · 하루 발주 검토</span><b>가상 운영</b></header>
    <div className="journey-stock-demand"><span>김치찌개 예상 판매</span><strong>20<span>–</span>24<small>인분</small></strong>
      <div className="journey-spark" aria-label="최근 같은 요일 판매량 30,32,28,22,24,20인분">{values.map((n, i) => <div key={i}><span style={{ height: `${n * 1.35}px` }}><i /></span><small>{n}</small></div>)}</div>
      <p>같은 요일 판매 + 최근 감소 추세</p></div>
    <div className="journey-recipe-flow"><span>저장한 돼지고기 사용량 · 1인분당 0.1kg</span>
      <dl>{[['예상 사용', '2.0~2.4kg'], ['현재 재고', '− 1.0kg'], ['기존 입고 예정', '− 0.5kg']].map(([label, value], i) =>
        <div key={label} style={style({ '--item-delay': `${i * .22}s` })}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="journey-preparation"><span>추가로 준비할 돼지고기</span><strong>0.5–0.9<small>kg</small></strong></div></div>
    <p className="journey-scene-note">이 예시는 같은 요일·추세 기준이에요.<br />날씨 조건별 표본이 부족해 날씨 조정은 하지 않았어요.</p>
  </div>
}

function PromotionScene() {
  return <div className="journey-promotion-scene">
    <div className="journey-review-origin"><span>공개 후기 + 당시 《공(空)의 매혹》 전시 소식</span><strong>김치찌개 이야기로 초안 만들기</strong></div>
    <svg className="journey-promo-path" viewBox="0 0 460 60" fill="none" aria-hidden="true"><path d="M230 0V20 M70 60V35Q70 20 90 20H370Q390 20 390 35V60 M230 20V60" /></svg>
    <div className="journey-promo-cards">{['인스타그램', '네이버 플레이스', '당근'].map((channel, index) =>
      <article className="journey-promo-card" key={channel} style={style({ '--card-index': index, '--card-offset': 1 - index, '--card-angle': `${(index - 1) * 5}deg` })}>
        <header><span className={`journey-channel-dot channel-${index}`} />{channel}</header>
        <div className="journey-food"><img src={foodPhoto} alt="AI로 만든 김치찌개 예시 사진" width={1254} height={1254} loading="lazy" /><small>AI 예시 사진</small></div>
        <div className="journey-promo-text"><small>2021년 6월 가상 홍보</small><strong>김치찌개</strong><b>8,000원</b>
          <p>{['김치찌개와 솥밥을 곁들여요.', '메뉴와 가게 소식을 확인해 보세요.', '오늘 식사로 김치찌개 어떠세요?'][index]}</p></div>
      </article>)}</div>
    <div className="journey-publish-actions"><span>문구 복사</span><span>이미지 저장</span><span>채널에서 직접 게시 ↗</span></div>
    <p className="journey-scene-note">사장님 확인 전 초안 예시 · 자동 게시하지 않아요.</p>
  </div>
}

const languages = [
  { id: 'ko', label: '한국어', heading: '메뉴', name: '김치찌개', description: '따뜻한 한 끼, 김치찌개', other: '파돈 두루치기' },
  { id: 'en', label: 'English', heading: 'Menu', name: 'Kimchi Stew', description: 'A warm bowl of kimchi stew', other: 'Pork & Green Onion Stir-fry' },
  { id: 'zh', label: '简体中文', heading: '菜单', name: '泡菜汤', description: '暖心的一餐', other: '葱炒猪肉' },
  { id: 'ja', label: '日本語', heading: 'メニュー', name: 'キムチチゲ', description: '温かい一杯をどうぞ', other: '豚肉とねぎの炒め物' },
] as const

function MenuScene({ revealed, motion }: { revealed: boolean; motion: boolean }) {
  const [language, setLanguage] = useState(0)
  const [manual, setManual] = useState(false)
  useEffect(() => {
    if (!revealed || !motion || manual) return
    setLanguage(0)
    const timers = [1, 2, 3].map((index) => window.setTimeout(() => setLanguage(index), index * 2300))
    return () => timers.forEach(window.clearTimeout)
  }, [revealed, motion, manual])
  const current = languages[language]
  const previewUrl = new URL('/#landing-menu-preview', window.location.origin).href
  return <div className="journey-menu-scene" id="landing-menu-preview">
    <div className="journey-language-buttons" role="group" aria-label="홈 메뉴판 예시 언어">{languages.map((lang, i) =>
      <button type="button" key={lang.id} lang={lang.id} aria-pressed={i === language} onClick={() => { setManual(true); setLanguage(i) }}>{lang.label}</button>)}</div>
    <div className="journey-menu-layout">
      <div className="journey-qr-paper"><a href="#landing-menu-preview" aria-label="홈 메뉴판 예시 열기"><QRCodeSVG value={previewUrl} size={104} marginSize={2} /></a><span>홈 메뉴판 예시 QR</span><i className="journey-scan-line" aria-hidden="true" /></div>
      <div className="journey-phone"><div className="journey-phone-camera" /><header><Citrus /><strong>{demo.store}</strong><small>메뉴판 화면 예시</small></header>
        <div className="journey-phone-menu" key={current.id} lang={current.id}><h4>{current.heading}</h4>
          <div className="journey-phone-photo"><img src={foodPhoto} alt="AI 김치찌개 예시" width={1254} height={1254} loading="lazy" /><span>AI 예시 사진</span></div>
          <strong>{current.name}</strong><p>{current.description}</p><b>₩8,000</b></div>
      </div>
    </div>
    <p className="journey-scene-note">이 예시 QR은 홈의 메뉴판 예시로 연결돼요.<br />실제 손님용 QR은 내 매장에서 확인·공개한 뒤 발급해요.</p>
  </div>
}

function OutcomeScene() {
  return <div className="journey-outcome-scene">
    <div className="journey-actual-card"><span>6월 5일 김치찌개 · 가상 발주 결과</span><div><span>예상 <b>20–24</b>인분</span><strong>판매 <b>23</b>인분</strong></div>
      <div className="journey-range" aria-hidden="true"><span /><i>23</i><small>20</small><small>24</small></div></div>
    <div className="journey-followup-card"><span>홍보 실행 전후 · 가상 POS</span><h4>같은 길이의 기간을 비교해요.</h4>
      <div><strong>김치찌개 판매량</strong><PairBars before={demo.outcome.quantities[0]} after={demo.outcome.quantities[1]} unit="인분" /></div>
      <div><strong>오후 2~5시 결제</strong><PairBars before={demo.outcome.afternoon[0]} after={demo.outcome.afternoon[1]} unit="건" /></div>
      <p>5월 18~31일 → 6월 1~14일<br />양쪽 모두 12영업일</p></div>
    <p className="journey-scene-note">실제 매장 성과가 아닌 가상 실행 결과예요.<br />전후 차이만으로 홍보 효과를 입증할 수 없어요.</p>
  </div>
}

function StoryStep({ index, motion, compact, children }: { index: number; motion: boolean; compact: boolean; children: (revealed: boolean) => ReactNode }) {
  const article = useRef<HTMLElement>(null)
  const copy = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const section = article.current, text = copy.current, viewport = frame.current, scene = ref.current
    if (!section || !text || !viewport || !scene) return
    let disposed = false
    function fit() {
      if (disposed) return
      const width = viewport!.clientWidth
      if (!width) return
      const nativeWidth = Math.min(600, width)
      scene!.style.width = `${nativeWidth}px`
      const naturalHeight = scene!.offsetHeight
      if (!naturalHeight) return
      const css = getComputedStyle(section!)
      const screenHeight = parseFloat(css.minHeight) || window.innerHeight
      const available = screenHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)
        - (compact ? text!.offsetHeight + parseFloat(css.rowGap) : 0) - 4
      const widthScale = width / nativeWidth
      // Keep the example readable on short screens; let the section grow rather than clip it.
      const scale = Math.min(1.35, widthScale, Math.max(Math.min(compact ? .76 : .8, widthScale), available / naturalHeight))
      const rounded = Math.floor(scale * 1000) / 1000
      viewport!.style.height = `${Math.ceil(naturalHeight * rounded)}px`
      scene!.style.transform = `scale(${rounded})`
      scene!.style.left = `${Math.max(0, (width - nativeWidth * rounded) / 2)}px`
      viewport!.dataset.fitted = 'true'
    }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    observer?.observe(viewport); observer?.observe(scene); observer?.observe(text)
    window.addEventListener('resize', fit)
    scene.addEventListener('load', fit, true)
    void document.fonts.ready.then(fit)
    return () => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', fit)
      scene.removeEventListener('load', fit, true)
    }
  }, [compact, expanded])
  useEffect(() => {
    if (!ref.current) return
    if (typeof IntersectionObserver === 'undefined') { setRevealed(true); return }
    const observer = new IntersectionObserver(([entry]) => setRevealed(entry.isIntersecting && entry.intersectionRatio >= .4), { threshold: .4 })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const step = landingSteps[index]
  return <article ref={article} id={`landing-step-${step.id}`} className="journey-step" aria-labelledby={`journey-title-${step.id}`}>
    <div className="journey-step-copy" ref={copy}><span className="journey-step-number">{step.eyebrow}</span><h3 id={`journey-title-${step.id}`}>{step.title.split('\n').map((line, i) => <span key={i}>{line}</span>)}</h3>
      <details className="journey-step-description" open={!compact || expanded} onToggle={e => { if (compact) setExpanded(e.currentTarget.open) }}>
      <summary>기능 설명·자료 안내</summary><p>{step.description}</p><small>{step.evidence}</small>
      {index === 0 && <a href={demo.sources.market} {...external}>제주데이터허브 원문 ↗</a>}
      {index === 3 && <div className="journey-public-sources"><a href={demo.sources.menuReview} {...external}>메뉴·후기 원문 ↗</a><a href={demo.sources.event} {...external}>당시 전시 소식 ↗</a></div>}
      </details>
    </div>
    <div className="journey-visual-frame" ref={frame}>
    <div className={`journey-stage journey-stage-${step.id}`} ref={ref} data-revealed={revealed} data-motion={motion ? 'on' : 'off'}>
      <div className="journey-stage-label"><span><Citrus /> {step.label}</span><small>{index === 0 ? '실제 상권 + 가상 POS' : index === 3 ? '공개자료 참고 · 초안 예시' : index === 4 ? '다국어 화면 예시' : '가상 시연 자료'}</small></div>
      {children(revealed)}
    </div>
    </div>
  </article>
}

export function LandingDemoStory() {
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { if (media.matches) setMotion(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id !== 'landing-menu-preview' && !landingSteps.some(step => id === `landing-step-${step.id}`)) return
    const frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [])
  return <section className="landing-demo-story" aria-labelledby="landing-demo-story-title">
    <div className="journey-intro-band"><div className="shell journey-story-intro"><span>가게짝꿍 주요 기능</span><h2 id="landing-demo-story-title">매출 분석부터<br />발주·홍보까지.</h2>
      <p>매출이 얼마나 달라졌는지 확인하고,<br />우리 가게에 필요한 발주와 홍보를 준비하세요.</p>
      <nav aria-label="홈 기능 소개 순서">{landingSteps.map((step, i) => <a key={step.id} href={`#landing-step-${step.id}`}><span>0{i + 1}</span>{step.label}</a>)}</nav>
      <p className="journey-demo-note"><strong>아래 화면은 기능 소개를 위한 예시입니다.</strong><br />2021년 애월 상권 공개자료와 더애월 공개정보를 참고했습니다. 매장 POS·재고·원가·실행 결과는 가상 자료입니다.</p>
      <label className="journey-motion-control"><input type="checkbox" checked={motion} onChange={e => setMotion(e.target.checked)} />움직임 효과</label>
    </div></div>
    <div className="shell journey-steps">
      <StoryStep index={0} motion={motion} compact={compact}>{() => <SalesScene />}</StoryStep>
      <StoryStep index={1} motion={motion} compact={compact}>{() => <EvidenceScene />}</StoryStep>
      <StoryStep index={2} motion={motion} compact={compact}>{() => <InventoryScene />}</StoryStep>
      <StoryStep index={3} motion={motion} compact={compact}>{() => <PromotionScene />}</StoryStep>
      <StoryStep index={4} motion={motion} compact={compact}>{revealed => <MenuScene revealed={revealed} motion={motion} />}</StoryStep>
      <StoryStep index={5} motion={motion} compact={compact}>{() => <OutcomeScene />}</StoryStep>
    </div>
  </section>
}
