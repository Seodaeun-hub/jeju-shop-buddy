import { formatQuantity, parseQuantity, quantities, shortageOf } from '../data/inventory'
import type { InventoryItem } from '../data/shop'

import { InventoryImport } from './InventoryImport'

export function InventoryReview({ items, reviewDate, onChange }: {
  items: InventoryItem[]
  reviewDate: string
  onChange: (items: InventoryItem[]) => void
}) {
  const recorded = items.filter((item) =>
    item.name.trim() && item.unit.trim() && shortageOf(item) !== null && parseQuantity(item.finalOrder) !== null,
  ).length

  function addItem() {
    onChange([...items, {
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
      <InventoryImport onImport={(imported) => onChange([...items, ...imported])} />
      <div className="inventory-rows">
        {items.map((item, index) => {
          const shortage = shortageOf(item)
          const unit = item.unit.trim()
          function update(field: Exclude<keyof InventoryItem, 'id'>, value: string) {
            onChange(items.map((row) => row.id === item.id ? { ...row, [field]: value } : row))
          }
          return <fieldset key={item.id} className="inventory-row">
            <legend>품목 {index + 1}</legend>
            <div className="inventory-fields">
              <label>품목명<input value={item.name} maxLength={50} onChange={(event) => update('name', event.target.value)} placeholder="예: 쌀" /></label>
              <label>단위<input value={item.unit} maxLength={12} onChange={(event) => update('unit', event.target.value)} placeholder="예: kg, 개" /></label>
              {quantities.map(({ key, label }) => <label key={key}>{label}
                <input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" value={item[key]} aria-invalid={item[key] !== '' && parseQuantity(item[key]) === null} onChange={(event) => update(key, event.target.value)} />
              </label>)}
              <div className="inventory-shortage">
                <span>발주 제안량</span>
                <output aria-live="polite">{shortage !== null && unit ? `${formatQuantity(shortage)} ${unit}` : '추가 입력 필요'}</output>
              </div>
              <label>최종 발주량
                <input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" value={item.finalOrder} aria-invalid={item.finalOrder !== '' && parseQuantity(item.finalOrder) === null} onChange={(event) => update('finalOrder', event.target.value)} />
              </label>
              <button type="button" className="text-button inventory-remove" aria-label={`품목 ${index + 1} 삭제`} onClick={() => onChange(items.filter((row) => row.id !== item.id))}>삭제</button>
            </div>
          </fieldset>
        })}
      </div>
      <button type="button" className="button secondary small inventory-add" onClick={addItem}>+ 품목 추가</button>
      {items.length > 0 && <p className="muted inventory-hint">수량은 품목마다 같은 단위로, 소수점 셋째 자리까지 입력해 주세요. 최종 발주량은 주문 단위와 여유분을 고려해 정할 수 있어요.</p>}
    </div>
  </section>
}
