import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { deletePosFile, listPosFiles, uploadPosFile } from '../api/shop'
import type { PosFileKind, StoredPosFile } from '../api/shop'

const fileKinds = { PAYMENT: '결제 내역', PRODUCT: '상품 주문' }
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' })

export function StorePosFiles({ auth, storeId }: { auth: string; storeId: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<StoredPosFile[]>()
  const [kind, setKind] = useState<PosFileKind>('PAYMENT')
  const [selected, setSelected] = useState<File>()
  const [operation, setOperation] = useState<'upload' | 'delete'>()
  const busy = Boolean(operation)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listPosFiles(auth, storeId, controller.signal).then(value => {
      if (!controller.signal.aborted) setFiles(value)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setLoadError(failure.message)
    })
    return () => controller.abort()
  }, [auth, storeId, retry])

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || busy) return
    const accepted = kind === 'PRODUCT' ? /\.csv$/i : /\.(csv|xlsx)$/i
    setStatus('')
    if (!accepted.test(selected.name) || selected.size < 1 || selected.size > 10 * 1024 * 1024) {
      setError(`10MB 이하의 ${kind === 'PRODUCT' ? '상품 주문 CSV' : '결제 내역 엑셀 또는 CSV'}를 골라 주세요.`)
      return
    }
    setError('')
    setOperation('upload')
    try {
      const saved = await uploadPosFile(auth, storeId, kind, selected)
      setFiles(current => [saved, ...(current ?? [])])
      setSelected(undefined)
      if (input.current) input.current.value = ''
      setStatus(`‘${saved.filename}’을 저장했어요.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '파일을 저장할 수 없어요.')
    } finally {
      setOperation(undefined)
    }
  }

  async function remove(file: StoredPosFile) {
    if (busy || !window.confirm(`‘${file.filename}’을 삭제할까요? 이미 저장한 매출 분석은 유지돼요.`)) return
    setOperation('delete')
    setError('')
    setStatus('')
    try {
      await deletePosFile(auth, storeId, file.id)
      setFiles(current => current?.filter(item => item.id !== file.id))
      setStatus(`‘${file.filename}’을 삭제했어요.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '파일을 삭제할 수 없어요.')
    } finally {
      setOperation(undefined)
    }
  }

  return <section className="form-stack" aria-labelledby="pos-files-title">
    <div className="section-top ruled">
      <div><h2 id="pos-files-title">POS 파일 관리</h2><p className="muted">저장한 파일은 이 매장의 매출 입력에서 불러올 수 있어요.</p></div>
      <Link className="button secondary" to={'/sales?' + new URLSearchParams({ storeId })}>매출 입력하기</Link>
    </div>
    {loadError ? <p role="alert" className="error">{loadError} <button type="button" className="text-button" onClick={() => {
      setLoadError('')
      setRetry(value => value + 1)
    }}>다시 불러오기</button></p>
      : !files ? <p role="status">저장된 파일을 불러오는 중이에요.</p> : <>
        <form className="pos-library-upload" onSubmit={upload}>
          <label>파일 종류<select value={kind} disabled={busy} onChange={event => {
            setKind(event.target.value === 'PRODUCT' ? 'PRODUCT' : 'PAYMENT')
            setSelected(undefined)
            setError('')
            if (input.current) input.current.value = ''
          }}><option value="PAYMENT">결제 내역 (엑셀·CSV)</option><option value="PRODUCT">상품 주문 (CSV)</option></select></label>
          <label>POS 파일 (최대 10MB)<input ref={input} type="file" accept={kind === 'PRODUCT' ? '.csv' : '.xlsx,.csv'}
            disabled={busy} onChange={event => { setSelected(event.target.files?.[0]); setError('') }} /></label>
          <button type="submit" className="button primary" disabled={busy || !selected}>
            {operation === 'upload' ? '저장 중…' : '파일 저장'}
          </button>
        </form>
        {selected && !busy && !error && <p className="muted">파일 저장을 눌러야 보관함과 매출 입력 목록에 추가돼요.</p>}
        {status && <p role="status">{status}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!files.length ? <p>저장된 POS 파일이 없어요.</p> : <ul className="pos-library-list" aria-label="저장된 POS 파일">
          {files.map(file => <li key={file.id}>
            <div><strong>{file.filename}</strong><p className="muted">{fileKinds[file.kind]} · {dateFormat.format(new Date(file.uploadedAt))}</p></div>
            <button type="button" className="button secondary small" disabled={busy} aria-label={file.filename + ' 삭제'}
              onClick={() => void remove(file)}>삭제</button>
          </li>)}
        </ul>}
      </>}
  </section>
}
