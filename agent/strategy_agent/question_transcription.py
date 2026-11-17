import base64
import binascii
import os
from typing import Literal

from openai import OpenAI
from pydantic import Field

from .schemas import Contract

MAX_AUDIO_BYTES = 2 * 1024 * 1024
EXTENSIONS = {"audio/mp4": "m4a", "audio/webm": "webm", "audio/wav": "wav"}


class VoiceInput(Contract):
    mediaType: Literal["audio/mp4", "audio/webm", "audio/wav"]
    audio: str = Field(max_length=((MAX_AUDIO_BYTES + 2) // 3) * 4)


class Transcript(Contract):
    text: str


def transcribe_question(request: VoiceInput) -> Transcript:
    try:
        audio = base64.b64decode(request.audio, validate=True)
    except binascii.Error as error:
        raise ValueError("invalid voice input encoding") from error
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise ValueError("invalid voice input size")
    key = os.getenv("STRATEGY_AI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key:
        raise ValueError("audio transcription credentials are missing")
    with OpenAI(api_key=key, timeout=17.0, max_retries=0) as client:
        result = client.audio.transcriptions.create(
            model="gpt-transcribe",
            file=(f"question.{EXTENSIONS[request.mediaType]}", audio, request.mediaType),
            language="ko",
        )
    return Transcript(text=result.text.strip()[:1000])
