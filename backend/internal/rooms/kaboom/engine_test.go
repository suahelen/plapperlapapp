package kaboom

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"
	"time"

	"plapperlapapp/internal/rooms"
)

var items = []rooms.Item{
	{ID: "a", Source: "dog", Target: "Hund"},
	{ID: "b", Source: "cat", Target: "Katze"},
	{ID: "c", Source: "bird", Target: "Vogel"},
}

func rng() *rand.Rand { return rand.New(rand.NewPCG(9, 9)) }

func errCode(err error) string {
	var ae *rooms.ActionError
	if errors.As(err, &ae) {
		return ae.Code
	}
	return fmt.Sprint(err)
}

func do(st *State, seat int, action string) error {
	return Engine{}.Apply(st, seat, json.RawMessage(action), rng())
}

func started(t *testing.T, players int, settings string) *State {
	t.Helper()
	s, err := Engine{}.New(rooms.Content{Items: items, Settings: json.RawMessage(settings)}, rng())
	if err != nil {
		t.Fatal(err)
	}
	st := s.(*State)
	for i := range players {
		_ = Engine{}.Join(st, i, fmt.Sprintf("P%d", i))
	}
	if err := do(st, 0, `{"type":"start"}`); err != nil {
		t.Fatal(err)
	}
	return st
}

// top puts a stick of the wanted kind on top of the cup.
func top(st *State, kaboom bool) {
	for i, s := range st.Cup {
		if s.Kaboom == kaboom {
			st.Cup[0], st.Cup[i] = st.Cup[i], st.Cup[0]
			return
		}
	}
	panic("no such stick")
}

func answerFor(st *State, correct bool) string {
	if !correct {
		return `{"type":"answer","answer":"definitely wrong"}`
	}
	return fmt.Sprintf(`{"type":"answer","answer":%q}`, st.Prompt.Expected())
}

func total(st *State) int {
	n := len(st.Cup)
	for _, p := range st.Players {
		n += len(p.Sticks)
	}
	return n
}

func TestSetup(t *testing.T) {
	st := started(t, 2, `{"sticks":20,"kaboomShare":"medium"}`)
	if st.wordsLeft() != 20 || len(st.Cup)-20 != kaboomCount(20, "medium") {
		t.Fatalf("cup: %d words of %d", st.wordsLeft(), len(st.Cup))
	}
	if kaboomCount(3, "low") != 1 || kaboomCount(30, "high") != 8 {
		t.Error("kaboomCount")
	}
	if err := (Engine{}).Join(st, 2, "Late"); errCode(err) != "GAME_STARTED" {
		t.Errorf("late join: %v", err)
	}
}

func TestCorrectAnswerKeepsStick(t *testing.T) {
	st := started(t, 2, `{"sticks":10}`)
	if err := do(st, 1, `{"type":"draw"}`); errCode(err) != "NOT_YOUR_TURN" {
		t.Fatalf("out of turn: %v", err)
	}
	top(st, false)
	_ = do(st, 0, `{"type":"draw"}`)
	if st.Phase != PhaseAnswer || st.Prompt == nil {
		t.Fatalf("after draw: %s", st.Phase)
	}
	size := len(st.Cup)
	_ = do(st, 0, answerFor(st, true))
	if len(st.Players[0].Sticks) != 1 || len(st.Cup) != size || st.Turn != 1 || st.Phase != PhaseDraw {
		t.Fatalf("correct: sticks=%d cup=%d turn=%d", len(st.Players[0].Sticks), len(st.Cup), st.Turn)
	}
}

func TestWrongAnswerReturnsStick(t *testing.T) {
	st := started(t, 2, `{"sticks":10}`)
	top(st, false)
	_ = do(st, 0, `{"type":"draw"}`)
	size := len(st.Cup)
	_ = do(st, 0, answerFor(st, false))
	if len(st.Players[0].Sticks) != 0 || len(st.Cup) != size+1 || st.Last.Kind != "wrong" || st.Last.Expected == "" {
		t.Fatalf("wrong: %+v", st.Last)
	}
}

func TestKaboomReturnsAllSticks(t *testing.T) {
	st := started(t, 2, `{"sticks":10}`)
	before := total(st)
	for range 3 { // P0, P1, P0 each collect a stick
		top(st, false)
		_ = do(st, st.Turn, `{"type":"draw"}`)
		_ = do(st, st.Turn, answerFor(st, true))
	}
	top(st, true)
	_ = do(st, 1, `{"type":"draw"}`)
	if st.Phase != PhaseKaboom || st.Last.Lost != 1 || len(st.Players[1].Sticks) != 0 || st.Players[1].Kabooms != 1 {
		t.Fatalf("kaboom: %+v", st.Last)
	}
	if total(st) != before {
		t.Fatalf("sticks lost: %d → %d", before, total(st))
	}
	if err := do(st, 0, `{"type":"continue"}`); err != nil { // host may continue for anyone
		t.Fatal(err)
	}
	if st.Turn != 0 || st.Phase != PhaseDraw {
		t.Fatalf("after continue: turn=%d %s", st.Turn, st.Phase)
	}
}

func TestFinishesWhenNoWordSticksLeft(t *testing.T) {
	st := started(t, 2, `{"sticks":5}`)
	for st.Phase != PhaseFinished {
		top(st, false)
		_ = do(st, st.Turn, `{"type":"draw"}`)
		_ = do(st, st.Turn, answerFor(st, true))
	}
	v := Engine{}.View(st, 0).(View)
	if v.WordsLeft != 0 || len(v.Winners) != 1 || v.Winners[0] != 0 { // P0 got 3 of 5
		t.Fatalf("finish: %+v", v)
	}
	if err := do(st, 1, `{"type":"rematch"}`); err != nil || st.Turn != 1 || st.wordsLeft() != 5 {
		t.Fatalf("rematch: %v turn=%d", err, st.Turn)
	}
}

func TestTimeLimit(t *testing.T) {
	clock := time.Unix(1000, 0)
	now = func() time.Time { return clock }
	defer func() { now = time.Now }()

	st := started(t, 2, `{"sticks":20,"timeLimit":5}`)
	if err := do(st, 1, `{"type":"timeUp"}`); errCode(err) != "NOT_YET" {
		t.Fatalf("early timeUp: %v", err)
	}
	clock = clock.Add(5*time.Minute + time.Second)
	if err := do(st, 1, `{"type":"timeUp"}`); err != nil || st.Phase != PhaseFinished {
		t.Fatalf("timeUp: %v %s", err, st.Phase)
	}
	if v := (Engine{}).View(st, 0).(View); v.EndsAt != time.Unix(1000, 0).Add(5*time.Minute).UnixMilli() {
		t.Errorf("endsAt: %d", v.EndsAt)
	}
}

func TestSkipReturnsDrawnStick(t *testing.T) {
	st := started(t, 3, `{"sticks":10}`)
	top(st, false)
	_ = do(st, 0, `{"type":"draw"}`)
	_ = do(st, 0, answerFor(st, false)) // → P1
	top(st, false)
	_ = do(st, 1, `{"type":"draw"}`)
	size := len(st.Cup)
	if err := do(st, 2, `{"type":"skip"}`); errCode(err) != "NOT_HOST" {
		t.Fatalf("non-host skip: %v", err)
	}
	if err := do(st, 0, `{"type":"skip"}`); err != nil {
		t.Fatal(err)
	}
	if st.Turn != 2 || len(st.Cup) != size+1 || st.Players[1].Answered != 0 {
		t.Fatalf("skip: turn=%d cup=%d", st.Turn, len(st.Cup))
	}
}

func TestViewHidesCupAndAnswer(t *testing.T) {
	st := started(t, 2, `{"sticks":10}`)
	top(st, false)
	_ = do(st, 0, `{"type":"draw"}`)
	data, _ := json.Marshal(Engine{}.View(st, 1))
	if strings.Contains(string(data), `"`+st.Prompt.Expected()+`"`) || strings.Contains(string(data), "itemID") {
		t.Fatalf("view leaks secrets: %s", data)
	}
}
