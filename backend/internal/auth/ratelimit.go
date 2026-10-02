package auth

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Limiter is a small fixed-window, per-key rate limiter kept in memory.
// It is sufficient for a single API instance.
type Limiter struct {
	mu        sync.Mutex
	limit     int
	window    time.Duration
	entries   map[string]*limitEntry
	lastSweep time.Time
	now       func() time.Time
}

type limitEntry struct {
	count int
	start time.Time
}

func NewLimiter(limit int, window time.Duration) *Limiter {
	return &Limiter{limit: limit, window: window, entries: map[string]*limitEntry{}, now: time.Now}
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	if now.Sub(l.lastSweep) > l.window {
		for k, e := range l.entries {
			if now.Sub(e.start) > l.window {
				delete(l.entries, k)
			}
		}
		l.lastSweep = now
	}

	e, ok := l.entries[key]
	if !ok || now.Sub(e.start) > l.window {
		l.entries[key] = &limitEntry{count: 1, start: now}
		return true
	}
	if e.count >= l.limit {
		return false
	}
	e.count++
	return true
}

// ClientIP returns the request's client IP. When trustProxy is set, CF-Connecting-IP
// (set by Cloudflare at its edge, unaffected by any proxy hops behind it such as
// cloudflared or Caddy) is preferred; otherwise the rightmost X-Forwarded-For entry
// (the one added by our own reverse proxy) is used.
func ClientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if cf := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cf != "" {
			return cf
		}
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
