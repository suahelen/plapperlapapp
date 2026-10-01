package memory

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"

	"plapperlapapp/internal/rooms"
)

var items = []rooms.Item{
	{ID: "1", Source: "house", Target: "Haus"},
	{ID: "2", Source: "tree", Target: "Baum"},
	{ID: "3", Source: "dog", Target: "Hund"},
}

func rng() *rand.Rand { return rand.New(rand.NewPCG(3, 4)) }

func errCode(err error) string {
	var ae *rooms.ActionError
	if errors.As(err, &ae) {
		return ae.Code
	}
	return fmt.Sprint(err)
}

func apply(t *testing.T, st *State, seat int, action string) error {
	t.Helper()
	return Engine{}.Apply(st, seat, json.RawMessage(action), rng())
}

func started(t *testing.T, players int) *State {
	t.Helper()
	s, err := Engine{}.New(rooms.Content{Items: items, Settings: json.RawMessage(`{"pairs":3}`)}, rng())
	if err != nil {
		t.Fatal(err)
	}
	st := s.(*State)
	for i := range players {
		_ = Engine{}.Join(st, i, fmt.Sprintf("P%d", i))
	}
	if err := apply(t, st, 0, `{"type":"start"}`); err != nil {
		t.Fatal(err)
	}
	return st
}

func pairOf(st *State, pairID string) [2]int {
	var out []int
	for i, c := range st.Cards {
		if c.PairID == pairID {
			out = append(out, i)
		}
	}
	return [2]int{out[0], out[1]}
}

func flip(t *testing.T, st *State, seat, i int) error {
	t.Helper()
	return apply(t, st, seat, fmt.Sprintf(`{"type":"flip","index":%d}`, i))
}

func TestLobby(t *testing.T) {
	s, _ := Engine{}.New(rooms.Content{Items: items}, rng())
	st := s.(*State)
	_ = Engine{}.Join(st, 0, "Host")
	if err := apply(t, st, 0, `{"type":"start"}`); errCode(err) != "NOT_ENOUGH_PLAYERS" {
		t.Fatalf("start alone: %v", err)
	}
	_ = Engine{}.Join(st, 1, "Guest")
	if err := apply(t, st, 1, `{"type":"start"}`); errCode(err) != "NOT_HOST" {
		t.Fatalf("guest start: %v", err)
	}
	if err := apply(t, st, 0, `{"type":"start"}`); err != nil {
		t.Fatal(err)
	}
	if len(st.Cards) != 6 || st.Phase != PhasePlaying { // 3 words available
		t.Fatalf("deal: %d cards, %s", len(st.Cards), st.Phase)
	}
	if err := (Engine{}).Join(st, 2, "Late"); errCode(err) != "GAME_STARTED" {
		t.Fatalf("late join: %v", err)
	}
}

func TestMatchKeepsTurnAndScores(t *testing.T) {
	st := started(t, 2)
	p := pairOf(st, "1")
	_ = flip(t, st, 0, p[0])
	if err := flip(t, st, 1, p[1]); errCode(err) != "NOT_YOUR_TURN" {
		t.Fatalf("out of turn: %v", err)
	}
	_ = flip(t, st, 0, p[1])
	if st.Last.Kind != "match" || st.Scores[0] != 1 || st.Turn != 0 {
		t.Fatalf("match: %+v scores=%v turn=%d", st.Last, st.Scores, st.Turn)
	}
	if err := flip(t, st, 0, p[0]); errCode(err) != "INVALID_CARD" {
		t.Fatalf("matched card: %v", err)
	}
}

func TestMismatchPassesTurnAndStaysVisible(t *testing.T) {
	st := started(t, 2)
	a, b := pairOf(st, "1"), pairOf(st, "2")
	_ = flip(t, st, 0, a[0])
	_ = flip(t, st, 0, b[0])
	if st.Last.Kind != "mismatch" || st.Turn != 1 {
		t.Fatalf("mismatch: %+v turn=%d", st.Last, st.Turn)
	}
	v := Engine{}.View(st, 1).(View)
	if !v.Cards[a[0]].FaceUp || !v.Cards[b[0]].FaceUp {
		t.Fatal("mismatched cards should stay visible until the next flip")
	}
	_ = flip(t, st, 1, a[1])
	v = Engine{}.View(st, 1).(View)
	if v.Cards[a[0]].FaceUp || v.Cards[b[0]].FaceUp || !v.Cards[a[1]].FaceUp {
		t.Fatal("next flip should hide the mismatched cards")
	}
}

func TestViewHidesFaceDownCards(t *testing.T) {
	st := started(t, 2)
	data, _ := json.Marshal(Engine{}.View(st, 0))
	for _, word := range []string{"house", "Haus", "Baum", "Hund"} {
		if strings.Contains(string(data), word) {
			t.Fatalf("face-down card text leaked: %s", word)
		}
	}
}

func TestFinishRankingAndRematch(t *testing.T) {
	st := started(t, 3)
	for _, id := range []string{"1", "2", "3"} {
		p := pairOf(st, id)
		_ = flip(t, st, 0, p[0])
		_ = flip(t, st, 0, p[1])
	}
	v := Engine{}.View(st, 1).(View)
	if st.Phase != PhaseFinished || len(v.Winners) != 1 || v.Winners[0] != 0 || v.Players[0].Score != 3 {
		t.Fatalf("finish: phase=%s view=%+v", st.Phase, v)
	}
	if err := apply(t, st, 2, `{"type":"rematch"}`); err != nil {
		t.Fatal(err)
	}
	if st.Phase != PhasePlaying || st.Turn != 1 || st.Scores[0] != 0 {
		t.Fatalf("rematch: phase=%s turn=%d scores=%v", st.Phase, st.Turn, st.Scores)
	}
}

func TestHostSkipsOfflinePlayer(t *testing.T) {
	st := started(t, 3)
	a, b := pairOf(st, "1"), pairOf(st, "2")
	_ = flip(t, st, 0, a[0])
	_ = flip(t, st, 0, b[0]) // mismatch → player 1
	if err := apply(t, st, 2, `{"type":"skip"}`); errCode(err) != "NOT_HOST" {
		t.Fatalf("non-host skip: %v", err)
	}
	if err := apply(t, st, 0, `{"type":"skip"}`); err != nil {
		t.Fatal(err)
	}
	if st.Turn != 2 || len(st.FaceUp) != 0 {
		t.Fatalf("after skip: turn=%d faceUp=%v", st.Turn, st.FaceUp)
	}
}
