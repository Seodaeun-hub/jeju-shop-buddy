import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

const units = [
  ['kg', '킬로그램'], ['g', '그램'], ['L', '리터'], ['mL', '밀리리터'],
  ['개', '개'], ['인분', '인분'], ['봉', '봉'], ['팩', '팩'],
  ['병', '병'], ['캔', '캔'], ['박스', '박스'],
]

export function IngredientUnitPicker({ value, onChange }: {
  value: string; onChange: (unit: string) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const manualInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false)
  const [active, setActive] = useState(0)
  const options = value && !units.some(([unit]) => unit === value)
    ? [...units, [value, value]] : units

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, id, open])

  function show() {
    setActive(Math.max(0, options.findIndex(([unit]) => unit === value)))
    setOpen(true)
  }

  function pick(unit: string) {
    onChange(unit)
    setOpen(false)
    trigger.current?.focus()
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) show()
      else if (event.key === 'Home') setActive(0)
      else if (event.key === 'End') setActive(options.length - 1)
      else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if (open && ['Enter', ' '].includes(event.key)) {
      event.preventDefault()
      pick(options[active][0])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  return <div ref={root} className="ingredient-unit-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <label id={`${id}-label`} htmlFor={manual ? `${id}-manual` : `${id}-trigger`}>단위</label>
    {manual ? <div className="ingredient-unit-manual">
      <input ref={manualInput} id={`${id}-manual`} required maxLength={12} value={value}
        placeholder="단위 직접 입력" onChange={event => onChange(event.target.value)} />
      <button type="button" className="text-button" onClick={() => {
        setManual(false)
        requestAnimationFrame(() => trigger.current?.focus())
      }}>목록에서 선택</button>
    </div> : <>
      <button ref={trigger} id={`${id}-trigger`} type="button" role="combobox"
        className="ingredient-unit-trigger" aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open} aria-controls={`${id}-options`} aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onKeyDown={keyDown} onClick={() => open ? setOpen(false) : show()}>
        <span id={`${id}-value`}>{value || '선택'}</span><span aria-hidden="true">▾</span>
      </button>
      {open && <div className="ingredient-unit-popup">
        <ul id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>
          {options.map(([unit, label], index) => <li key={unit} id={`${id}-option-${index}`}
            role="option" aria-selected={value === unit} data-active={index === active}
            onPointerDown={event => event.preventDefault()} onClick={() => pick(unit)}
            onPointerMove={() => setActive(index)}>
            <span>{unit}</span>{label !== unit && <small>{label}</small>}
          </li>)}
        </ul>
        <button type="button" className="ingredient-unit-other" onClick={() => {
          setManual(true)
          setOpen(false)
          requestAnimationFrame(() => manualInput.current?.focus())
        }}>다른 단위 직접 입력</button>
      </div>}
    </>}
  </div>
}
