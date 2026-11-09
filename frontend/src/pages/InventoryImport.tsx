import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { formatQuantity, inventoryTemplate, parseInventoryCsv, shortageOf } from '../data/inventory'
import type { InventoryItem } from '../data/shop'

const templateUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(inventoryTemplate)
const previewLimit = 10

export function InventoryImport({ onImport }: { onImport: (items: InventoryItem[]) => void }) {
  const [preview, setPreview] = useState<{ name: string; rows: ReturnType<typeof parseInventoryCsv> }>()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setPreview(undefined)
    setError('')
    setMessage('')
    setReading(true)
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('CSV(.csv) 파일을 선택해 주세요.')
      if (file.size > 1024 * 1024) throw new Error('1MB 이하의 CSV 파일을 선택해 주세요.')
      const bytes = await file.arrayBuffer()
      let contents: string
      try {
        contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        contents = new TextDecoder('euc-kr').decode(bytes)
      }
      setPreview({ name: file.name, rows: parseInventoryCsv(contents) })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '파일을 읽을 수 없어요.')
    } finally {
      setReading(false)
    }
  }

  function importItems() {
    if (!preview) return
    onImport(preview.rows.map((row) => ({ ...row, id: crypto.randomUUID(), finalOrder: '' })))
    setMessage(`${preview.rows.length}품목을 검토표에 추가했어요.`)
    setPreview(undefined)
  }

  return <div className="inventory-import">
    <div className="inventory-import-title">
      <strong>CSV로 한 번에 채우기</strong>
      <a href={templateUrl} download="가게짝꿍-발주량-검토-양식.csv">CSV 양식 내려받기 ↓</a>
    </div>
    <p className="muted">양식의 예시 행을 실제 품목으로 바꿔 올려주세요. 기존 품목은 그대로 두고 새 품목으로 추가해요.</p>
    <label className="file-picker inventory-file">발주용 CSV 선택
      <input type="file" accept=".csv,text/csv" disabled={reading} onChange={selectFile} />
    </label>
    {reading && <p role="status">파일을 읽고 있어요.</p>}
    {error && <p role="alert" className="inventory-csv-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {preview && <section className="inventory-preview" aria-label="CSV 미리보기">
      <h3>CSV 미리보기</h3>
      <p>{preview.name} · {preview.rows.length}품목{preview.rows.length > previewLimit && ` 중 처음 ${previewLimit}품목 표시`}</p>
      <ul>
        {preview.rows.slice(0, previewLimit).map((row, index) => {
          const shortage = shortageOf(row)
          return <li key={index}>
            <strong>{row.name || `품목 ${index + 1}`}</strong>
            <span>{!row.name || !row.unit || shortage === null ? '추가 입력 필요' : `발주 제안량 ${formatQuantity(shortage)} ${row.unit}`}</span>
          </li>
        })}
      </ul>
      <div className="promo-actions">
        <button type="button" className="button primary small" onClick={importItems}>{preview.rows.length}품목 추가하기</button>
        <button type="button" className="button secondary small" onClick={() => setPreview(undefined)}>취소</button>
      </div>
    </section>}
  </div>
}
