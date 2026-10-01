package rooms

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"testing"
	"time"
)

// counterEngine is a minimal two-player game: each "inc" adds to the player's score.
// Each player sees only their own score plus the total, which lets tests check
// per-player views.
type counterEngine struct{}

type counterState struct{ scores [2]int }

func (counterEngine) MaxPlayers() int { return 2 }
func (counterEngine) New(Content, *rand.Rand) (State, error) {
	return &counterState{}, nil
}
func (counterEngine) Join(State, int, string) error { return nil }
func (counterEngine) Apply(s State, seat int, raw json.RawMessage, _ *rand.Rand) error {
	var a struct{ Type string }
	_ = json.Unmarshal(raw, &a)
	if a.Type != "inc" {
		return Reject("INVALID_ACTION", "Unknown action.")
	}
	s.(*counterState).scores[seat]++
	return nil
}
func (counterEngine) View(s State, seat int) any {
	st := s.(*counterState)
	return map[string]int{"mine": st.scores[seat], "total": st.scores[0] + st.scores[1]}
}

func newTestHub(opts ...HubOption) *Hub {
	return NewHub(map[string]Engine{"counter": counterEngine{}}, append([]HubOption{WithSeed(1)}, opts...)...)
}

func receive(t *testing.T, sub *Subscription) Envelope {
	t.Helper()
	select {
	case msg, ok := <-sub.C:
		if !ok {
			t.Fatal("subscription closed")
		}
		var env Envelope
		if err := json.Unmarshal(msg, &env); err != nil {
			t.Fatal(err)
		}
		return env
	case <-time.After(2 * time.Second):
		t.Fatal("no message")
	}
	return Envelope{}
}

func TestCreateJoinAndFull(t *testing.T) {
	h := newTestHub()
	if _, _, _, err := h.Create("nope", Content{}, ""); !errors.Is(err, ErrUnknownGame) {
		t.Fatalf("unknown game: %v", err)
	}
	code, tok0, seat0, err := h.Create("counter", Content{}, "")
	if err != nil || seat0 != 0 || len(code) != codeLength || tok0 == "" {
		t.Fatalf("create: %q %q %d %v", code, tok0, seat0, err)
	}
	tok1, seat1, err := h.Join(" "+toLower(code)+" ", "")
	if err != nil || seat1 != 1 || tok1 == tok0 {
		t.Fatalf("join: %v seat=%d", err, seat1)
	}
	if _, _, err := h.Join(code, ""); !errors.Is(err, ErrFull) {
		t.Fatalf("third player: %v", err)
	}
	if _, _, err := h.Join("ZZZZZZ", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown room: %v", err)
	}
}

func TestApplyRequiresValidToken(t *testing.T) {
	h := newTestHub()
	code, _, _, _ := h.Create("counter", Content{}, "")
	if err := h.Apply(code, "forged", json.RawMessage(`{"type":"inc"}`)); !errors.Is(err, ErrBadToken) {
		t.Fatalf("forged token: %v", err)
	}
	if err := h.Apply("NOPE22", "x", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown room: %v", err)
	}
}

func TestSubscriptionsGetPerPlayerViews(t *testing.T) {
	h := newTestHub()
	code, tok0, _, _ := h.Create("counter", Content{}, "")
	sub0, err := h.Subscribe(code, tok0)
	if err != nil {
		t.Fatal(err)
	}
	defer sub0.Close()
	first := receive(t, sub0)
	if first.Online[0] != true || first.Online[1] != false {
		t.Fatalf("online: %v", first.Online)
	}

	tok1, _, _ := h.Join(code, "")
	receive(t, sub0) // join notification

	sub1, _ := h.Subscribe(code, tok1)
	defer sub1.Close()
	receive(t, sub1)
	if env := receive(t, sub0); !env.Online[1] {
		t.Fatalf("player 1 should be online for player 0: %v", env.Online)
	}

	if err := h.Apply(code, tok1, json.RawMessage(`{"type":"inc"}`)); err != nil {
		t.Fatal(err)
	}
	v0 := receive(t, sub0).View.(map[string]any)
	v1 := receive(t, sub1).View.(map[string]any)
	if v0["mine"] != 0.0 || v1["mine"] != 1.0 || v0["total"] != 1.0 {
		t.Fatalf("views: %v %v", v0, v1)
	}

	var ae *ActionError
	if err := h.Apply(code, tok0, json.RawMessage(`{"type":"bad"}`)); !errors.As(err, &ae) {
		t.Fatalf("invalid action: %v", err)
	}

	sub1.Close()
	if env := receive(t, sub0); env.Online[1] {
		t.Fatal("player 1 should be offline after closing")
	}
}

func TestSweepRemovesIdleRooms(t *testing.T) {
	now := time.Unix(0, 0)
	h := newTestHub(WithClock(func() time.Time { return now }), WithLimits(10, time.Hour))
	code, tok, _, _ := h.Create("counter", Content{}, "")
	sub, _ := h.Subscribe(code, tok)
	receive(t, sub)

	now = now.Add(59 * time.Minute)
	h.Sweep()
	if h.RoomCount() != 1 {
		t.Fatal("room removed too early")
	}
	now = now.Add(2 * time.Minute)
	h.Sweep()
	if h.RoomCount() != 0 {
		t.Fatal("idle room not removed")
	}
	if _, ok := <-sub.C; ok {
		t.Fatal("subscription should be closed")
	}
}

func TestRoomLimit(t *testing.T) {
	h := newTestHub(WithLimits(1, time.Hour))
	if _, _, _, err := h.Create("counter", Content{}, ""); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := h.Create("counter", Content{}, ""); !errors.Is(err, ErrTooManyRooms) {
		t.Fatalf("limit: %v", err)
	}
}

func toLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}
