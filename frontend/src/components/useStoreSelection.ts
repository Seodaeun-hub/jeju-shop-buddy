import { useEffect, useState } from 'react'
import type { Store } from '../api/shop'

export function useStoreSelection(ownerEmail: string, stores: Store[] | undefined, requestedId: string | null, defaultToFirst = false) {
  const selectionKey = 'shop-buddy:selected-store:' + ownerEmail
  const [lastStoreId, setLastStoreId] = useState(() =>
    localStorage.getItem(selectionKey) ?? sessionStorage.getItem(selectionKey))
  const selected = requestedId !== null
    ? stores?.find(store => store.id === requestedId)
    : stores?.find(store => store.id === lastStoreId) ?? (defaultToFirst ? stores?.[0] : undefined)
  const selectedId = selected?.id

  useEffect(() => {
    if (!selectedId) return
    localStorage.setItem(selectionKey, selectedId)
    setLastStoreId(selectedId)
  }, [selectedId, selectionKey])

  return selected
}
