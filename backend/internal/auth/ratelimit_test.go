package auth

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestLimiter(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiter(3, time.Minute)
	l.now = func() time.Time { return now }

	for i := range 3 {
		if !l.Allow("a") {
			t.Fatalf("attempt %d should be allowed", i+1)
		}
	}
	if l.Allow("a") {
		t.Fatal("4th attempt should be blocked")
	}
	if !l.Allow("b") {
		t.Fatal("other key should be independent")
	}
	now = now.Add(61 * time.Second)
	if !l.Allow("a") {
		t.Fatal("should be allowed after window")
	}
}

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.1:1234"
	r.Header.Set("X-Forwarded-For", "1.1.1.1, 2.2.2.2")
	if got := ClientIP(r, false); got != "10.0.0.1" {
		t.Errorf("untrusted: %q", got)
	}
	if got := ClientIP(r, true); got != "2.2.2.2" {
		t.Errorf("trusted: %q", got)
	}
}
