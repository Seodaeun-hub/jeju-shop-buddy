import { useEffect, useRef, type RefObject } from 'react'

const artworkWidth = 1536
const artworkHeight = 1024

// Bounds are measured on the original illustration.
const branchTips = [
  { id: 'near', x: 294, y: 342, width: 178, height: 103, anchor: 'top', sway: 14.4, phase: 0 },
  { id: 'canopy', x: 632, y: 60, width: 127, height: 104, anchor: 'top', sway: 13.2, phase: 0.22 },
  { id: 'lane', x: 1250, y: 288, width: 147, height: 121, anchor: 'bottom', sway: 15.6, phase: 0.43 },
] as const

type BranchTip = typeof branchTips[number]

function cutOutFoliage(image: HTMLImageElement, tip: BranchTip) {
  const cutout = document.createElement('canvas')
  cutout.width = tip.width
  cutout.height = tip.height
  const context = cutout.getContext('2d')
  if (!context) return cutout

  context.drawImage(image, tip.x, tip.y, tip.width, tip.height, 0, 0, tip.width, tip.height)
  const pixels = context.getImageData(0, 0, tip.width, tip.height)
  const colors = pixels.data

  for (let offset = 0; offset < colors.length; offset += 4) {
    const red = colors[offset]
    const green = colors[offset + 1]
    const blue = colors[offset + 2]
    // The leaves are olive green. The wall and its shadows are warmer.
    const foliageTone = green - red + 0.48 * (green - blue)
    const coverage = Math.min((foliageTone - 5) / 13, (green - blue - 14) / 13)
    colors[offset + 3] = Math.round(Math.max(0, Math.min(1, coverage)) * 255)
  }

  context.putImageData(pixels, 0, 0)
  return cutout
}

export function LandingBranchMotion({ artwork }: { artwork: RefObject<HTMLImageElement | null> }) {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const image = artwork.current
    const element = layer.current
    if (!image || !element) return

    const canvases = [...element.querySelectorAll('canvas')]
    const contexts = canvases.map(canvas => canvas.getContext('2d'))
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let previous = -Infinity
    let visible = true
    let cutouts: HTMLCanvasElement[] = []

    const paint = (time: number) => {
      if (time - previous >= 32) {
        previous = time
        branchTips.forEach((tip, index) => {
          const context = contexts[index]
          const cutout = cutouts[index]
          if (!context || !cutout) return
          context.clearRect(0, 0, tip.width, tip.height)

          const wave = time / 950 - tip.phase
          const bend = tip.sway * (Math.sin(wave) + 0.23 * Math.sin(wave * 2.17)) / 1.23

          for (let row = 0; row < tip.height; row += 1) {
            const heightRatio = row / (tip.height - 1)
            const distance = tip.anchor === 'top' ? heightRatio : 1 - heightRatio
            const shift = bend * distance ** 1.3
            context.drawImage(cutout, 0, row, tip.width, 1, shift, row, tip.width, 1)
          }
        })
      }
      frame = requestAnimationFrame(paint)
    }

    const sync = () => {
      cancelAnimationFrame(frame)
      if (!motion.matches && visible && image.complete && image.naturalWidth) {
        if (cutouts.length === 0) cutouts = branchTips.map(tip => cutOutFoliage(image, tip))
        frame = requestAnimationFrame(paint)
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      sync()
    })
    observer.observe(element)
    image.addEventListener('load', sync)
    motion.addEventListener('change', sync)
    sync()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      image.removeEventListener('load', sync)
      motion.removeEventListener('change', sync)
    }
  }, [artwork])

  return (
    <div ref={layer} className="landing-branch-motion">
      {branchTips.map(tip => (
        <canvas
          key={tip.id}
          className={`landing-branch-tip landing-branch-tip-${tip.id}`}
          width={tip.width}
          height={tip.height}
          style={{
            left: `${tip.x / artworkWidth * 100}%`,
            top: `${tip.y / artworkHeight * 100}%`,
            width: `${tip.width / artworkWidth * 100}%`,
            height: `${tip.height / artworkHeight * 100}%`,
          }}
        />
      ))}
    </div>
  )
}