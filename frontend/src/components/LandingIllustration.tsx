import { useRef, type ReactNode } from 'react'
import { LandingBranchMotion } from './LandingBranchMotion'

const shopIllustration = new URL('../assets/jeju-neighborhood-shop.jpg', import.meta.url).href
const leafPaths = ['canopy', 'branch', 'eave', 'lane', 'lane-trail'] as const
const leafPhases = [0, 1, 2, 3] as const
const fallingLeaves = leafPaths.flatMap(path => leafPhases.map(phase => ({ path, phase })))

export function LandingIllustration({ children }: { children: ReactNode }) {
  const artwork = useRef<HTMLImageElement>(null)

  return <>
    <div className="landing-artwork-frame">
      <div className="landing-artwork-scene">
        <div className="landing-artwork-plane">
          <img ref={artwork} className="landing-artwork" src={shopIllustration}
            alt="현무암 돌담과 귤 상자가 놓인 제주 동네 가게"
            width={1536} height={1024} fetchPriority="high" />
          <div className="landing-breeze" aria-hidden="true">
            <LandingBranchMotion artwork={artwork} />
            {fallingLeaves.map(({ path, phase }) => (
              <span
                key={`${path}-${phase}`}
                className={`landing-wind-leaf landing-wind-leaf-${path}`}
                data-phase={phase}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
    {children}
  </>
}