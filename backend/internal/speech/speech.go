// Package speech proxies short spoken answers to the local ASR sidecar (asr/).
//
// The sidecar is CPU-bound, so this package guards it: clips are size-limited,
// requests are rate-limited per IP and only a few transcriptions run at once.
package speech

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"plapperlapapp/internal/http/respond"
)

const (
	MaxClipBytes   = 512 << 10 // ~15 s of 16 kHz mono PCM16
	upstreamWait   = 20 * time.Second
	statusTTL      = 30 * time.Second
	statusDownTTL  = 5 * time.Second // re-check soon, so starting the sidecar is picked up quickly
	defaultQueue   = 10 * time.Second
	defaultWorkers = 2
)

// Limiter is satisfied by auth.Limiter.
type Limiter interface {
	Allow(key string) bool
}

type Handlers struct {
	url      string // empty: speech input is disabled
	client   *http.Client
	slots    chan struct{}
	queue    time.Duration
	limiter  Limiter
	clientIP func(*http.Request) string

	mu        sync.Mutex
	available bool
	checked   time.Time
	now       func() time.Time
}

type Option func(*Handlers)

// WithConcurrency sets how many transcriptions may run at once and how long further
// requests wait for a free slot.
func WithConcurrency(workers int, queue time.Duration) Option {
	return func(h *Handlers) { h.slots, h.queue = make(chan struct{}, workers), queue }
}

func New(asrURL string, limiter Limiter, clientIP func(*http.Request) string, opts ...Option) *Handlers {
	h := &Handlers{
		url:      strings.TrimRight(asrURL, "/"),
		client:   &http.Client{Timeout: upstreamWait},
		slots:    make(chan struct{}, defaultWorkers),
		queue:    defaultQueue,
		limiter:  limiter,
		clientIP: clientIP,
		now:      time.Now,
	}
	for _, o := range opts {
		o(h)
	}
	return h
}

// Status reports whether spoken answers can be offered right now.
func (h *Handlers) Status(w http.ResponseWriter, r *http.Request) {
	respond.JSON(w, http.StatusOK, map[string]bool{"available": h.isAvailable(r.Context())})
}

func (h *Handlers) isAvailable(ctx context.Context) bool {
	if h.url == "" {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	ttl := statusDownTTL
	if h.available {
		ttl = statusTTL
	}
	if !h.checked.IsZero() && h.now().Sub(h.checked) < ttl {
		return h.available
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, h.url+"/health", nil)
	resp, err := h.client.Do(req)
	h.available = err == nil && resp.StatusCode == http.StatusOK
	if resp != nil {
		resp.Body.Close()
	}
	h.checked = h.now()
	return h.available
}

func (h *Handlers) markDown() {
	h.mu.Lock()
	h.available, h.checked = false, h.now()
	h.mu.Unlock()
}

// Transcribe turns a short WAV clip into text: POST audio/wav → {"text": "..."}.
func (h *Handlers) Transcribe(w http.ResponseWriter, r *http.Request) {
	if h.url == "" {
		unavailable(w)
		return
	}
	if !h.limiter.Allow(h.clientIP(r)) {
		respond.Error(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please wait a moment.")
		return
	}
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "audio/wav" && mt != "audio/x-wav" {
		respond.Error(w, http.StatusUnsupportedMediaType, "UNSUPPORTED_AUDIO", "Audio must be sent as WAV.")
		return
	}
	clip, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxClipBytes))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			respond.Error(w, http.StatusRequestEntityTooLarge, "CLIP_TOO_LONG", "The recording is too long.")
			return
		}
		respond.Error(w, http.StatusBadRequest, "INVALID_AUDIO", "The recording could not be read.")
		return
	}
	if len(clip) < 44 || string(clip[0:4]) != "RIFF" || string(clip[8:12]) != "WAVE" {
		respond.Error(w, http.StatusBadRequest, "INVALID_AUDIO", "The recording could not be read.")
		return
	}

	// Wait for a free slot, but not forever: a long queue of waiting students helps nobody.
	wait, cancel := context.WithTimeout(r.Context(), h.queue)
	defer cancel()
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	case <-wait.Done():
		respond.Error(w, http.StatusServiceUnavailable, "SPEECH_BUSY", "Speech recognition is busy. Please try again.")
		return
	}

	// Optional expected language (ISO 639-1): lets the model transcribe single words in
	// the right language. Anything else is dropped rather than forwarded.
	lang := r.URL.Query().Get("language")
	if !languageCode.MatchString(lang) {
		lang = ""
	}

	result, err := h.forward(r.Context(), clip, lang)
	if err != nil {
		if r.Context().Err() == nil {
			slog.Warn("speech: transcription failed", "err", err)
			h.markDown()
		}
		unavailable(w)
		return
	}
	respond.JSON(w, http.StatusOK, result)
}

var languageCode = regexp.MustCompile(`^[a-z]{2}$`)

// Transcript is the sidecar's answer. Text is steered to the requested language (and may
// be a translation); Heard, if present, comes from a model that never translates, so the
// app can tell when a student said the question instead of its translation.
type Transcript struct {
	Text  string  `json:"text"`
	Heard *string `json:"heard,omitempty"`
}

func (h *Handlers) forward(ctx context.Context, clip []byte, lang string) (Transcript, error) {
	var out Transcript
	target := h.url + "/transcribe"
	if lang != "" {
		target += "?language=" + lang
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(clip))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "audio/wav")
	resp, err := h.client.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("asr status %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out); err != nil {
		return out, err
	}
	out.Text = strings.TrimSpace(out.Text)
	if out.Heard != nil {
		heard := strings.TrimSpace(*out.Heard)
		out.Heard = &heard
	}
	return out, nil
}

func unavailable(w http.ResponseWriter) {
	respond.Error(w, http.StatusServiceUnavailable, "SPEECH_UNAVAILABLE", "Speech recognition is not available.")
}
