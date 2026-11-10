import { useState } from 'react'
import { formatQuantity, parseQuantity, quantities, shortageOf } from '../data/inventory'
import { formatNumber, monthLabel } from '../data/shop'
import type { Analysis, InventoryItem } from '../data/shop'

import { InventoryImport } from './InventoryImport'

export function InventoryReview({ items, analysis, reviewDate, onChange, onSave }: {
  items: InventoryItem[]
  analysis: Analysis
  reviewDate: string
  onChange: (items: InventoryItem[]) => void
  onSave?: (items: InventoryItem[]) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const months = analysis.monthly.slice(-2)
  const recorded = items.filter((item) =>
    item.name.trim() && item.unit.trim() && shortageOf(item) !== null,
  ).length

  function updateItems(next: InventoryItem[]) {
    setMessage('')
    setError('')
    onChange(next)
  }

  async function save() {
    if (!onSave || saving) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await onSave(items)
      setMessage('발주 검토표를 저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '발주 검토표를 저장할 수 없어요.')
    } finally {
      setSaving(false)
    }
  }

  function addItem() {
    updateItems([...items, {
      id: crypto.randomUUID(),
      name: '',
      unit: '',
      stock: '',
      expectedUse: '',
      incoming: '',
      finalOrder: '',
    }])
  }

  return <section className="execution-material inventory-review">
    <div className="section-top ruled">
      <h2>발주량 검토표</h2>
      <span className="badge" aria-live="polite">{recorded} / {items.length}품목 기록</span>
    </div>
    <div className="receipt">
      <p>다음 발주분이 들어오기 전까지 쓸 양과 그전에 들어올 물량을 입력해 주세요. 예정된 입고가 없다면 0을 입력해요.</p>
      <p className="muted">발주 검토 예정일 · {reviewDate}</p>
      {analysis.productSales?.length ? <details className="ruled-block" open>
        <summary>POS 품목별 판매량 참고</summary>
        <p className="muted">판매량을 참고해 발주 품목의 사용량을 정해 주세요. 메뉴 판매량과 재료 사용량의 단위는 다를 수 있어요.</p>
        <table className="input-table" aria-label="발주 검토용 POS 품목별 판매량">
          <thead><tr><th scope="col">상품명</th>
            {months.map(({ month }) => <th scope="col" key={month}>{monthLabel(month)}</th>)}
          </tr></thead>
          <tbody>{analysis.productSales.map((product) => <tr key={product.productName}>
            <th scope="row">{product.productName}</th>
            <td>{formatNumber(product.before)}개</td><td>{formatNumber(product.after)}개</td>
          </tr>)}</tbody>
        </table>
      </details> : <p className="muted">이 분석에 저장된 POS 품목별 판매량이 없어요.</p>}
      <fieldset disabled={saving} aria-label="발주 검토 입력">
      <InventoryImport onImport={(imported) => updateItems([...items, ...imported])} />
      <div className="inventory-rows">
        {items.map((item, index) => {
          const shortage = item.shortage ?? shortageOf(item)
          const unit = item.unit.trim()
          function update(field: Exclude<keyof InventoryItem, 'id' | 'shortage'>, value: string) {
            updateItems(items.map((row) => row.id === item.id ? { ...row, [field]: value, shortage: undefined } : row))
          }
          return <fieldset key={item.id} className="inventory-row">
            <legend>품목 {index + 1}</legend>
            <div className="inventory-fields">
              <label>품목명<input value={item.name} maxLength={50} onChange={(event) => update('name', event.target.value)} placeholder="예: 쌀" /></label>
              <label>단위<input value={item.unit} maxLength={12} onChange={(event) => update('unit', event.target.value)} placeholder="예: kg, 개" /></label>
              {quantities.map(({ key, label }) => <label key={key}>{key === 'incoming' ? '입고 예정량' : label}
                <input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" value={item[key]} aria-invalid={item[key] !== '' && parseQuantity(item[key]) === null} onChange={(event) => update(key, event.target.value)} />
              </label>)}
              <div className="inventory-shortage">
                <span>부족 수량</span>
                <output aria-live="polite">{shortage !== null && unit ? `${formatQuantity(shortage)} ${unit}` : '추가 입력 필요'}</output>
              </div>
              <label>최종 발주량
                <input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" value={item.finalOrder} aria-invalid={item.finalOrder !== '' && parseQuantity(item.finalOrder) === null} onChange={(event) => update('finalOrder', event.target.value)} />
              </label>
              <button type="button" className="text-button inventory-remove" aria-label={`품목 ${index + 1} 삭제`} onClick={() => updateItems(items.filter((row) => row.id !== item.id))}>삭제</button>
            </div>
          </fieldset>
        })}
      </div>
      <button type="button" className="button secondary small inventory-add" onClick={addItem}>+ 품목 추가</button>
      </fieldset>
      {items.length > 0 && <p className="muted inventory-hint">수량은 품목마다 같은 단위로, 소수점 셋째 자리까지 입력해 주세요. 최종 발주량은 주문 단위와 여유분을 고려해 정할 수 있어요.</p>}
      {onSave && <button type="button" className="button primary small" disabled={saving} onClick={() => void save()}>
        {saving ? '저장 중…' : '발주 검토표 저장'}
      </button>}
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </section>
}
