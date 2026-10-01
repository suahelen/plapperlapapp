package battleship

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"testing"

	"plapperlapapp/internal/rooms"
)

func rng() *rand.Rand { return rand.New(rand.NewPCG(1, 2)) }

func plainItems(n int) []rooms.Item {
	items := make([]rooms.Item, n)
	for i := range items {
		items[i] = rooms.Item{ID: fmt.Sprint(i), Source: fmt.Sprintf("word%d", i), Target: fmt.Sprintf("Wort%d", i)}
	}
	return items
}

var pronouns = []string{"je", "tu", "il/elle", "nous", "vous", "ils/elles"}

func conjugationItems() []rooms.Item {
	forms := map[string][]string{
		"être":  {"suis", "es", "est", "sommes", "êtes", "sont"},
		"avoir": {"ai", "as", "a", "avons", "avez", "ont"},
		"aller": {"vais", "vas", "va", "allons", "allez", "vont"},
	}
	var items []rooms.Item
	for _, verb := range []string{"être", "avoir", "aller"} {
		for i, p := range pronouns {
			meta, _ := json.Marshal(map[string]any{"grid": map[string]string{"row": p, "col": verb}})
			items = append(items, rooms.Item{
				ID: p + verb, Source: p + " (" + verb + ")", Target: forms[verb][i], Metadata: meta,
			})
		}
	}
	return items
}

// newGame creates a started game (both joined and ready).
func newGame(t *testing.T, items []rooms.Item) (*State, Engine) {
	t.Helper()
	e := Engine{}
	s, err := e.New(rooms.Content{Items: items}, rng())
	if err != nil {
		t.Fatal(err)
	}
	st := s.(*State)
	_ = e.Join(st, 0, "")
	_ = e.Join(st, 1, "")
	mustApply(t, e, st, 0, `{"type":"ready"}`)
	mustApply(t, e, st, 1, `{"type":"ready"}`)
	return st, e
}

func mustApply(t *testing.T, e Engine, st *State, seat int, action string) {
	t.Helper()
	if err := e.Apply(st, seat, json.RawMessage(action), rng()); err != nil {
		t.Fatalf("apply %s by %d: %v", action, seat, err)
	}
}

func shoot(e Engine, st *State, seat int, p pos, correct bool) error {
	ans := ""
	if p.R < len(st.Layout.Cells) && p.C < len(st.Layout.Cols) {
		ans = st.Layout.Cells[p.R][p.C].Expected
	}
	if !correct {
		ans = "definitely wrong"
	}
	b, _ := json.Marshal(map[string]any{"type": "shoot", "row": p.R, "col": p.C, "answer": ans})
	return e.Apply(st, seat, b, rng())
}

// water returns a usable cell without an opponent ship that seat hasn't shot yet.
func water(st *State, seat int) pos {
	opp := st.Players[1-seat]
	for r, row := range st.Layout.Cells {
		for c, cell := range row {
			p := pos{r, c}
			if cell.Usable && shipAt(opp.Ships, p) < 0 && st.Players[seat].Shots[r][c] == shotNone {
				return p
			}
		}
	}
	panic("no water left")
}

func rejectCode(err error) string {
	if ae, ok := err.(*rooms.ActionError); ok {
		return ae.Code
	}
	return fmt.Sprint(err)
}

func TestPlainLayout(t *testing.T) {
	st, _ := newGame(t, plainItems(20))
	if len(st.Layout.Rows) != 6 || len(st.Layout.Cols) != 6 || st.Layout.Grid {
		t.Fatalf("want 6×6 plain board, got %d×%d grid=%v", len(st.Layout.Rows), len(st.Layout.Cols), st.Layout.Grid)
	}
	if st.Layout.Cols[0] != "A" || st.Layout.Rows[0] != "1" {
		t.Errorf("labels: %v %v", st.Layout.Cols, st.Layout.Rows)
	}
	small, _ := newGame(t, plainItems(4))
	if len(small.Layout.Rows) != 5 {
		t.Errorf("small vocab should give 5×5, got %d", len(small.Layout.Rows))
	}
}

func TestGridLayout(t *testing.T) {
	st, _ := newGame(t, conjugationItems())
	l := st.Layout
	if !l.Grid || len(l.Rows) != 6 || len(l.Cols) != 3 {
		t.Fatalf("want 6 pronouns × 3 verbs grid, got %v×%v grid=%v", l.Rows, l.Cols, l.Grid)
	}
	c := l.Cells[3][2] // nous × aller
	if l.Rows[3] != "nous" || l.Cols[2] != "aller" || c.Expected != "allons" || c.Question != "nous (aller)" {
		t.Errorf("cell nous×aller: %+v", c)
	}
	if got := fleetFor(18); len(got) != 2 {
		t.Errorf("18 cells → fleet %v", got)
	}
}

func TestSmallGridFallsBackToPlain(t *testing.T) {
	items := conjugationItems()[:6] // one verb only: 6 cells < minimum
	st, _ := newGame(t, items)
	if st.Layout.Grid {
		t.Fatal("too small grid should fall back to plain layout")
	}
}

func TestFleetPlacement(t *testing.T) {
	for seed := uint64(0); seed < 50; seed++ {
		r := rand.New(rand.NewPCG(seed, seed))
		l, _ := buildLayout(conjugationItems(), "", r)
		ships := placeFleet(&l, fleetFor(l.usableCount()), r)
		seen := map[pos]bool{}
		for i, ship := range ships {
			if len(ship) != fleetFor(l.usableCount())[i] {
				t.Fatalf("seed %d: ship %d has %d cells", seed, i, len(ship))
			}
			for _, p := range ship {
				if !l.Cells[p.R][p.C].Usable || seen[p] {
					t.Fatalf("seed %d: invalid or overlapping cell %v", seed, p)
				}
				seen[p] = true
			}
		}
	}
}

func TestPhases(t *testing.T) {
	e := Engine{}
	s, _ := e.New(rooms.Content{Items: plainItems(10)}, rng())
	st := s.(*State)
	_ = e.Join(st, 0, "")
	if st.Phase != PhaseWaiting {
		t.Fatalf("one player: %s", st.Phase)
	}
	if err := e.Apply(st, 0, json.RawMessage(`{"type":"ready"}`), rng()); rejectCode(err) != "WRONG_PHASE" {
		t.Errorf("ready while waiting: %v", err)
	}
	_ = e.Join(st, 1, "")
	if st.Phase != PhasePlacing {
		t.Fatalf("two players: %s", st.Phase)
	}
	before := fmt.Sprint(st.Players[0].Ships)
	mustApply(t, e, st, 0, `{"type":"reshuffle"}`)
	if fmt.Sprint(st.Players[0].Ships) == before {
		t.Log("reshuffle produced the same layout (possible but unlikely)")
	}
	mustApply(t, e, st, 0, `{"type":"ready"}`)
	if err := e.Apply(st, 0, json.RawMessage(`{"type":"reshuffle"}`), rng()); rejectCode(err) != "ALREADY_READY" {
		t.Errorf("reshuffle after ready: %v", err)
	}
	mustApply(t, e, st, 1, `{"type":"ready"}`)
	if st.Phase != PhasePlaying || st.Turn != 0 {
		t.Fatalf("both ready: phase %s turn %d", st.Phase, st.Turn)
	}
}

func TestShootingRules(t *testing.T) {
	st, e := newGame(t, plainItems(20))

	if err := shoot(e, st, 1, water(st, 1), true); rejectCode(err) != "NOT_YOUR_TURN" {
		t.Errorf("out of turn: %v", err)
	}

	// Wrong answer: no shot, turn passes, expected answer revealed.
	p := water(st, 0)
	if err := shoot(e, st, 0, p, false); err != nil {
		t.Fatal(err)
	}
	if st.Last.Kind != "wrong" || st.Last.Expected == "" || st.Players[0].Shots[p.R][p.C] != shotNone || st.Turn != 1 {
		t.Fatalf("wrong answer: %+v turn=%d", st.Last, st.Turn)
	}

	// Miss: turn passes.
	q := water(st, 1)
	if err := shoot(e, st, 1, q, true); err != nil {
		t.Fatal(err)
	}
	if st.Last.Kind != "miss" || st.Players[1].Shots[q.R][q.C] != shotMiss || st.Turn != 0 {
		t.Fatalf("miss: %+v turn=%d", st.Last, st.Turn)
	}
	if err := shoot(e, st, 0, pos{99, 0}, true); rejectCode(err) != "INVALID_CELL" {
		t.Errorf("out of bounds: %v", err)
	}

	// Hit: turn stays.
	ship := st.Players[1].Ships[0]
	if err := shoot(e, st, 0, ship[0], true); err != nil {
		t.Fatal(err)
	}
	if st.Last.Kind != "hit" || st.Turn != 0 {
		t.Fatalf("hit: %+v turn=%d", st.Last, st.Turn)
	}
	if err := shoot(e, st, 0, ship[0], true); rejectCode(err) != "ALREADY_SHOT" {
		t.Errorf("same cell twice: %v", err)
	}
}

func TestSinkAndWin(t *testing.T) {
	st, e := newGame(t, plainItems(20))
	ships := st.Players[1].Ships
	for i, ship := range ships {
		for j, p := range ship {
			if err := shoot(e, st, 0, p, true); err != nil {
				t.Fatal(err)
			}
			if j == len(ship)-1 && st.Last.Kind != "sunk" {
				t.Fatalf("ship %d should be sunk: %+v", i, st.Last)
			}
		}
	}
	if st.Phase != PhaseFinished || st.Winner != 0 {
		t.Fatalf("finished=%s winner=%d", st.Phase, st.Winner)
	}

	// Rematch: new boards, loser starts.
	mustApply(t, e, st, 1, `{"type":"rematch"}`)
	if st.Phase != PhasePlacing || st.Starter != 1 || st.Winner != -1 || st.Players[0].Shots[ships[0][0].R][ships[0][0].C] != 0 {
		t.Fatalf("rematch: phase=%s starter=%d", st.Phase, st.Starter)
	}
	mustApply(t, e, st, 0, `{"type":"ready"}`)
	mustApply(t, e, st, 1, `{"type":"ready"}`)
	if st.Turn != 1 {
		t.Errorf("loser should start the rematch, turn=%d", st.Turn)
	}
}

func TestViewHidesSecrets(t *testing.T) {
	st, e := newGame(t, conjugationItems())
	v := e.View(st, 0).(View)
	if len(v.Opp.Ships) != 0 {
		t.Fatalf("opponent ships leaked: %v", v.Opp.Ships)
	}
	if len(v.Me.Ships) != len(st.Fleet) {
		t.Fatalf("own ships missing: %v", v.Me.Ships)
	}
	data, _ := json.Marshal(v)
	for _, secret := range []string{"allons", "sommes", "expected\":"} {
		if contains(string(data), secret) {
			t.Errorf("view contains %q", secret)
		}
	}

	// Sunk ships are revealed to the shooter.
	for _, p := range st.Players[1].Ships[0] {
		_ = shoot(e, st, 0, p, true)
	}
	v = e.View(st, 0).(View)
	if len(v.Opp.Ships) != 1 {
		t.Errorf("sunk ship should be visible: %v", v.Opp.Ships)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
