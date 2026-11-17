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

type VoiceSession = {
  recognition: Recognition
  transcript: string
  stopping: boolean
  releasing: boolean
  releaseTimer?: number
}

const microphoneReleaseTimeoutMs = 2500

function stopWithoutResult(recognition: Recognition | null) {
  if (!recognition) return
  // The browser may already have ended the session before dispatching its end event.
  try { recognition.abort() } catch { /* the session is already inactive */ }
}

export function useQuestionVoice(open: boolean, analysisId: string, appendDraft: (text: string) => void) {
  const active = useRef<VoiceSession>(null)
  const [phase, setPhase] = useState<'idle' | 'listening' | 'finishing' | 'releasing'>('idle')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState('')

  useEffect(() => () => {
    const session = active.current
    active.current = null
    window.clearTimeout(session?.releaseTimer)
    stopWithoutResult(session?.recognition ?? null)
  }, [])

  function clearSession(session: VoiceSession) {
    if (active.current !== session) return
    active.current = null
    window.clearTimeout(session.releaseTimer)
    setPhase('idle')
  }

  function saveTranscript(session: VoiceSession, fallback: string) {
    setPreview('')
    if (session.transcript) {
      appendDraft(session.transcript)
      setMessage('질문 칸에 입력했어요. 확인하고 보내기를 눌러 주세요.')
    } else {
      setMessage(fallback)
    }
  }

  function release(session: VoiceSession, fallback: string, keepTranscript: boolean, abort = true) {
    if (active.current !== session || session.releasing) return
    session.releasing = true
    setPhase('releasing')
    if (keepTranscript) saveTranscript(session, fallback)
    else {
      setPreview('')
      setMessage(fallback)
    }
    // Wait for the browser to release the microphone so a second start cannot race the first session.
    session.releaseTimer = window.setTimeout(() => clearSession(session), microphoneReleaseTimeoutMs)
    if (abort) stopWithoutResult(session.recognition)
  }

  useEffect(() => {
    const session = active.current
    if (session) release(session, '', false)
    setMessage('')
  }, [open, analysisId])

  function cancel() {
    const session = active.current
    if (session) release(session, '', false)
  }

  function toggle() {
    if (!open) return
    const current = active.current
    if (current) {
      if (current.releasing) return
      if (phase === 'finishing') {
        release(current, '', true)
      } else {
        current.stopping = true
        setPhase('finishing')
        setMessage('음성 인식 결과를 기다리고 있어요.')
        try { current.recognition.stop() } catch {
          release(current, '음성 입력을 끝내지 못했어요. 다시 시도하거나 직접 입력해 주세요.', true)
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
      const session: VoiceSession = { recognition, transcript: '', stopping: false, releasing: false }
      active.current = session
      recognition.lang = 'ko-KR'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onstart = () => {
        if (active.current === session && !session.stopping && !session.releasing) {
          setMessage('듣고 있어요. 다 말하면 중지를 누르거나 질문 칸을 수정해 주세요.')
        }
      }
      recognition.onresult = ({ results }) => {
        if (active.current !== session || session.releasing) return
        const transcript = Array.from(results, (result) => result[0]?.transcript.trim()).filter(Boolean).join(' ')
        if (!transcript) return
        session.transcript = transcript
        setPreview(transcript)
      }
      recognition.onerror = ({ error }) => {
        release(session, error === 'not-allowed' || error === 'service-not-allowed'
          ? '마이크 권한과 기기의 음성 인식 설정을 확인해 주세요. 직접 입력할 수도 있어요.'
          : error === 'no-speech'
            ? '들린 말이 없어요. 다시 말하거나 직접 입력해 주세요.'
            : '음성을 인식하지 못했어요. 다시 시도하거나 직접 입력해 주세요.', true, false)
      }
      recognition.onend = () => {
        if (active.current !== session) return
        clearSession(session)
        if (!session.releasing) saveTranscript(session, '들린 말이 없어요. 다시 말하거나 직접 입력해 주세요.')
      }
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

  return { phase, message, preview, toggle, cancel, isActive: () => !!active.current && !active.current.releasing }
}
