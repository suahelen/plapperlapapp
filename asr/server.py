"""Local speech-to-text service for vocabulary answers.

Runs NVIDIA ASR models (int8 ONNX, CPU) via onnx-asr. The Go API is the only intended
client: it enforces size/rate limits and forwards 16 kHz mono WAV clips.

    POST /transcribe?language=de   body: audio/wav (PCM16, mono, 16 kHz)
                                   -> {"text": "...", "heard": "..." | null}
    GET  /health                   -> {"status": "ok", "model": ..., "language": bool, "guard": bool}

Two models, because no single one does both jobs:
- ASR_MODEL (default nemo-canary-1b-v2) is told the expected language, so single words
  come out in the right language ("Haus", not "House"). But Canary also *translates*:
  English speech with language=de becomes German text ("the dog" -> "Der Hund").
- ASR_GUARD_MODEL (default nemo-parakeet-tdt-0.6b-v3) never translates; it guesses the
  language. Its transcript is returned as "heard", so the app can notice a student
  who just read the question aloud. Set ASR_GUARD_MODEL= (empty) to disable it.
"""

import io
import logging
import os
import threading
import wave

import numpy as np
import onnx_asr
import onnxruntime as ort
import uvicorn
from fastapi import FastAPI, HTTPException, Request

MODEL = os.environ.get("ASR_MODEL", "nemo-canary-1b-v2")
GUARD_MODEL = os.environ.get("ASR_GUARD_MODEL", "nemo-parakeet-tdt-0.6b-v3")
QUANTIZATION = os.environ.get("ASR_QUANTIZATION", "int8") or None
# More threads is not faster: on laptop CPUs, oversubscribing cores made a 1 s clip take
# 2–10 s instead of ~0.5 s. Four threads measured best; override with ASR_THREADS.
THREADS = int(os.environ.get("ASR_THREADS", "0")) or min(4, os.cpu_count() or 4)
MAX_BYTES = 1 << 20  # the Go API already caps clips lower
SAMPLE_RATE = 16_000

# Canary v2 languages (ISO 639-1).
LANGUAGES = {
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
    "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk",
}
TAKES_LANGUAGE = "canary" in MODEL

log = logging.getLogger("asr")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def load(name: str):
    log.info("loading %s (quantization=%s, threads=%d) …", name, QUANTIZATION, THREADS)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = THREADS
    opts.inter_op_num_threads = 1
    return onnx_asr.load_model(name, quantization=QUANTIZATION, sess_options=opts, providers=["CPUExecutionProvider"])


model = load(MODEL)
# The guard only matters when the main model is steered to a language (and may translate).
guard = load(GUARD_MODEL) if GUARD_MODEL and TAKES_LANGUAGE else None
# One inference at a time: parallel runs would fight over the same cores.
lock = threading.Lock()
log.info("models ready")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def read_wav(data: bytes) -> np.ndarray:
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != SAMPLE_RATE:
                raise HTTPException(415, "expected 16 kHz mono PCM16 WAV")
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError):
        raise HTTPException(400, "invalid WAV")
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL, "language": TAKES_LANGUAGE, "guard": guard is not None}


@app.post("/transcribe")
async def transcribe(request: Request, language: str = ""):
    data = await request.body()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "clip too large or empty")
    audio = read_wav(data)
    if audio.size < SAMPLE_RATE // 10:  # < 0.1 s: nothing to recognise
        return {"text": "", "heard": None}
    steered = TAKES_LANGUAGE and language in LANGUAGES
    with lock:
        text = model.recognize(audio, sample_rate=SAMPLE_RATE, **({"language": language} if steered else {}))
        heard = guard.recognize(audio, sample_rate=SAMPLE_RATE) if guard and steered else None
    return {"text": text.strip(), "heard": heard.strip() if heard is not None else None}


if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("ASR_HOST", "127.0.0.1"), port=int(os.environ.get("ASR_PORT", "8765")))
