import { useSyncExternalStore } from 'react'

const standalone = window.matchMedia('(display-mode: standalone)')

function subscribe(onChange: () => void) {
  standalone.addEventListener('change', onChange)
  return () => standalone.removeEventListener('change', onChange)
}

function getSnapshot() {
  return standalone.matches || ('standalone' in navigator && navigator.standalone === true)
}

export function useStandaloneApp() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
