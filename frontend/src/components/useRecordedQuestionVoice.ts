import { useEffect, useRef, useState } from 'react'
import { transcribeQuestion } from '../api/shop'

type Recording = {
  request: AbortController
  recorder?: MediaRecorder
  stream?: MediaStream
  timer?: number
}

function closeMicrophone(recording: Recording) {
  window.clearTimeout(recording.timer)
  recording.stream?.getTracks().forEach(track => track.stop())
}

export function useRecordedQuestionVoice(open: boolean, auth: string, analysisId: string, appendDraft: (text: string) => void) {
  const active = useRef<Recording>(null)
  const [phase, setPhase] = useState<'idle' | 'listening' | 'finishing'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setPhase('idle')
    setMessage('')
    return () => {
      const recording = active.current
      active.current = null
      if (!recording) return
      recording.request.abort()
      closeMicrophone(recording)
    }
  }, [open, auth, analysisId])

  function finish(recording: Recording, detail: string) {
    if (active.current !== recording) return
    active.current = null
    recording.request.abort()
    closeMicrophone(recording)
    setPhase('idle')
    setMessage(detail)
  }

  function cancel() {
    if (active.current) finish(active.current, '')
  }

  function stop(recording: Recording) {
    if (active.current !== recording || recording.recorder?.state !== 'recording') return
    setPhase('finishing')
    setMessage('녹음을 질문으로 바꾸고 있어요.')
    recording.recorder.stop()
  }

  async function convert(recording: Recording, audio: Blob) {
    closeMicrophone(recording)
    if (active.current !== recording) return
    if (!audio.size) {
      finish(recording, '짧은 질문을 다시 녹음해 주세요.')
      return
    }
    try {
      const { text } = await transcribeQuestion(auth, analysisId, audio, recording.request.signal)
      if (active.current !== recording) return
      if (text.trim()) {
        appendDraft(text.trim())
        finish(recording, '질문 칸에 입력했어요. 확인하고 보내기를 눌러 주세요.')
      } else {
        finish(recording, '들린 말이 없어요. 다시 말하거나 직접 입력해 주세요.')
      }
    } catch (error) {
      finish(recording, error instanceof Error ? error.message : '음성을 인식하지 못했어요. 다시 시도해 주세요.')
    }
  }

  async function toggle() {
    if (!open) return
    if (active.current) {
      if (phase === 'finishing' || !active.current.recorder) cancel()
      else stop(active.current)
      return
    }

    const recording: Recording = { request: new AbortController() }
    active.current = recording
    setPhase('listening')
    setMessage('녹음한 질문은 중지를 누르면 OpenAI에서 텍스트로 변환돼요.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recording.stream = stream
      if (active.current !== recording) {
        closeMicrophone(recording)
        return
      }
      const format = ['audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, format ? { mimeType: format } : undefined)
      const chunks: Blob[] = []
      recording.recorder = recorder
      recorder.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || chunks[0]?.type || format
        void convert(recording, new Blob(chunks, { type }))
      }
      recorder.onerror = () => finish(recording, '녹음을 마치지 못했어요. 다시 시도해 주세요.')
      recorder.start()
      setMessage('녹음 중이에요. 다 말하면 중지를 눌러 주세요. OpenAI가 녹음을 질문으로 바꿔요.')
      recording.timer = window.setTimeout(() => stop(recording), 30000)
    } catch {
      finish(recording, '마이크 권한을 확인하거나 질문을 직접 입력해 주세요.')
    }
  }

  return { phase, message, preview: '', toggle, cancel, isActive: () => active.current !== null }
}
