import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { industryOptions, listAreas, registerStore } from '../api/shop'
import type { Area } from '../api/shop'
import { AddressField } from '../components/AddressField'
import { PageTitle } from '../components/ui'

const industryGroups = [...new Set(industryOptions.map(({ group }) => group))]

const administrativeAreaAliases = new Map([
  ['제주시 도두일동', '제주시 도두동'],
  ['제주시 도두이동', '제주시 도두동'],
])

export function StoreRegistration({ auth }: { auth: string }) {
  const navigate = useNavigate()
  const submitting = useRef(false)
  const [saving, setSaving] = useState(false)
  const [areas, setAreas] = useState<Area[]>()
  const [areaError, setAreaError] = useState('')
  const [areaRetry, setAreaRetry] = useState(0)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [areaCode, setAreaCode] = useState('')
  const [searchedArea, setSearchedArea] = useState<string>()
  const resolvedAreaCode = areaCode || areas?.find(({ name }) => name === searchedArea)?.code || ''
  const resolvedArea = areas?.find(({ code }) => code === resolvedAreaCode)?.name
  const [industry, setIndustry] = useState('')
  const [customIndustry, setCustomIndustry] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    listAreas(controller.signal).then(value => {
      if (!controller.signal.aborted) setAreas(value)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setAreaError(failure.message)
    })
    return () => controller.abort()
  }, [areaRetry])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    if (!name.trim() || !address.trim() || !resolvedAreaCode || !industry || (industry === 'OTHER' && !customIndustry.trim())) {
      setError('가게 이름, 업종, 매장 주소와 제주 읍·면·동을 확인해 주세요.')
      return
    }
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const saved = await registerStore(auth, {
        name: name.trim(),
        address: address.trim(),
        areaCode: resolvedAreaCode,
        addressSource: searchedArea && searchedArea === resolvedArea ? 'SEARCH' : 'MANUAL',
        industryCode: industry,
        customIndustryName: industry === 'OTHER' ? customIndustry.trim() : undefined,
      })
      navigate('/stores?' + new URLSearchParams({ storeId: saved.id }), { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '매장을 등록할 수 없어요.')
      submitting.current = false
      setSaving(false)
    }
  }

  return <>
    <PageTitle title="새 매장 등록" detail="매장 정보를 먼저 저장해 두면 매출을 입력할 때 바로 고를 수 있어요." />
    <form className="store-registration form-stack" onSubmit={submit}>
      <fieldset className="form-stack" disabled={saving}>
        <label>가게 이름<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="가게 이름을 입력하세요" /></label>
        <label>업종<select required value={industry} onChange={event => setIndustry(event.target.value)}>
          <option value="">업종을 선택해 주세요</option>
          {industryGroups.map(group => <optgroup key={group} label={group}>
            {industryOptions.filter(option => option.group === group).map(({ label, code }) => <option key={code} value={code}>{label}</option>)}
          </optgroup>)}
          <option value="OTHER">기타 (직접 입력)</option>
        </select></label>
        {industry === 'OTHER' && <label>업종명 직접 입력<input required maxLength={100} value={customIndustry} onChange={event => setCustomIndustry(event.target.value)} placeholder="예: 꽃집" /></label>}
        <AddressField address={address} area={searchedArea} onChange={(value, district) => {
          setAddress(value)
          setSearchedArea(district && (administrativeAreaAliases.get(district) ?? district))
          setAreaCode('')
        }} />
        <label>제주 읍·면·동<select required value={resolvedAreaCode} disabled={!areas} onChange={event => setAreaCode(event.target.value)}>
          <option value="">{areas ? '지역을 선택해 주세요' : areaError ? '지역 목록을 불러오지 못했어요' : '지역 목록 불러오는 중…'}</option>
          {areas?.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select></label>
        {areaError && <p role="alert" className="error">{areaError} <button type="button" className="text-button" onClick={() => {
          setAreaError('')
          setAreaRetry(value => value + 1)
        }}>다시 불러오기</button></p>}
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions end">
        {!saving && <Link to="/stores" className="button secondary">취소</Link>}
        <button type="submit" className="button primary" disabled={saving || !areas?.length}>{saving ? '등록 중…' : '매장 등록'}</button>
      </div>
    </form>
  </>
}
