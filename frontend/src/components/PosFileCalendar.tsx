import { addDays } from '../data/shop'

const dayLabel = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'UTC' })
const weekdays = ['월', '화', '수', '목', '금', '토', '일']

export function PosFileCalendar({ month, today, selected, counts, disabled, onMonth, onSelect }: {
  month: string; today: string; selected: string; counts: Map<string, number>; disabled: boolean
  onMonth: (month: string) => void; onSelect: (date: string) => void
}) {
  const first = month + '-01'
  const [year, monthNumber] = month.split('-')
  const daysInMonth = new Date(Date.UTC(Number(year), Number(monthNumber), 0)).getUTCDate()
  const leading = (new Date(first).getUTCDay() + 6) % 7
  const size = Math.ceil((leading + daysInMonth) / 7) * 7
  const currentYear = Number(today.slice(0, 4))
  const oldestYear = Math.min(currentYear - 9, Number(year), ...[...counts.keys()].map(date => Number(date.slice(0, 4))))
  const years = Array.from({ length: currentYear - oldestYear + 1 }, (_, index) => currentYear - index)
  const monthLimit = Number(year) === currentYear ? Number(today.slice(5, 7)) : 12

  return <section className="pos-calendar" aria-label="POS 기록 달력">
    <div className="pos-calendar-navigation">
      <select aria-label="달력 연도" value={year} disabled={disabled} onChange={event => {
        const nextMonth = event.target.value + '-' + monthNumber
        onMonth(nextMonth > today.slice(0, 7) ? today.slice(0, 7) : nextMonth)
      }}>
        {years.map(value => <option key={value} value={value}>{value}년</option>)}
      </select>
      <select aria-label="달력 월" value={monthNumber} disabled={disabled}
        onChange={event => onMonth(year + '-' + event.target.value)}>
        {Array.from({ length: monthLimit }, (_, index) => index + 1).map(value =>
          <option key={value} value={String(value).padStart(2, '0')}>{value}월</option>)}
      </select>
      <button type="button" className="text-button pos-calendar-today" disabled={disabled} onClick={() => onSelect(today)}>오늘</button>
    </div>
    <div className="pos-calendar-grid">
      {weekdays.map(day => <span key={day} className="pos-calendar-weekday">{day}</span>)}
      {Array.from({ length: size }, (_, index) => addDays(first, index - leading)).map(date => {
        if (!date.startsWith(month)) return <span key={date} className="pos-calendar-empty" aria-hidden="true" />
        const count = counts.get(date) ?? 0
        return <button key={date} type="button" className="pos-calendar-day"
          aria-label={dayLabel.format(new Date(date)) + (date === today ? ', 오늘' : '') + (count ? `, POS ${count}개 등록` : '')}
          aria-current={date === today ? 'date' : undefined} aria-pressed={date === selected}
          disabled={disabled || date > today} onClick={() => onSelect(date)}>
          <span>{Number(date.slice(-2))}</span>
          {count > 0 && <small aria-hidden="true">{count}개</small>}
        </button>
      })}
    </div>
  </section>
}
