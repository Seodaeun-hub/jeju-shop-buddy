import { useEffect, useRef, useState } from 'react'

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
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

type VoiceSession = { recognition: Recognition; transcript: string }

function stopWithoutResult(recognition: Recognition | null) {
  if (!recognition) return
  // The browser may already have ended the session before dispatching its end event.
  try { recognition.abort() } catch { /* the session is already inactive */ }
}

export function useQuestionVoice(open: boolean, analysisId: string, appendDraft: (text: string) => void) {
  const active = useRef<VoiceSession>(null)
  const [phase, setPhase] = useState<'idle' | 'listening' | 'finishing'>('idle')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState('')

  useEffect(() => {
    setPhase('idle')
    setMessage('')
    setPreview('')
    return () => {
      const session = active.current
      active.current = null
      stopWithoutResult(session?.recognition ?? null)
    }
  }, [open, analysisId])

  function finish(session: VoiceSession, fallback: string, abort = false) {
    if (active.current !== session) return
    active.current = null
    if (abort) stopWithoutResult(session.recognition)
    setPhase('idle')
    setPreview('')
    if (session.transcript) {
      appendDraft(session.transcript)
      setMessage('질문 칸에 입력했어요. 확인하고 보내기를 눌러 주세요.')
    } else {
      setMessage(fallback)
    }
  }

  function cancelForEdit() {
    const session = active.current
    if (!session) return
    active.current = null
    stopWithoutResult(session.recognition)
    setPhase('idle')
    setPreview('')
    setMessage('')
  }

  function toggle() {
    if (!open) return
    const current = active.current
    if (current) {
      if (phase === 'finishing') {
        finish(current, '', true)
      } else {
        setPhase('finishing')
        setMessage('음성 인식 결과를 기다리고 있어요.')
        try { current.recognition.stop() } catch {
          finish(current, '음성 입력을 끝내지 못했어요. 다시 시도하거나 직접 입력해 주세요.', true)
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
      const session = { recognition, transcript: '' }
      active.current = session
      recognition.lang = 'ko-KR'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onstart = () => {
        if (active.current === session) setMessage('듣고 있어요. 다 말하면 중지를 누르거나 질문 칸을 수정해 주세요.')
      }
      recognition.onresult = ({ results }) => {
        if (active.current !== session) return
        const transcript = Array.from(results, (result) => result[0]?.transcript.trim()).filter(Boolean).join(' ')
        if (!transcript) return
        session.transcript = transcript
        setPreview(transcript)
      }
      recognition.onerror = ({ error }) => {
        finish(session, error === 'not-allowed' || error === 'service-not-allowed'
          ? '마이크 권한과 기기의 음성 인식 설정을 확인해 주세요. 직접 입력할 수도 있어요.'
          : error === 'no-speech'
            ? '들린 말이 없어요. 다시 말하거나 직접 입력해 주세요.'
            : '음성을 인식하지 못했어요. 다시 시도하거나 직접 입력해 주세요.')
      }
      recognition.onend = () => finish(session, '들린 말이 없어요. 다시 말하거나 직접 입력해 주세요.')
      setPhase('listening')
      setMessage('마이크가 켜지면 질문을 말해 주세요.')
      recognition.start()
    } catch {
      const session = active.current
      active.current = null
      stopWithoutResult(session?.recognition ?? null)
      setPhase('idle')
      setPreview('')
      setMessage('마이크를 시작하지 못했어요. 권한을 확인하거나 직접 입력해 주세요.')
    }
  }

  return { phase, message, preview, toggle, cancelForEdit, isActive: () => active.current !== null }
}
