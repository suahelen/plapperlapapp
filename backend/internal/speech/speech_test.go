package speech

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeLimiter struct{ deny bool }

func (f fakeLimiter) Allow(string) bool { return !f.deny }

func ip(*http.Request) string { return "1.2.3.4" }

// wav returns n bytes carrying a WAV signature.
func wav(n int) []byte {
	b := make([]byte, n)
	copy(b, "RIFF")
	copy(b[8:], "WAVE")
	return b
}

func fakeASR(t *testing.T, transcribe http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"status":"ok"}`) })
	mux.HandleFunc("POST /transcribe", transcribe)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func post(h *Handlers, body []byte, contentType string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/transcribe", bytes.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	h.Transcribe(rec, req)
	return rec
}

func errCode(rec *httptest.ResponseRecorder) string {
	var body struct {
		Error struct{ Code string } `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return body.Error.Code
}

func TestTranscribeForwardsClip(t *testing.T) {
	srv := fakeASR(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "audio/wav" {
			t.Errorf("content type %q", r.Header.Get("Content-Type"))
		}
		io.WriteString(w, `{"text":" Haus. "}`)
	})
	rec := post(New(srv.URL, fakeLimiter{}, ip), wav(1000), "audio/wav")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"text":"Haus."}` {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

func TestTranscribePassesGuardTranscript(t *testing.T) {
	srv := fakeASR(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"text":"Der Hund.","heard":" The dog. "}`)
	})
	rec := post(New(srv.URL, fakeLimiter{}, ip), wav(1000), "audio/wav")
	if got := strings.TrimSpace(rec.Body.String()); got != `{"text":"Der Hund.","heard":"The dog."}` {
		t.Fatalf("got %s", got)
	}
}

func TestTranscribeForwardsOnlyValidLanguage(t *testing.T) {
	var got []string
	srv := fakeASR(t, func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.URL.RawQuery)
		io.WriteString(w, `{"text":"Haus"}`)
	})
	h := New(srv.URL, fakeLimiter{}, ip)
	for _, q := range []string{"?language=de", "?language=de%26x%3D1", "?language=DEU", ""} {
		req := httptest.NewRequest(http.MethodPost, "/api/transcribe"+q, bytes.NewReader(wav(100)))
		req.Header.Set("Content-Type", "audio/wav")
		h.Transcribe(httptest.NewRecorder(), req)
	}
	if want := []string{"language=de", "", "", ""}; strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("forwarded queries %q, want %q", got, want)
	}
}

func TestTranscribeRejectsBadInput(t *testing.T) {
	var calls atomic.Int32
	srv := fakeASR(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1) })
	h := New(srv.URL, fakeLimiter{}, ip)

	cases := []struct {
		name, contentType, code string
		body                    []byte
		status                  int
	}{
		{"wrong type", "audio/webm", "UNSUPPORTED_AUDIO", wav(100), 415},
		{"not wav", "audio/wav", "INVALID_AUDIO", bytes.Repeat([]byte("x"), 100), 400},
		{"too long", "audio/wav", "CLIP_TOO_LONG", wav(MaxClipBytes + 1), 413},
	}
	for _, c := range cases {
		rec := post(h, c.body, c.contentType)
		if rec.Code != c.status || errCode(rec) != c.code {
			t.Errorf("%s: got %d %s", c.name, rec.Code, rec.Body)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("bad input reached the ASR service %d times", calls.Load())
	}
}

func TestTranscribeRateLimited(t *testing.T) {
	rec := post(New("http://unused", fakeLimiter{deny: true}, ip), wav(100), "audio/wav")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestDisabledWithoutURL(t *testing.T) {
	h := New("", fakeLimiter{}, ip)
	if rec := post(h, wav(100), "audio/wav"); errCode(rec) != "SPEECH_UNAVAILABLE" {
		t.Fatalf("got %s", rec.Body)
	}
	rec := httptest.NewRecorder()
	h.Status(rec, httptest.NewRequest(http.MethodGet, "/api/speech/status", nil))
	if !strings.Contains(rec.Body.String(), `"available":false`) {
		t.Fatalf("status %s", rec.Body)
	}
}

func TestUpstreamFailureHidesDetails(t *testing.T) {
	srv := fakeASR(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Traceback: onnxruntime exploded", http.StatusInternalServerError)
	})
	rec := post(New(srv.URL, fakeLimiter{}, ip), wav(100), "audio/wav")
	if rec.Code != http.StatusServiceUnavailable || strings.Contains(rec.Body.String(), "onnx") {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

func TestConcurrencyCap(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	srv := fakeASR(t, func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		io.WriteString(w, `{"text":"ok"}`)
	})
	h := New(srv.URL, fakeLimiter{}, ip, WithConcurrency(1, 50*time.Millisecond))

	done := make(chan int)
	go func() { done <- post(h, wav(100), "audio/wav").Code }()
	<-started
	if rec := post(h, wav(100), "audio/wav"); errCode(rec) != "SPEECH_BUSY" {
		t.Errorf("second request: %d %s", rec.Code, rec.Body)
	}
	close(release)
	if code := <-done; code != http.StatusOK {
		t.Fatalf("first request: %d", code)
	}
}

func TestStatusCachesHealth(t *testing.T) {
	var checks atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { checks.Add(1) }))
	defer srv.Close()
	h := New(srv.URL, fakeLimiter{}, ip)
	now := time.Unix(1000, 0)
	h.now = func() time.Time { return now }

	status := func() string {
		rec := httptest.NewRecorder()
		h.Status(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		return strings.TrimSpace(rec.Body.String())
	}
	if s := status(); s != `{"available":true}` {
		t.Fatal(s)
	}
	status()
	now = now.Add(statusTTL + time.Second)
	status()
	if checks.Load() != 2 {
		t.Fatalf("health checked %d times, want 2", checks.Load())
	}
}

// TestRealSidecar runs against a running asr/ service: ASR_TEST_URL=http://127.0.0.1:8765.
// Optionally ASR_TEST_WAV names a clip, ASR_TEST_LANGUAGE its language (e.g. de) and
// ASR_TEST_TEXT the expected transcript.
func TestRealSidecar(t *testing.T) {
	url := os.Getenv("ASR_TEST_URL")
	if url == "" {
		t.Skip("ASR_TEST_URL not set")
	}
	h := New(url, fakeLimiter{}, ip)
	clip := silentWav(16000)
	if path := os.Getenv("ASR_TEST_WAV"); path != "" {
		var err error
		if clip, err = os.ReadFile(path); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/api/transcribe?language="+os.Getenv("ASR_TEST_LANGUAGE"), bytes.NewReader(clip))
	req.Header.Set("Content-Type", "audio/wav")
	rec := httptest.NewRecorder()
	h.Transcribe(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if want := os.Getenv("ASR_TEST_TEXT"); want != "" && !strings.Contains(rec.Body.String(), want) {
		t.Fatalf("transcript %s, want %q", rec.Body, want)
	}
}

// silentWav builds a real 16 kHz mono PCM16 WAV with n samples of silence.
func silentWav(n int) []byte {
	b := make([]byte, 44+2*n)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(36+2*n))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], uint32(2*n))
	return b
}
