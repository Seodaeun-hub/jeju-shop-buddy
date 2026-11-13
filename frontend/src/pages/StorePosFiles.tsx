import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { deletePosFile, listPosFiles, updatePosFileCoverage, uploadPosFile } from '../api/shop'
import type { PosFileKind, StoredPosFile } from '../api/shop'
import { PosFileCalendar } from '../components/PosFileCalendar'
import { useStandaloneApp } from '../components/useStandaloneApp'
import { inspectPosDates } from '../data/pos'
import { notifyResultsDataChanged, seoulDate, showWorkspaceNotifications } from '../data/promotionArchive'

const fileKinds = { PAYMENT: '결제 내역', PRODUCT: '상품 주문' }
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' })
const calendarDate = (file: StoredPosFile) => file.calendarDate ?? file.coverageEnd ?? seoulDate(new Date(file.uploadedAt))

function startingDate(value: string | null, today: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > today) return today
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? today : value
}

function PosCoverageDialog({ file, today, onClose, onSave }: {
  file: StoredPosFile; today: string; onClose: () => void
  onSave: (start: string, end: string) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const fields = new FormData(event.currentTarget)
    const start = String(fields.get('coverageStart') ?? '')
    const end = String(fields.get('coverageEnd') ?? '')
    if (!start || !end || start > end) {
      setError('POS를 내보낸 시작일과 종료일을 확인해 주세요.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await onSave(start, end)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '내보내기 기간을 저장할 수 없어요.')
      setSaving(false)
    }
  }

  return <dialog ref={dialog} className="pos-coverage-dialog" aria-labelledby="pos-coverage-title"
    onCancel={event => { event.preventDefault(); if (!saving) onClose() }}>
    <form className="form-stack" onSubmit={submit}>
      <div>
        <h3 id="pos-coverage-title">내보내기 기간 수정</h3>
        <p className="muted">{file.filename}</p>
      </div>
      <p>쉰 날이나 주문이 없던 날도 포함한 전체 내보내기 기간을 적어 주세요.</p>
      <fieldset className="pos-coverage-inputs" disabled={saving}>
        <label>내보내기 시작일<input type="date" name="coverageStart" min="1900-01-01" max={today}
          defaultValue={file.coverageStart ?? ''} required /></label>
        <label>내보내기 종료일<input type="date" name="coverageEnd" min="1900-01-01" max={today}
          defaultValue={file.coverageEnd ?? ''} required /></label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions end">
        <button className="button secondary" type="button" onClick={onClose} disabled={saving}>취소</button>
        <button className="button primary" type="submit" disabled={saving}>{saving ? '저장 중…' : '기간 저장'}</button>
      </div>
    </form>
  </dialog>
}

export function StorePosFiles({ auth, storeId, storeName, initialDate, initialKind, uploadRequest }: {
  auth: string; storeId: string; storeName: string; initialDate: string | null; initialKind: string | null
  uploadRequest?: { missingStart: string | null; resultTo?: string; inventoryTo?: string }
}) {
  const today = seoulDate()
  const standalone = useStandaloneApp()
  const input = useRef<HTMLInputElement>(null)
  const uploadHeading = useRef<HTMLHeadingElement>(null)
  const [files, setFiles] = useState<StoredPosFile[]>()
  const [editingCoverage, setEditingCoverage] = useState<StoredPosFile>()
  const [kind, setKind] = useState<PosFileKind>(initialKind === 'PRODUCT' ? 'PRODUCT' : 'PAYMENT')
  const [view, setView] = useState<'calendar' | 'all'>('calendar')
  const [selectedDate, setSelectedDate] = useState(() => startingDate(initialDate, today))
  const [month, setMonth] = useState(() => selectedDate.slice(0, 7))
  const [uploadOpen, setUploadOpen] = useState(Boolean(initialDate || uploadRequest))
  const [filterMonth, setFilterMonth] = useState('')
  const [filterKind, setFilterKind] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<File>()
  const [inspection, setInspection] = useState<{ file: File; dates: Awaited<ReturnType<typeof inspectPosDates>> }>()
  const [operation, setOperation] = useState<'upload' | 'delete'>()
  const busy = Boolean(operation)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<{ message: string; operation: 'upload' | 'delete' | 'coverage' }>()
  const [retry, setRetry] = useState(0)
  const filesReady = files !== undefined
  const focusUpload = Boolean(uploadRequest)
  const dateInView = selectedDate.startsWith(month)
  const requestedEnd = startingDate(initialDate, today)
  const requestedStart = startingDate(uploadRequest?.missingStart ?? null, today)
  const missingPeriod = uploadRequest?.missingStart === requestedStart && initialDate === requestedEnd
    && requestedStart <= requestedEnd ? requestedStart === requestedEnd ? requestedEnd : requestedStart + ' ~ ' + requestedEnd : ''

  const counts = new Map<string, number>()
  for (const file of files ?? []) {
    const day = calendarDate(file)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  useEffect(() => {
    const controller = new AbortController()
    listPosFiles(auth, storeId, controller.signal).then(value => {
      if (!controller.signal.aborted) setFiles(value)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setLoadError(failure.message)
    })
    return () => controller.abort()
  }, [auth, storeId, retry])

  useEffect(() => {
    if (standalone || !focusUpload || !filesReady) return
    uploadHeading.current?.focus({ preventScroll: true })
    uploadHeading.current?.scrollIntoView({ block: 'start' })
  }, [standalone, focusUpload, filesReady])

  useEffect(() => {
    if (!selected) return
    let ignore = false
    inspectPosDates(selected, kind).catch(() => undefined).then(dates => {
      if (!ignore) setInspection({ file: selected, dates })
    })
    return () => { ignore = true }
  }, [selected, kind])

  function selectDate(date: string) {
    setSelectedDate(date)
    setMonth(date.slice(0, 7))
    setUploadOpen(true)
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || busy) return
    const accepted = kind === 'PRODUCT' ? /\.csv$/i : /\.(csv|xlsx)$/i
    setStatus(undefined)
    if (!accepted.test(selected.name) || selected.size < 1 || selected.size > 10 * 1024 * 1024) {
      setError(`10MB 이하의 ${kind === 'PRODUCT' ? '상품 주문 CSV' : '결제 내역 엑셀 또는 CSV'}를 골라 주세요.`)
      return
    }
    const form = event.currentTarget
    const fields = new FormData(form)
    const start = String(fields.get('coverageStart') ?? '')
    const end = String(fields.get('coverageEnd') ?? '')
    if ((start || end) && (!start || !end || start > end || end > today)) {
      setError('POS를 내보낸 시작일과 종료일을 확인해 주세요.')
      return
    }
    setError('')
    setOperation('upload')
    try {
      const saved = await uploadPosFile(auth, storeId, kind, selected, {
        calendarDate: selectedDate, coverage: start && end ? { start, end } : undefined,
      })
      setFiles(current => [saved, ...(current ?? [])])
      setSelected(undefined)
      form.reset()
      setStatus({ message: `‘${saved.filename}’을 저장했어요.`, operation: 'upload' })
      notifyResultsDataChanged()
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
    setStatus(undefined)
    try {
      await deletePosFile(auth, storeId, file.id)
      setFiles(current => current?.filter(item => item.id !== file.id))
      setStatus({ message: `‘${file.filename}’을 삭제했어요.`, operation: 'delete' })
      notifyResultsDataChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '파일을 삭제할 수 없어요.')
    } finally {
      setOperation(undefined)
    }
  }

  async function saveCoverage(file: StoredPosFile, start: string, end: string) {
    const saved = await updatePosFileCoverage(auth, storeId, file.id, start, end)
    setFiles(current => current?.map(item => item.id === saved.id ? saved : item))
    setStatus({ message: `‘${saved.filename}’의 내보내기 기간을 저장했어요.`, operation: 'coverage' })
    notifyResultsDataChanged()
  }

  function fileList(items: StoredPosFile[], empty: string, showRecordDate: boolean) {
    if (!items.length) return <p className="muted">{empty}</p>
    return <ul className="pos-library-list" aria-label="저장된 POS 파일">
      {items.map(file => <li key={file.id}>
        <div><strong>{file.filename}</strong>
          <p className="muted">{fileKinds[file.kind]}{showRecordDate && ` · 기록일 ${calendarDate(file)}`}
            {' · '}올린 날 {dateFormat.format(new Date(file.uploadedAt))}
            {file.coverageStart && file.coverageEnd ? ` · 내보낸 기간 ${file.coverageStart} ~ ${file.coverageEnd}`
              : ' · 내보낸 기간 미입력'}</p>
        </div>
        <div className="pos-file-actions">
          <button type="button" className="button secondary small" disabled={busy} aria-haspopup="dialog"
            aria-label={file.filename + ' 기간 수정'} onClick={() => {
              setError('')
              setStatus(undefined)
              setEditingCoverage(file)
            }}>기간 수정</button>
          <button type="button" className="button secondary small" disabled={busy} aria-label={file.filename + ' 삭제'}
            onClick={() => void remove(file)}>삭제</button>
        </div>
      </li>)}
    </ul>
  }

  const dates = inspection?.file === selected ? inspection?.dates : undefined
  const visibleFiles = files?.filter(file => (!filterMonth || calendarDate(file).startsWith(filterMonth))
    && (!filterKind || file.kind === filterKind) && file.filename.toLocaleLowerCase('ko-KR').includes(search.trim().toLocaleLowerCase('ko-KR'))) ?? []
  const calendar = <PosFileCalendar month={month} today={today} selected={selectedDate} counts={counts}
    disabled={busy} onMonth={setMonth} onSelect={selectDate} />
  const layout = standalone ? ' pos-calendar-layout-app' : focusUpload ? ' pos-calendar-layout-upload' : ''
  const registrationHelp = focusUpload
    ? <p className="muted">{storeName}{missingPeriod && ` · 필요한 상품 주문 POS ${missingPeriod}`}</p>
    : <p className="muted">파일은 선택한 날짜에 표시돼요. 매출 집계는 파일 속 거래일을 사용해요.</p>
  const fileHelp = <p className="muted">
    {uploadRequest?.inventoryTo
      ? '발주 검토에 필요한 기간의 상품 주문 CSV를 올려 주세요. 여러 파일로 나뉘어 있으면 하나씩 저장할 수 있어요.'
      : '행사 결과에는 상품 주문 CSV나 상품 주문 시트가 포함된 엑셀을 사용해요.'}
  </p>
  const uploadForm = <form className="pos-library-upload" onSubmit={upload}>
    <label>파일 종류<select value={kind} disabled={busy} onChange={event => {
      setKind(event.target.value === 'PRODUCT' ? 'PRODUCT' : 'PAYMENT')
      setSelected(undefined)
      setInspection(undefined)
      setError('')
      if (input.current) input.current.value = ''
    }}><option value="PAYMENT">결제 내역 (엑셀·CSV)</option><option value="PRODUCT">상품 주문 (CSV)</option></select></label>
    <label>POS 파일 (최대 10MB)<input ref={input} type="file" accept={kind === 'PRODUCT' ? '.csv' : '.xlsx,.csv'}
      disabled={busy} onChange={event => { setSelected(event.target.files?.[0]); setInspection(undefined); setError('') }} /></label>
    <button type="submit" className="button primary" disabled={busy || !selected}>
      {operation === 'upload' ? '저장 중…' : '파일 저장'}
    </button>
    <details className="pos-coverage-fields">
      <summary>내보낸 기간 기록 (선택)</summary>
      <p className="muted">쉰 날이나 주문이 없던 날도 포함한 전체 내보내기 기간을 적어 주세요.</p>
      <div>
        <label>내보내기 시작일<input name="coverageStart" type="date" min="1900-01-01" max={today} disabled={busy} /></label>
        <label>내보내기 종료일<input name="coverageEnd" type="date" min="1900-01-01" max={today} disabled={busy} /></label>
      </div>
    </details>
  </form>
  const datePreview = dates && <div className="pos-calendar-date-preview">
    <p>파일에서 확인한 거래일 · {dates.start}{dates.start === dates.end ? '' : ` ~ ${dates.end}`}</p>
    {dates.end !== selectedDate && dates.end >= '1900-01-01' && dates.end <= today &&
      <button type="button" className="text-button" disabled={busy} onClick={() => selectDate(dates.end)}>
        마지막 거래일로 이동
      </button>}
  </div>
  const uploadFeedback = <>
    {status && <p role="status">{status.message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </>

  return <section className="form-stack" aria-labelledby="pos-files-title">
    <div className="section-top ruled">
      <div><h2 id="pos-files-title">POS 파일 관리</h2><p className="muted">보관한 POS는 이 매장의 매출 분석과 행사 결과 확인에 쓰여요.</p></div>
      <Link className="button secondary" to={'/sales?' + new URLSearchParams({ storeId })}>매출 입력하기</Link>
    </div>
    {editingCoverage && <PosCoverageDialog file={editingCoverage} today={today}
      onClose={() => setEditingCoverage(undefined)} onSave={(start, end) => saveCoverage(editingCoverage, start, end)} />}
    {loadError ? <p role="alert" className="error">{loadError} <button type="button" className="text-button" onClick={() => {
      setLoadError('')
      setRetry(value => value + 1)
    }}>다시 불러오기</button></p>
      : !files ? <p role="status">저장된 파일을 불러오는 중이에요.</p> : <>
        <nav className="pos-library-views" aria-label="POS 파일 보기">
          <button type="button" aria-pressed={view === 'calendar'} disabled={busy} onClick={() => setView('calendar')}>달력 보기</button>
          <button type="button" aria-pressed={view === 'all'} disabled={busy} onClick={() => setView('all')}>전체 파일</button>
        </nav>
        {(!focusUpload || view === 'all') && uploadFeedback}
        <div className={`pos-calendar-layout${layout}`} hidden={view !== 'calendar'}>
          {(!focusUpload || standalone) && calendar}
          <section className="pos-calendar-registration form-stack" aria-labelledby="pos-selected-day" hidden={standalone && !dateInView}>
            <div className={standalone ? 'pos-registration-heading' : undefined}>
              <h3 id="pos-selected-day" ref={uploadHeading} tabIndex={!standalone && focusUpload ? -1 : undefined}>
                <time dateTime={selectedDate}>{selectedDate}</time> POS 기록
              </h3>
              {standalone ? <button type="button" className="button secondary small pos-upload-toggle"
                aria-expanded={uploadOpen} aria-controls="pos-upload-form" disabled={busy}
                onClick={() => setUploadOpen(open => !open)}>파일 추가</button> : registrationHelp}
            </div>
            {standalone ? <div id="pos-upload-form" className="pos-upload-fields form-stack" hidden={!uploadOpen}>
              {registrationHelp}
              {uploadForm}
              {datePreview}
              {fileHelp}
            </div> : uploadForm}
            {focusUpload && uploadFeedback}
            {uploadRequest?.resultTo && <Link className="button secondary pos-upload-result" to={uploadRequest.resultTo}>
              이 계획의 실행 결과 확인 <span aria-hidden="true">→</span>
            </Link>}
            {uploadRequest?.inventoryTo && <Link className="button secondary pos-upload-result" to={uploadRequest.inventoryTo}>
              같은 발주 검토로 돌아가기 <span aria-hidden="true">→</span>
            </Link>}
            {focusUpload && !uploadRequest?.resultTo && !uploadRequest?.inventoryTo && status?.operation === 'upload' &&
              <button type="button" className="button secondary pos-upload-result"
                onClick={() => window.dispatchEvent(new Event(showWorkspaceNotifications))}>결과 알림 보기</button>}
            {!standalone && <>{datePreview}{fileHelp}</>}
            {fileList(files.filter(file => calendarDate(file) === selectedDate),
              files.length ? '이날 등록한 POS 파일이 없어요.' : '저장된 POS 파일이 없어요.', false)}
          </section>
          {standalone && !dateInView && <p className="muted">날짜를 선택하면 POS 파일을 추가할 수 있어요.</p>}
          {!standalone && focusUpload && calendar}
        </div>
        {view === 'all' && <>
          <div className="pos-library-filters">
            <label>기록 월<input type="month" min="1900-01" max={today.slice(0, 7)} value={filterMonth}
              onChange={event => setFilterMonth(event.target.value)} /></label>
            <label>파일 종류<select value={filterKind} onChange={event => setFilterKind(event.target.value)}>
              <option value="">전체 종류</option><option value="PAYMENT">결제 내역</option><option value="PRODUCT">상품 주문</option>
            </select></label>
            <label>파일명<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <button className="button secondary small" type="button" onClick={() => {
              setFilterMonth(''); setFilterKind(''); setSearch('')
            }}>필터 초기화</button>
          </div>
          {fileList(visibleFiles, files.length ? '조건에 맞는 POS 파일이 없어요.' : '저장된 POS 파일이 없어요.', true)}
        </>}
      </>}
  </section>
}
