package stats

import (
	"net/http"

	"plapperlapapp/internal/http/respond"
)

// Limiter is satisfied by auth.Limiter.
type Limiter interface {
	Allow(key string) bool
}

type Handlers struct {
	store    *Store
	limiter  Limiter
	clientIP func(*http.Request) string
}

func NewHandlers(store *Store, limiter Limiter, clientIP func(*http.Request) string) *Handlers {
	return &Handlers{store: store, limiter: limiter, clientIP: clientIP}
}

// RecordPlay is fired once when a student actually starts a game (anonymous; no
// session, no room token - just "this game type was played one more time").
func (h *Handlers) RecordPlay(w http.ResponseWriter, r *http.Request) {
	if !h.limiter.Allow(h.clientIP(r)) {
		respond.Error(w, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many requests. Please wait a moment.")
		return
	}
	var in struct {
		GameType string `json:"gameType"`
	}
	if !respond.Decode(w, r, &in) {
		return
	}
	if !ValidGameTypes[in.GameType] {
		respond.Error(w, http.StatusBadRequest, "UNKNOWN_GAME_TYPE", "Unknown game type.")
		return
	}
	if err := h.store.RecordPlay(r.Context(), in.GameType); err != nil {
		respond.Internal(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Totals returns public, anonymous aggregate counts: no user data.
func (h *Handlers) Totals(w http.ResponseWriter, r *http.Request) {
	totals, err := h.store.Totals(r.Context())
	if err != nil {
		respond.Internal(w, r, err)
		return
	}
	respond.JSON(w, http.StatusOK, totals)
}
