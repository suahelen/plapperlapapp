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

Models load lazily on first use and are unloaded again after ASR_IDLE_UNLOAD_MINUTES
of no requests (default 15; 0 disables this) - loaded, each model's weights take up
roughly 1-2 GB of resident memory, so there is no reason to keep that paged in on a
box that mostly isn't transcribing anything. The next request after an unload just
pays the ~20-30 s reload cost once.
"""

import ctypes
import gc
import io
import logging
import os
import threading
import time
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
IDLE_UNLOAD_SECONDS = int(os.environ.get("ASR_IDLE_UNLOAD_MINUTES", "15")) * 60
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


def release_memory():
    """gc.collect() alone frees Python/numpy objects but glibc keeps the underlying
    heap arenas for reuse rather than returning them to the OS - without this, the
    container's resident memory never actually drops after an unload."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except OSError:
        pass


def load(name: str):
    log.info("loading %s (quantization=%s, threads=%d) …", name, QUANTIZATION, THREADS)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = THREADS
    opts.inter_op_num_threads = 1
    return onnx_asr.load_model(name, quantization=QUANTIZATION, sess_options=opts, providers=["CPUExecutionProvider"])


# The guard only matters when the main model is steered to a language (and may translate).
GUARD_CONFIGURED = bool(GUARD_MODEL and TAKES_LANGUAGE)

model = None
guard = None
last_used = time.monotonic()
# Guards model state (load/unload) and serialises inference - parallel runs would
# fight over the same cores anyway.
lock = threading.Lock()


def ensure_loaded():
    """Loads the models on first use (or after an idle unload). Caller holds `lock`."""
    global model, guard, last_used
    if model is None:
        model = load(MODEL)
        guard = load(GUARD_MODEL) if GUARD_CONFIGURED else None
        log.info("models ready")
    last_used = time.monotonic()


def idle_unloader():
    global model, guard
    while True:
        time.sleep(60)
        if IDLE_UNLOAD_SECONDS <= 0:
            continue
        with lock:
            if model is not None and time.monotonic() - last_used > IDLE_UNLOAD_SECONDS:
                log.info("idle for over %d min, unloading models", IDLE_UNLOAD_SECONDS // 60)
                model = None
                guard = None
                release_memory()


threading.Thread(target=idle_unloader, daemon=True).start()

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
    # "available" regardless of whether the model is currently loaded: a request
    # right after an idle unload just pays the reload cost, it doesn't fail.
    return {"status": "ok", "model": MODEL, "language": TAKES_LANGUAGE, "guard": GUARD_CONFIGURED}


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
        ensure_loaded()
        text = model.recognize(audio, sample_rate=SAMPLE_RATE, **({"language": language} if steered else {}))
        heard = guard.recognize(audio, sample_rate=SAMPLE_RATE) if guard and steered else None
    return {"text": text.strip(), "heard": heard.strip() if heard is not None else None}


if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("ASR_HOST", "127.0.0.1"), port=int(os.environ.get("ASR_PORT", "8765")))
