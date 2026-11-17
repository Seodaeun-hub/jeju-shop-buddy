import { useEffect, useRef, useState } from 'react'

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = new () => Recognition
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor
  webkitSpeechRecognition?: RecognitionConstructor
}

function stopWithoutResult(recognition: Recognition | null) {
  if (!recognition) return
  // The browser may already have ended the session before dispatching its end event.
  try { recognition.abort() } catch { /* the session is already inactive */ }
}

export function useQuestionVoice(open: boolean, analysisId: string, appendDraft: (text: string) => void) {
  const active = useRef<Recognition>(null)
  const [phase, setPhase] = useState<'idle' | 'listening' | 'finishing'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setPhase('idle')
    setMessage('')
    return () => {
      const recognition = active.current
      active.current = null
      stopWithoutResult(recognition)
    }
  }, [open, analysisId])

  function toggle() {
    if (!open) return
    const current = active.current
    if (current) {
      if (phase === 'finishing') {
        active.current = null
        stopWithoutResult(current)
        setPhase('idle')
        setMessage('')
      } else {
        setPhase('finishing')
        setMessage('음성 인식 결과를 기다리고 있어요.')
        try { current.stop() } catch {
          active.current = null
          stopWithoutResult(current)
          setPhase('idle')
          setMessage('음성 입력을 끝내지 못했어요. 다시 시도하거나 직접 입력해 주세요.')
        }
      }
      return
    }
    const { SpeechRecognition, webkitSpeechRecognition } = window as SpeechWindow
    const BrowserRecognition = SpeechRecognition ?? webkitSpeechRecognition
    if (!BrowserRecognition) {
      setMessage('이 브라우저에서는 음성 입력을 사용할 수 없어요. 질문을 직접 입력해 주세요.')
      return
    }

    try {
      const recognition = new BrowserRecognition()
      active.current = recognition
      recognition.lang = 'ko-KR'
      recognition.continuous = false
      recognition.interimResults = false
      let received = false
      recognition.onresult = ({ results }) => {
        if (active.current !== recognition || received) return
        const transcript = results[0]?.[0]?.transcript.trim()
        if (!transcript) return
        received = true
        appendDraft(transcript)
        setMessage('질문 칸에 입력했어요. 확인하고 보내기를 눌러 주세요.')
      }
      recognition.onerror = ({ error }) => {
        if (active.current !== recognition) return
        active.current = null
        setPhase('idle')
        if (received) return
        setMessage(error === 'not-allowed' || error === 'service-not-allowed'
          ? '마이크 권한과 기기의 음성 인식 설정을 확인해 주세요. 직접 입력할 수도 있어요.'
          : error === 'no-speech'
            ? '들린 말이 없어요. 다시 말하거나 직접 입력해 주세요.'
            : '음성을 인식하지 못했어요. 다시 시도하거나 직접 입력해 주세요.')
      }
      recognition.onend = () => {
        if (active.current !== recognition) return
        active.current = null
        setPhase('idle')
        if (!received) setMessage('들린 말이 없어요. 다시 말하거나 직접 입력해 주세요.')
      }
      setPhase('listening')
      setMessage('마이크가 켜지면 질문을 말해 주세요.')
      recognition.start()
    } catch {
      const recognition = active.current
      active.current = null
      stopWithoutResult(recognition)
      setPhase('idle')
      setMessage('마이크를 시작하지 못했어요. 권한을 확인하거나 직접 입력해 주세요.')
    }
  }

  return { phase, message, toggle, isActive: () => active.current !== null }
}
