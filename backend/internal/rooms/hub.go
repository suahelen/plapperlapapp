package rooms

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	mathrand "math/rand/v2"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound     = errors.New("room not found")
	ErrFull         = errors.New("room is full")
	ErrBadToken     = errors.New("invalid room token")
	ErrUnknownGame  = errors.New("unknown multiplayer game")
	ErrTooManyRooms = errors.New("too many rooms")
)

const (
	codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
	codeLength   = 6
)

// Envelope is what a subscriber receives on every change.
type Envelope struct {
	Version int    `json:"version"`
	Online  []bool `json:"online"`
	View    any    `json:"view"`
}

type player struct {
	token string
	seat  int
}

type subscriber struct {
	seat int
	ch   chan []byte
}

type room struct {
	code       string
	engine     Engine
	state      State
	players    []player
	version    int
	subs       map[*subscriber]struct{}
	lastActive time.Time
}

// Hub stores all rooms. A single mutex keeps things simple; the work per call is tiny.
type Hub struct {
	mu       sync.Mutex
	rooms    map[string]*room
	engines  map[string]Engine
	maxRooms int
	ttl      time.Duration
	now      func() time.Time
	rng      *mathrand.Rand
}

type HubOption func(*Hub)

func WithClock(now func() time.Time) HubOption { return func(h *Hub) { h.now = now } }
func WithSeed(seed uint64) HubOption {
	return func(h *Hub) { h.rng = mathrand.New(mathrand.NewPCG(seed, seed)) }
}
func WithLimits(maxRooms int, ttl time.Duration) HubOption {
	return func(h *Hub) { h.maxRooms, h.ttl = maxRooms, ttl }
}

func NewHub(engines map[string]Engine, opts ...HubOption) *Hub {
	var seed [2]uint64
	for i := range seed {
		n, _ := rand.Int(rand.Reader, new(big.Int).SetUint64(1<<63))
		seed[i] = n.Uint64()
	}
	h := &Hub{
		rooms:    map[string]*room{},
		engines:  engines,
		maxRooms: 5000,
		ttl:      2 * time.Hour,
		now:      time.Now,
		rng:      mathrand.New(mathrand.NewPCG(seed[0], seed[1])),
	}
	for _, o := range opts {
		o(h)
	}
	return h
}

// HasGame reports whether a multiplayer engine exists for the game type.
func (h *Hub) HasGame(gameType string) bool {
	_, ok := h.engines[gameType]
	return ok
}

// Create starts a room for the game and seats the creator.
func (h *Hub) Create(gameType string, c Content, name string) (code, token string, seat int, err error) {
	engine, ok := h.engines[gameType]
	if !ok {
		return "", "", 0, ErrUnknownGame
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= h.maxRooms {
		return "", "", 0, ErrTooManyRooms
	}
	state, err := engine.New(c, h.rng)
	if err != nil {
		return "", "", 0, err
	}
	for {
		code = randomCode()
		if _, taken := h.rooms[code]; !taken {
			break
		}
	}
	r := &room{code: code, engine: engine, state: state, subs: map[*subscriber]struct{}{}, lastActive: h.now()}
	h.rooms[code] = r
	token, err = h.seat(r, name)
	return code, token, 0, err
}

// Join seats a new player in an existing room.
func (h *Hub) Join(code, name string) (token string, seat int, err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[NormalizeCode(code)]
	if !ok {
		return "", 0, ErrNotFound
	}
	if len(r.players) >= r.engine.MaxPlayers() {
		return "", 0, ErrFull
	}
	seat = len(r.players)
	token, err = h.seat(r, name)
	if err != nil {
		return "", 0, err
	}
	h.touch(r)
	return token, seat, nil
}

func (h *Hub) seat(r *room, name string) (string, error) {
	seat := len(r.players)
	if err := r.engine.Join(r.state, seat, name); err != nil {
		return "", err
	}
	token := randomToken()
	r.players = append(r.players, player{token: token, seat: seat})
	return token, nil
}

// Apply performs a player's action and notifies everyone in the room.
func (h *Hub) Apply(code, token string, action json.RawMessage) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, seat, err := h.authenticate(code, token)
	if err != nil {
		return err
	}
	if err := r.engine.Apply(r.state, seat, action, h.rng); err != nil {
		return err
	}
	h.touch(r)
	return nil
}

// Subscription delivers a player's view (as JSON) whenever the room changes.
// C is closed when the room expires.
type Subscription struct {
	C     <-chan []byte
	close func()
}

func (s *Subscription) Close() { s.close() }

// Subscribe registers a player's live connection. The current view is delivered immediately.
func (h *Hub) Subscribe(code, token string) (*Subscription, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, seat, err := h.authenticate(code, token)
	if err != nil {
		return nil, err
	}
	sub := &subscriber{seat: seat, ch: make(chan []byte, 1)}
	r.subs[sub] = struct{}{}
	h.broadcast(r) // the new subscriber gets its view; others see the player come online

	var once sync.Once
	return &Subscription{C: sub.ch, close: func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if _, ok := r.subs[sub]; ok {
				delete(r.subs, sub)
				h.broadcast(r)
			}
		})
	}}, nil
}

// Run removes idle rooms until ctx is cancelled.
func (h *Hub) Run(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.Sweep()
		}
	}
}

// Sweep removes rooms idle for longer than the TTL and closes their subscriptions.
func (h *Hub) Sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	for code, r := range h.rooms {
		if now.Sub(r.lastActive) > h.ttl {
			for sub := range r.subs {
				close(sub.ch)
			}
			delete(h.rooms, code)
		}
	}
}

// RoomCount is used by tests and monitoring.
func (h *Hub) RoomCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms)
}

func (h *Hub) authenticate(code, token string) (*room, int, error) {
	r, ok := h.rooms[NormalizeCode(code)]
	if !ok {
		return nil, 0, ErrNotFound
	}
	for _, p := range r.players {
		if subtle.ConstantTimeCompare([]byte(p.token), []byte(token)) == 1 {
			return r, p.seat, nil
		}
	}
	return nil, 0, ErrBadToken
}

// touch records activity and pushes the new state to all subscribers.
func (h *Hub) touch(r *room) {
	r.version++
	r.lastActive = h.now()
	h.broadcast(r)
}

func (h *Hub) broadcast(r *room) {
	online := make([]bool, r.engine.MaxPlayers())
	for sub := range r.subs {
		online[sub.seat] = true
	}
	for sub := range r.subs {
		data, err := json.Marshal(Envelope{Version: r.version, Online: online, View: r.engine.View(r.state, sub.seat)})
		if err != nil {
			slog.Error("marshal room view", "room", r.code, "err", err)
			continue
		}
		// Latest state wins: drop an undelivered older message instead of blocking.
		select {
		case <-sub.ch:
		default:
		}
		sub.ch <- data
	}
}

// NormalizeCode uppercases a room code typed by a student.
func NormalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

func randomCode() string {
	var b strings.Builder
	max := big.NewInt(int64(len(codeAlphabet)))
	for range codeLength {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(fmt.Sprintf("crypto/rand: %v", err))
		}
		b.WriteByte(codeAlphabet[n.Int64()])
	}
	return b.String()
}

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand: %v", err))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
