import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { fetchMenuCost, listMenuCosts, saveMenuCost, type MenuCost } from '../api/shop'
import { won } from '../data/shop'
import { ReceiptCostDialog } from './ReceiptCostDialog'

type DraftRow = {
  id: string
  ingredientName: string
  unit: string
  amount: string
  unitPrice: string
}

function draftRows(ingredients: MenuCost['ingredients']): DraftRow[] {
  return ingredients.map(({ ingredientName, unit, amount, unitPriceWon }) => ({
    id: crypto.randomUUID(), ingredientName, unit, amount,
    unitPrice: unitPriceWon == null ? '' : String(unitPriceWon),
  }))
}

function ingredientCost(row: DraftRow): bigint | null {
  if (!/^\d{1,10}(\.\d{1,3})?$/.test(row.amount) || !/^\d+$/.test(row.unitPrice)) return null
  const [whole, fraction = ''] = row.amount.split('.')
  const amount = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
  const unitPrice = BigInt(row.unitPrice)
  if (amount === 0n || amount > 1_000_000_000_000n || unitPrice > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return amount * unitPrice
}

const wonInteger = new Intl.NumberFormat('ko-KR')
const preciseWon = (value: bigint) => {
  const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  return `${wonInteger.format(value / 1000n)}${fraction ? '.' + fraction : ''}원`
}

export function MenuCosts({ auth, storeId, initialProduct, backTo, onProduct }: {
  auth: string; storeId: string; initialProduct?: string; backTo?: string; onProduct?: (product: string) => void
}) {
  const [menu, setMenu] = useState<string[]>()
  const [product, setProduct] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listMenuCosts(auth, storeId, controller.signal).then(values => {
      if (controller.signal.aborted) return
      const requested = initialProduct?.trim()
      const available = requested && requested.length <= 255 && !values.includes(requested)
        ? [...values, requested] : values
      setMenu(available)
      setProduct(current => available.includes(current) ? current
        : requested && available.includes(requested) ? requested : available[0] ?? '')
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, storeId, initialProduct, retry])

  return <section className="form-stack menu-costs" aria-labelledby="menu-costs-title">
    <div className="section-top ruled">
      <div>
        <h2 id="menu-costs-title">메뉴 재료·원가</h2>
        <p className="muted">한 개당 재료 사용량과 단가를 저장해요. 발주 검토에서는 사용량을, 홍보 검토에서는 합산 원가를 자동으로 불러와요.</p>
      </div>
    </div>
    {error ? <p role="alert" className="error">{error} <button className="text-button" onClick={() => {
      setError('')
      setRetry(value => value + 1)
    }}>다시 불러오기</button></p> : !menu ? <p role="status">메뉴를 불러오는 중이에요.</p>
      : menu.length ? <label className="menu-cost-product">메뉴 선택
        <select value={product} onChange={event => { setProduct(event.target.value); onProduct?.(event.target.value) }}>
          {menu.map(name => <option key={name}>{name}</option>)}
        </select>
      </label> : <p>POS로 메뉴를 불러오거나 메뉴 사진 관리에서 메뉴를 등록해 주세요.</p>}
    {backTo && <Link className="button secondary small" to={backTo}>발주 검토로 돌아가기</Link>}
    {product && <MenuCostEditor key={product} auth={auth} storeId={storeId} product={product} backTo={backTo} />}
  </section>
}

function MenuCostEditor({ auth, storeId, product, backTo }: {
  auth: string; storeId: string; product: string; backTo?: string
}) {
  const [original, setOriginal] = useState<MenuCost>()
  const [rows, setRows] = useState<DraftRow[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const title = useId()

  useEffect(() => {
    const controller = new AbortController()
    fetchMenuCost(auth, storeId, product, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setOriginal(result)
      setRows(draftRows(result.ingredients))
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, storeId, product, retry])

  const costs = rows.map(ingredientCost)
  const complete = rows.length > 0 && costs.every(cost => cost !== null)
  const rounded = (costs.reduce<bigint>((sum, cost) => sum + (cost ?? 0n), 0n) + 500n) / 1000n
  const costWon = complete && rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null
  const costChange = original?.costWon != null && costWon != null ? costWon - original.costWon : 0
  const price = original?.priceWon
  const margin = price != null && costWon != null ? price - costWon : null

  function changeRows(next: DraftRow[]) {
    setRows(next)
    setError('')
    setMessage('')
    setSaved(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || costWon === null) return
    setSaving(true)
    setSaved(false)
    setError('')
    setMessage('')
    try {
      const saved = await saveMenuCost(auth, storeId, product, rows.map(row => ({
        ingredientName: row.ingredientName.trim(), unit: row.unit.trim(), amount: row.amount,
        unitPriceWon: Number(row.unitPrice),
      })))
      setOriginal({ ...saved, priceWon: price ?? null })
      setRows(current => current.map((row, index) => ({
        ...row, ingredientName: saved.ingredients[index].ingredientName,
        unit: saved.ingredients[index].unit, amount: saved.ingredients[index].amount,
      })))
      setMessage('재료 사용량과 원가를 저장했어요. 발주·홍보 검토에서 이 값을 불러와요.')
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '원가를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  if (!original) return error ? <p role="alert" className="error">{error} <button className="text-button" onClick={() => {
    setError('')
    setRetry(value => value + 1)
  }}>다시 불러오기</button></p> : <p role="status">메뉴 원가를 불러오는 중이에요.</p>

  return <><form className="form-stack" onSubmit={submit} aria-labelledby={title}>
    <div className="section-top ruled">
      <div>
        <h3 id={title}>{product} 재료 사용량·원가</h3>
        {original.costWon === null && original.ingredients.length > 0 &&
          <p className="muted">발주 검토에 저장한 재료 사용량을 불러왔어요.</p>}
      </div>
      <div className="actions pos-library-heading-actions">
        <button className="button secondary small" type="button" disabled={saving} onClick={() => setReceiptOpen(true)}>영수증에서 단가 읽기</button>
        <button className="button secondary small" type="button" disabled={saving || rows.length >= 100}
          onClick={() => changeRows([...rows, { id: crypto.randomUUID(), ingredientName: '', unit: '', amount: '', unitPrice: '' }])}>재료 추가</button>
      </div>
    </div>
    {rows.length === 0 && <p className="muted">재료를 추가해 사용량과 단가를 입력해 주세요.</p>}
    <div className="menu-cost-rows">
      {rows.map((row, index) => {
        const cost = costs[index]
        const previous = original.ingredients.find(ingredient =>
          ingredient.ingredientName === row.ingredientName.trim() && ingredient.unit === row.unit.trim())
        const previousCost = previous?.unitPriceWon == null ? null : ingredientCost({
          ...row, amount: previous.amount, unitPrice: String(previous.unitPriceWon),
        })
        const change = cost != null && previousCost != null ? cost - previousCost : 0n
        const update = (key: 'ingredientName' | 'unit' | 'amount' | 'unitPrice', value: string) =>
          changeRows(rows.map(item => item.id === row.id ? { ...item, [key]: value } : item))
        return <fieldset className="menu-cost-row" key={row.id} disabled={saving} aria-label={`재료 ${index + 1}`}>
          <label>재료명<input required maxLength={50} value={row.ingredientName}
            onChange={event => update('ingredientName', event.target.value)} /></label>
          <label>단위<input required maxLength={12} placeholder="kg" value={row.unit}
            onChange={event => update('unit', event.target.value)} /></label>
          <label>한 개당 사용량<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,3})?" value={row.amount}
            onChange={event => update('amount', event.target.value)} /></label>
          <label>{row.unit.trim() || '단위'}당 단가 (원)<input required inputMode="numeric" pattern="[0-9]+" maxLength={16}
            value={row.unitPrice} onChange={event => update('unitPrice', event.target.value)} /></label>
          <div className="menu-cost-row-result">
            <small className="muted">한 개당 재료비</small>
            <strong>{cost == null ? '—' : preciseWon(cost)}</strong>
            {change !== 0n && <small className="muted">저장한 원가 대비 {preciseWon(change < 0n ? -change : change)} {change > 0n ? '증가' : '감소'}</small>}
          </div>
          <button className="text-button" type="button" aria-label={`${row.ingredientName || `재료 ${index + 1}`} 삭제`}
            onClick={() => changeRows(rows.filter(item => item.id !== row.id))}>삭제</button>
        </fieldset>
      })}
    </div>
    <dl className="menu-cost-totals" aria-live="polite">
      <div><dt>한 개당 합산 원가</dt><dd>{costWon === null ? '—' : won(costWon)}</dd>
        {costChange !== 0 && <small className="muted">저장한 합산 원가 대비 {won(Math.abs(costChange))} {costChange > 0 ? '증가' : '감소'}</small>}
      </div>
      <div><dt>최근 POS 판매가</dt><dd>{price == null ? '—' : won(price)}</dd></div>
      <div><dt>재료비를 빼고 남는 금액</dt><dd>{margin == null ? '—' : won(margin)}</dd></div>
    </dl>
    <p className="muted">합산 재료비는 원 단위로 반올림해요. 남는 금액은 판매가에서 재료비만 뺀 값이에요.</p>
    <div className="actions">
      <button className="button primary" disabled={saving || costWon === null}>{saving ? '저장 중…' : '재료·원가 저장'}</button>
    </div>
    {message && <p role="status">{message}</p>}
    {saved && backTo && <Link className="button secondary" to={backTo}>저장한 사용량으로 발주 검토하기</Link>}
    {error && <p role="alert" className="error">{error}</p>}
  </form>
  {receiptOpen && <ReceiptCostDialog auth={auth} storeId={storeId}
    targets={rows.filter(row => row.ingredientName && row.unit).map(row => ({ name: row.ingredientName, unit: row.unit }))}
    onClose={() => setReceiptOpen(false)} onApply={values => {
      const next = rows.slice()
      for (const { name, unit, unitPrice } of values) {
        const index = next.findIndex(row => row.ingredientName.trim() === name && row.unit.trim() === unit)
        if (index < 0) next.push({ id: crypto.randomUUID(), ingredientName: name, unit, amount: '', unitPrice: String(unitPrice) })
        else next[index] = { ...next[index], unitPrice: String(unitPrice) }
      }
      if (next.length > 100) {
        setReceiptOpen(false)
        setError('메뉴당 재료는 최대 100개까지 저장할 수 있어요.')
        return
      }
      changeRows(next)
      setReceiptOpen(false)
      setMessage('단가를 입력했어요. 원가를 확인하고 저장해 주세요.')
    }} />}
  </>
}
