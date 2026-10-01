package rooms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"plapperlapapp/internal/http/respond"
)

// ActivityLoader provides the content of a published activity for a game.
// It returns ErrActivityNotFound or ErrGameNotEnabled when the room can't be created.
type ActivityLoader interface {
	LoadForRoom(ctx context.Context, publicID, gameType string) (Content, error)
}

var (
	ErrActivityNotFound = errors.New("activity not found")
	ErrGameNotEnabled   = errors.New("game not enabled")
)

// Limiter is satisfied by auth.Limiter.
type Limiter interface {
	Allow(key string) bool
}

type Handlers struct {
	hub      *Hub
	loader   ActivityLoader
	limiter  Limiter
	clientIP func(*http.Request) string
}

func NewHandlers(hub *Hub, loader ActivityLoader, limiter Limiter, clientIP func(*http.Request) string) *Handlers {
	return &Handlers{hub: hub, loader: loader, limiter: limiter, clientIP: clientIP}
}

const (
	maxActionBytes = 16 << 10
	heartbeat      = 25 * time.Second
	tokenHeader    = "X-Room-Token"
)

type joinResponse struct {
	Code  string `json:"code"`
	Token string `json:"token"`
	Seat  int    `json:"seat"`
}

func (h *Handlers) Create(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r) {
		return
	}
	var in struct {
		PublicID string `json:"publicId"`
		GameType string `json:"gameType"`
		Name     string `json:"name"`
	}
	if !respond.Decode(w, r, &in) {
		return
	}
	if !h.hub.HasGame(in.GameType) {
		respond.Error(w, http.StatusBadRequest, "NOT_A_MULTIPLAYER_GAME", "This game can't be played in a room.")
		return
	}
	content, err := h.loader.LoadForRoom(r.Context(), in.PublicID, in.GameType)
	switch {
	case errors.Is(err, ErrActivityNotFound):
		respond.Error(w, http.StatusNotFound, "ACTIVITY_NOT_FOUND", "Activity was not found.")
		return
	case errors.Is(err, ErrGameNotEnabled):
		respond.Error(w, http.StatusBadRequest, "GAME_NOT_ENABLED", "This game is not enabled for the activity.")
		return
	case err != nil:
		respond.Internal(w, r, err)
		return
	}

	code, token, seat, err := h.hub.Create(in.GameType, content, in.Name)
	if !h.handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusCreated, joinResponse{Code: code, Token: token, Seat: seat})
}

func (h *Handlers) Join(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r) {
		return
	}
	code := NormalizeCode(chi.URLParam(r, "code"))
	var in struct {
		Name string `json:"name"`
	}
	if !respond.Decode(w, r, &in) {
		return
	}
	token, seat, err := h.hub.Join(code, in.Name)
	if !h.handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, joinResponse{Code: code, Token: token, Seat: seat})
}

func (h *Handlers) Action(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxActionBytes+1))
	if err != nil || len(body) > maxActionBytes || !json.Valid(body) {
		respond.Error(w, http.StatusBadRequest, "INVALID_JSON", "Request body is not valid JSON.")
		return
	}
	err = h.hub.Apply(chi.URLParam(r, "code"), r.Header.Get(tokenHeader), body)
	if !h.handleErr(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Events streams the player's view as Server-Sent Events.
func (h *Handlers) Events(w http.ResponseWriter, r *http.Request) {
	sub, err := h.hub.Subscribe(chi.URLParam(r, "code"), r.URL.Query().Get("token"))
	if !h.handleErr(w, r, err) {
		return
	}
	defer sub.Close()

	// The stream outlives the server's read/write timeouts, so lift them for this request.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if err := rc.Flush(); err != nil {
		return
	}

	ping := time.NewTicker(heartbeat)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-sub.C:
			if !ok {
				fmt.Fprint(w, "event: closed\ndata: {}\n\n")
				_ = rc.Flush()
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg)
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
		}
		if err := rc.Flush(); err != nil {
			return
		}
	}
}

func (h *Handlers) allow(w http.ResponseWriter, r *http.Request) bool {
	if h.limiter.Allow(h.clientIP(r)) {
		return true
	}
	respond.Error(w, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many requests. Please wait a moment.")
	return false
}

func (h *Handlers) handleErr(w http.ResponseWriter, r *http.Request, err error) bool {
	var actionErr *ActionError
	switch {
	case err == nil:
		return true
	case errors.As(err, &actionErr):
		respond.Error(w, http.StatusBadRequest, actionErr.Code, actionErr.Message)
	case errors.Is(err, ErrNotFound):
		respond.Error(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room was not found. It may have expired.")
	case errors.Is(err, ErrFull):
		respond.Error(w, http.StatusConflict, "ROOM_FULL", "This room is already full.")
	case errors.Is(err, ErrBadToken):
		respond.Error(w, http.StatusForbidden, "INVALID_ROOM_TOKEN", "You are not a player in this room.")
	case errors.Is(err, ErrTooManyRooms):
		respond.Error(w, http.StatusServiceUnavailable, "TOO_MANY_ROOMS", "Too many active rooms. Please try again later.")
	default:
		respond.Internal(w, r, err)
	}
	return false
}
