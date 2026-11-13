import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { readMenuReceipt, type ReceiptLine } from '../api/shop'
import { won } from '../data/shop'

type ReceiptValue = { name: string; unit: string; unitPrice: number }
type EditableLine = { name: string; unit: string; quantity: string; total: string; selected: boolean }
const maxImageSize = 3 * 1024 * 1024

function parseLine(line: EditableLine): ReceiptValue | null {
  const name = line.name.trim()
  const unit = line.unit.trim()
  if (!name || name.length > 50 || !unit || unit.length > 12 ||
    !/^\d{1,10}(\.\d{1,3})?$/.test(line.quantity) || !/^\d{1,16}$/.test(line.total)) return null
  const [whole, decimals = ''] = line.quantity.split('.')
  const quantity = BigInt(whole) * 1000n + BigInt(decimals.padEnd(3, '0'))
  const total = BigInt(line.total)
  if (!quantity || total > BigInt(Number.MAX_SAFE_INTEGER)) return null
  const price = (total * 2000n + quantity) / (2n * quantity)
  return price <= BigInt(Number.MAX_SAFE_INTEGER) ? { name, unit, unitPrice: Number(price) } : null
}

function asDraft(line: ReceiptLine): EditableLine {
  return { name: line.name, unit: line.unit ?? '', quantity: line.quantity ?? '',
    total: line.totalWon == null ? '' : String(line.totalWon), selected: false }
}

function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('사진을 열지 못했어요.'))
    reader.readAsDataURL(file)
  })
}

export function ReceiptCostDialog({ auth, storeId, targets, onClose, onApply }: {
  auth: string; storeId: string; targets: { name: string; unit: string }[]
  onClose: () => void; onApply: (values: ReceiptValue[]) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController>(null)
  const title = useId()
  const [file, setFile] = useState<File>()
  const [rows, setRows] = useState<EditableLine[]>()
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { request.current?.abort(); element?.close() }
  }, [])

  async function read() {
    if (!file || reading) return
    if (!['image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > maxImageSize) {
      setError('3MB 이하의 JPG 또는 PNG 파일을 골라 주세요.')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setReading(true)
    setError('')
    setRows(undefined)
    try {
      const image = await toDataUrl(file)
      controller.signal.throwIfAborted()
      const draft = await readMenuReceipt(auth, storeId, image, controller.signal)
      if (!controller.signal.aborted) setRows(draft.lines.map(asDraft))
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '사진을 읽지 못했어요.')
    } finally {
      if (!controller.signal.aborted) setReading(false)
    }
  }

  function update(index: number, changes: Partial<EditableLine>) {
    setError('')
    setRows(items => items?.map((row, i) => i === index ? { ...row, ...changes } : row))
  }

  function apply(event: FormEvent) {
    event.preventDefault()
    const picked = rows?.filter(line => line.selected).map(parseLine) ?? []
    if (!picked.length || picked.some(value => value == null)) {
      setError('선택한 품목의 재료명, 단위, 구매량, 금액을 확인해 주세요.')
      return
    }
    const values = picked.filter(value => value !== null)
    if (new Set(values.map(value => JSON.stringify([value.name, value.unit]))).size !== values.length) {
      setError('같은 이름과 단위의 재료는 한 줄만 선택해 주세요.')
      return
    }
    onApply(values)
  }

  return <dialog ref={dialog} className="pos-coverage-dialog receipt-cost-dialog" aria-labelledby={title}
    onCancel={e => { e.preventDefault(); onClose() }}>
    <form className="form-stack" onSubmit={apply}>
      <h3 id={title}>영수증에서 단가 읽기</h3>
      <p>결제 정보와 개인정보가 가려진 사진을 선택해 주세요. 읽은 품목과 금액은 적용 전에 직접 고칠 수 있어요.</p>
      <div className="section-top">
        <label>영수증 사진<input type="file" accept="image/jpeg,image/png" disabled={reading} onChange={e => {
          setFile(e.target.files?.[0]); setRows(undefined); setError('')
        }} /></label>
        <button className="button secondary" type="button" disabled={!file || reading} onClick={() => void read()}>
          {reading ? '읽는 중…' : '사진 읽기'}
        </button>
      </div>
      {reading && <p role="status">구매 품목과 단가를 확인하고 있어요.</p>}
      {rows?.length === 0 && <p>읽을 수 있는 구매 품목이 없어요. 사진을 바꾸거나 단가를 직접 입력해 주세요.</p>}
      {rows && rows.length > 0 && <>
        {targets.length > 0 && <p className="muted">현재 재료 · {targets.map(item => item.name + ' (' + item.unit + ')').join(', ')}</p>}
        {rows.map((line, index) => {
          const value = parseLine(line)
          return <fieldset className="receipt-cost-row" key={index} aria-label={'읽은 품목 ' + (index + 1)}>
            <label className="receipt-cost-select"><input type="checkbox" checked={line.selected}
              onChange={e => update(index, { selected: e.target.checked })} /> 적용할 품목</label>
            <label>재료명<input value={line.name} maxLength={50} onChange={e => update(index, { name: e.target.value })} /></label>
            <label>단위<input value={line.unit} maxLength={12} onChange={e => update(index, { unit: e.target.value })} /></label>
            <label>구매량<input inputMode="decimal" value={line.quantity} onChange={e => update(index, { quantity: e.target.value })} /></label>
            <label>구매 금액 (원)<input inputMode="numeric" value={line.total} onChange={e => update(index, { total: e.target.value })} /></label>
            <div className="menu-cost-row-result"><small className="muted">단위당 단가</small>
              <strong>{value ? won(value.unitPrice) : '확인 필요'}</strong></div>
          </fieldset>
        })}
        <p className="muted">이름과 단위가 같은 재료는 단가를 채워요. 새 재료는 한 개당 사용량을 입력한 뒤 메뉴 원가를 저장해 주세요.</p>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions end">
        <button className="button secondary" type="button" onClick={onClose}>닫기</button>
        <button className="button primary" type="submit" disabled={reading || !rows?.some(line => line.selected)}>선택한 단가 적용</button>
      </div>
    </form>
  </dialog>
}
