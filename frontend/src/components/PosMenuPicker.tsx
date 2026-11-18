import { useEffect, useId, useRef, useState } from 'react'
import '../styles/pos-menu-picker.css'

export function PosMenuPicker({ label, menus, value, disabled, onChange }: {
  label: string; menus: string[]; value: string; disabled?: boolean; onChange: (name: string) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const names = [...new Set(menus.map(name => name.trim()).filter(Boolean))]
  const manual = editing || !names.length || Boolean(value && !names.includes(value))

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return <div className="pos-menu-picker" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
    }
  }}>
    <label id={`${id}-label`} htmlFor={`${id}-${names.length ? 'trigger' : 'input'}`}>{label}</label>
    {!!names.length && <>
      <button ref={trigger} id={`${id}-trigger`} type="button" className="pos-menu-trigger"
        aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open && !disabled} aria-controls={`${id}-options`}
        disabled={disabled} onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault(); setOpen(true)
            requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('.pos-menu-options button')?.focus())
          }
        }}>
        <span id={`${id}-value`}>{manual ? '목록에서 메뉴 선택' : value || '메뉴 선택'}</span><span aria-hidden="true">▾</span>
      </button>
      {open && !disabled && <ul id={`${id}-options`} className="pos-menu-options" aria-label={`${label} 목록`}>
        {names.map(name => <li key={name}><button type="button" aria-pressed={!manual && name === value} onClick={() => {
          setEditing(false); setOpen(false)
          if (value !== name) onChange(name)
          trigger.current?.focus()
        }}>{name}</button></li>)}
        <li><button type="button" onClick={() => {
          setEditing(true); setOpen(false); requestAnimationFrame(() => input.current?.focus())
        }}>다른 메뉴 직접 입력</button></li>
      </ul>}
    </>}
    {manual && <input ref={input} id={`${id}-input`} value={value} maxLength={255} disabled={disabled}
      aria-label={names.length ? `${label} 직접 입력` : undefined} placeholder="POS에 적힌 메뉴 이름"
      onChange={event => { setEditing(true); onChange(event.target.value) }} />}
  </div>
}
