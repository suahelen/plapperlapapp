package eilemitweile

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

func rng() *rand.Rand { return rand.New(rand.NewPCG(5, 6)) }

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

// rollAs forces the die value after a roll action (the server rolls randomly).
func rollAs(t *testing.T, st *State, value int) {
	t.Helper()
	if err := do(st, st.Turn, `{"type":"roll"}`); err != nil {
		t.Fatal(err)
	}
	st.Roll = value
}

func answerAs(st *State, correct bool) error {
	ans := st.Prompt.Expected()
	if !correct {
		ans = "definitely wrong"
	}
	return do(st, st.Turn, fmt.Sprintf(`{"type":"answer","answer":%q}`, ans))
}

func TestSeatsAndBoard(t *testing.T) {
	st := started(t, 2, `{}`)
	if st.Players[0].Side != 0 || st.Players[1].Side != 2 {
		t.Fatalf("two players should sit opposite: %d %d", st.Players[0].Side, st.Players[1].Side)
	}
	if st.trackField(2, 30) != 6 || st.trackField(0, -1) != -1 || st.trackField(0, 48) != -1 {
		t.Error("trackField")
	}
	if !st.isSafe(6) || !st.isSafe(24) || st.isSafe(5) {
		t.Error("isSafe")
	}
	if err := (Engine{}).Join(st, 2, "Late"); errCode(err) != "GAME_STARTED" {
		t.Errorf("late join: %v", err)
	}
}

func TestCorrectAnswerMovesWrongDoesNot(t *testing.T) {
	st := started(t, 2, `{}`)
	if err := do(st, 1, `{"type":"roll"}`); errCode(err) != "NOT_YOUR_TURN" {
		t.Fatalf("out of turn: %v", err)
	}
	rollAs(t, st, 3)
	v := Engine{}.View(st, 1).(View)
	if v.Prompt == nil || v.Roll != 3 {
		t.Fatalf("view after roll: %+v", v)
	}
	_ = answerAs(st, true)
	if st.Players[0].Pawns[0] != 2 || st.Last.Kind != "move" || st.Turn != 1 {
		t.Fatalf("move: pawns=%v last=%+v turn=%d", st.Players[0].Pawns, st.Last, st.Turn)
	}

	rollAs(t, st, 6)
	_ = answerAs(st, false)
	if st.Players[1].Pawns[0] != -1 || st.Last.Kind != "wrong" || st.Last.Expected == "" || st.Turn != 0 {
		t.Fatalf("wrong: %+v turn=%d", st.Last, st.Turn)
	}
}

func TestSixRollsAgain(t *testing.T) {
	st := started(t, 2, `{}`)
	rollAs(t, st, 6)
	_ = answerAs(st, true)
	if st.Turn != 0 || st.Phase != PhaseRoll {
		t.Fatalf("six: turn=%d phase=%s", st.Turn, st.Phase)
	}
	off := started(t, 2, `{"sixRollsAgain":false}`)
	rollAs(t, off, 6)
	_ = answerAs(off, true)
	if off.Turn != 1 {
		t.Fatalf("six disabled: turn=%d", off.Turn)
	}
}

func TestCaptureAndBaenkli(t *testing.T) {
	st := started(t, 2, `{}`)
	st.Players[0].Pawns[0], st.Players[1].Pawns[0] = 2, 29 // green on field 5 (not safe)
	rollAs(t, st, 3)
	_ = answerAs(st, true)
	if st.Players[1].Pawns[0] != -1 || len(st.Last.Captured) != 1 {
		t.Fatalf("capture: %+v", st.Last)
	}

	safe := started(t, 2, `{}`)
	safe.Players[0].Pawns[0], safe.Players[1].Pawns[0] = 3, 30 // green on field 6 (Bänkli)
	rollAs(t, safe, 3)
	_ = answerAs(safe, true)
	if safe.Players[1].Pawns[0] != 30 || len(safe.Last.Captured) != 0 {
		t.Fatalf("Bänkli: %+v", safe.Last)
	}
}

func TestChoosePawnAndWin(t *testing.T) {
	st := started(t, 2, `{"pawnsPerPlayer":2}`)
	goal := st.goal()
	st.Players[0].Pawns = []int{goal - 1, 10}
	rollAs(t, st, 1)
	_ = answerAs(st, true)
	if st.Phase != PhaseChoose || len(Engine{}.View(st, 0).(View).Movable) != 2 {
		t.Fatalf("choose: phase=%s", st.Phase)
	}
	if err := do(st, 0, `{"type":"choose","pawn":5}`); errCode(err) != "INVALID_PAWN" {
		t.Fatalf("invalid pawn: %v", err)
	}
	_ = do(st, 0, `{"type":"choose","pawn":0}`)
	if st.Players[0].Pawns[0] != goal || st.Phase != PhaseRoll {
		t.Fatalf("after choose: %v %s", st.Players[0].Pawns, st.Phase)
	}

	st.Turn = 0
	st.Players[0].Pawns = []int{goal, goal - 2}
	rollAs(t, st, 5) // overshoot stops on the goal
	_ = answerAs(st, true)
	if st.Phase != PhaseFinished || st.Winner != 0 {
		t.Fatalf("win: phase=%s winner=%d", st.Phase, st.Winner)
	}
	_ = do(st, 1, `{"type":"rematch"}`)
	if st.Phase != PhaseRoll || st.Turn != 1 || st.Players[0].Pawns[0] != -1 {
		t.Fatalf("rematch: %s turn=%d", st.Phase, st.Turn)
	}
}

func TestSkipAndHiddenAnswer(t *testing.T) {
	st := started(t, 3, `{}`)
	rollAs(t, st, 2)
	_ = answerAs(st, false) // → P1
	rollAs(t, st, 4)
	data, _ := json.Marshal(Engine{}.View(st, 2))
	if strings.Contains(string(data), `"`+st.Prompt.Expected()+`"`) {
		t.Fatal("expected answer leaked")
	}
	if err := do(st, 2, `{"type":"skip"}`); errCode(err) != "NOT_HOST" {
		t.Fatalf("non-host skip: %v", err)
	}
	if err := do(st, 0, `{"type":"skip"}`); err != nil || st.Turn != 2 || st.Phase != PhaseRoll {
		t.Fatalf("skip: %v turn=%d", err, st.Turn)
	}
}
