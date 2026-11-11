import { formatNumber, monthLabel, won } from '../data/shop'
import type { MonthlySales } from '../data/shop'

export function MonthlySalesChart({ monthly }: { monthly: MonthlySales[] }) {
  const maximum = Math.max(1, ...monthly.map(({ amount }) => amount))
  const roughStep = Math.max(1, maximum / 4)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const multiplier = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= roughStep) ?? 10
  const step = Math.ceil(multiplier * magnitude)
  const ceiling = 4 * step
  const latestMonth = monthly.at(-1)?.month

  return <div className="monthly-plot">
    <div className="monthly-scale" aria-hidden="true">
      {[4, 3, 2, 1, 0].map(tick => <span key={tick}>
        {tick === 0 ? '0' : step >= 10_000 ? `${formatNumber(step * tick / 10_000)}만` : formatNumber(step * tick)}
      </span>)}
    </div>
    <div className="monthly-plot-scroll">
      <ul className="monthly-columns" aria-label="월별 매출 비교">
        {monthly.map(({ month, amount }) => {
          const height = `${(amount / ceiling) * 100}%`
          return <li key={month}>
            <span className="monthly-column-month">{monthLabel(month)}</span>
            <span className="monthly-column-track">
              <span className={`monthly-column-bar${month === latestMonth ? ' latest' : ''}`} style={{ height }} aria-hidden="true" />
              <strong style={{ bottom: height }}>{won(amount)}</strong>
            </span>
          </li>
        })}
      </ul>
    </div>
  </div>
}
