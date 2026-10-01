// Package battleship implements "Schiffe versenken" as a two-player room game.
//
// To fire at a cell, a player must answer that cell's prompt (e.g. conjugate
// "nous + aller"). The server checks the answer, so neither the ship positions nor
// the scoring can be manipulated from a browser.
package battleship

import (
	"encoding/json"
	"math/rand/v2"
	"unicode/utf8"

	"plapperlapapp/internal/answer"
	"plapperlapapp/internal/rooms"
)

const (
	PhaseWaiting  = "waiting"
	PhasePlacing  = "placing"
	PhasePlaying  = "playing"
	PhaseFinished = "finished"

	maxAnswerLength = 200
)

// Shot states on a board, as seen by the shooter.
const (
	shotNone = 0
	shotMiss = 1
	shotHit  = 2
	shotSunk = 3
)

type Engine struct{}

type settings struct {
	Direction string `json:"direction"`
}

type playerState struct {
	Joined bool
	Ready  bool
	Ships  [][]pos
	// Shots this player fired at the opponent's board.
	Shots [][]int
}

// Event describes the last shot attempt, so both screens can animate it.
type Event struct {
	Seq      int    `json:"seq"`
	Seat     int    `json:"seat"`
	Row      int    `json:"row"`
	Col      int    `json:"col"`
	Kind     string `json:"kind"` // miss | hit | sunk | wrong
	Given    string `json:"given,omitempty"`
	Expected string `json:"expected,omitempty"`
}

type State struct {
	Layout  Layout
	Fleet   []int
	Players [2]*playerState
	Phase   string
	Turn    int
	Starter int
	Winner  int
	Last    *Event
	seq     int
}

func (Engine) MaxPlayers() int { return 2 }

func (Engine) New(c rooms.Content, rng *rand.Rand) (rooms.State, error) {
	var s settings
	if len(c.Settings) > 0 {
		_ = json.Unmarshal(c.Settings, &s) // unknown/invalid settings fall back to defaults
	}
	layout, err := buildLayout(c.Items, s.Direction, rng)
	if err != nil {
		return nil, err
	}
	st := &State{Layout: layout, Fleet: fleetFor(layout.usableCount()), Phase: PhaseWaiting, Winner: -1}
	for i := range st.Players {
		st.Players[i] = &playerState{}
	}
	st.resetBoards(rng)
	return st, nil
}

func (Engine) Join(s rooms.State, seat int, _ string) error {
	st := s.(*State)
	st.Players[seat].Joined = true
	if st.Phase == PhaseWaiting && st.Players[0].Joined && st.Players[1].Joined {
		st.Phase = PhasePlacing
	}
	return nil
}

type action struct {
	Type   string `json:"type"`
	Row    int    `json:"row"`
	Col    int    `json:"col"`
	Answer string `json:"answer"`
}

func (Engine) Apply(s rooms.State, seat int, raw json.RawMessage, rng *rand.Rand) error {
	st := s.(*State)
	var a action
	if err := json.Unmarshal(raw, &a); err != nil {
		return rooms.Reject("INVALID_ACTION", "Invalid action.")
	}
	me := st.Players[seat]
	switch a.Type {
	case "reshuffle":
		if st.Phase != PhasePlacing && st.Phase != PhaseWaiting {
			return rooms.Reject("WRONG_PHASE", "Ships can only be moved before the game starts.")
		}
		if me.Ready {
			return rooms.Reject("ALREADY_READY", "You are already ready.")
		}
		me.Ships = placeFleet(&st.Layout, st.Fleet, rng)
		return nil

	case "ready":
		if st.Phase != PhasePlacing {
			return rooms.Reject("WRONG_PHASE", "Wait for the second player.")
		}
		me.Ready = true
		if st.Players[0].Ready && st.Players[1].Ready {
			st.Phase = PhasePlaying
			st.Turn = st.Starter
		}
		return nil

	case "shoot":
		return st.shoot(seat, a)

	case "rematch":
		if st.Phase != PhaseFinished {
			return rooms.Reject("WRONG_PHASE", "The game is not over yet.")
		}
		st.Starter = 1 - st.Winner // the loser starts the next round
		st.resetBoards(rng)
		st.Phase = PhasePlacing
		return nil
	}
	return rooms.Reject("INVALID_ACTION", "Unknown action.")
}

func (st *State) shoot(seat int, a action) error {
	if st.Phase != PhasePlaying {
		return rooms.Reject("WRONG_PHASE", "The game is not running.")
	}
	if seat != st.Turn {
		return rooms.Reject("NOT_YOUR_TURN", "It's not your turn.")
	}
	if a.Row < 0 || a.Row >= len(st.Layout.Rows) || a.Col < 0 || a.Col >= len(st.Layout.Cols) {
		return rooms.Reject("INVALID_CELL", "This field doesn't exist.")
	}
	cell := st.Layout.Cells[a.Row][a.Col]
	me, opp := st.Players[seat], st.Players[1-seat]
	if !cell.Usable {
		return rooms.Reject("INVALID_CELL", "This field can't be targeted.")
	}
	if me.Shots[a.Row][a.Col] != shotNone {
		return rooms.Reject("ALREADY_SHOT", "You already fired at this field.")
	}
	if utf8.RuneCountInString(a.Answer) > maxAnswerLength {
		return rooms.Reject("ANSWER_TOO_LONG", "Answer is too long.")
	}

	st.seq++
	ev := &Event{Seq: st.seq, Seat: seat, Row: a.Row, Col: a.Col}
	st.Last = ev

	if !answer.IsCorrect(a.Answer, cell.Expected) {
		ev.Kind, ev.Given, ev.Expected = "wrong", a.Answer, cell.Expected
		st.Turn = 1 - seat
		return nil
	}

	ship := shipAt(opp.Ships, pos{a.Row, a.Col})
	if ship < 0 {
		me.Shots[a.Row][a.Col] = shotMiss
		ev.Kind = "miss"
		st.Turn = 1 - seat
		return nil
	}

	me.Shots[a.Row][a.Col] = shotHit
	ev.Kind = "hit"
	if sunk(opp.Ships[ship], me.Shots) {
		ev.Kind = "sunk"
		for _, p := range opp.Ships[ship] {
			me.Shots[p.R][p.C] = shotSunk
		}
		if allSunk(opp.Ships, me.Shots) {
			st.Phase = PhaseFinished
			st.Winner = seat
		}
	}
	// A hit earns another shot, so the turn stays.
	return nil
}

func (st *State) resetBoards(rng *rand.Rand) {
	rows, cols := len(st.Layout.Rows), len(st.Layout.Cols)
	for _, p := range st.Players {
		p.Ready = false
		p.Ships = placeFleet(&st.Layout, st.Fleet, rng)
		p.Shots = make([][]int, rows)
		for r := range p.Shots {
			p.Shots[r] = make([]int, cols)
		}
	}
	st.Winner = -1
	st.Last = nil
}

func shipAt(ships [][]pos, p pos) int {
	for i, ship := range ships {
		for _, q := range ship {
			if q == p {
				return i
			}
		}
	}
	return -1
}

func sunk(ship []pos, shots [][]int) bool {
	for _, p := range ship {
		if shots[p.R][p.C] < shotHit {
			return false
		}
	}
	return true
}

func allSunk(ships [][]pos, shots [][]int) bool {
	for _, s := range ships {
		if !sunk(s, shots) {
			return false
		}
	}
	return true
}

// --- views ------------------------------------------------------------------------

type cellView struct {
	Usable       bool   `json:"usable"`
	ItemID       string `json:"itemId,omitempty"`
	Question     string `json:"question,omitempty"`
	ExpectedSide string `json:"expectedSide,omitempty"`
	QuestionLang string `json:"questionLang,omitempty"`
	ExpectedLang string `json:"expectedLang,omitempty"`
}

type View struct {
	Phase  string       `json:"phase"`
	You    int          `json:"you"`
	Turn   int          `json:"turn"`
	Winner int          `json:"winner"`
	Rows   []string     `json:"rows"`
	Cols   []string     `json:"cols"`
	Grid   bool         `json:"grid"`
	Cells  [][]cellView `json:"cells"`
	Fleet  []int        `json:"fleet"`
	Me     SideView     `json:"me"`
	Opp    SideView     `json:"opponent"`
	Last   *Event       `json:"lastEvent"`
}

type SideView struct {
	Joined bool `json:"joined"`
	Ready  bool `json:"ready"`
	// Ships: always for yourself; for the opponent only sunk ships, or all once finished.
	Ships [][][2]int `json:"ships"`
	// Shots fired by this side (0 none, 1 miss, 2 hit, 3 sunk).
	Shots [][]int `json:"shots"`
}

func (Engine) View(s rooms.State, seat int) any {
	st := s.(*State)
	me, opp := st.Players[seat], st.Players[1-seat]

	cells := make([][]cellView, len(st.Layout.Cells))
	for r, row := range st.Layout.Cells {
		cells[r] = make([]cellView, len(row))
		for c, cell := range row {
			// Expected answers are never sent to the browser.
			cells[r][c] = cellView{Usable: cell.Usable, ItemID: cell.ItemID, Question: cell.Question,
				ExpectedSide: cell.ExpectedSide, QuestionLang: cell.QuestionLang, ExpectedLang: cell.ExpectedLang}
		}
	}

	var oppShips [][][2]int
	for _, ship := range opp.Ships {
		if st.Phase == PhaseFinished || sunk(ship, me.Shots) {
			oppShips = append(oppShips, toPairs(ship))
		}
	}
	var myShips [][][2]int
	for _, ship := range me.Ships {
		myShips = append(myShips, toPairs(ship))
	}

	return View{
		Phase: st.Phase, You: seat, Turn: st.Turn, Winner: st.Winner,
		Rows: st.Layout.Rows, Cols: st.Layout.Cols, Grid: st.Layout.Grid,
		Cells: cells, Fleet: st.Fleet, Last: st.Last,
		Me:  SideView{Joined: me.Joined, Ready: me.Ready, Ships: myShips, Shots: me.Shots},
		Opp: SideView{Joined: opp.Joined, Ready: opp.Ready, Ships: oppShips, Shots: opp.Shots},
	}
}

func toPairs(ship []pos) [][2]int {
	out := make([][2]int, len(ship))
	for i, p := range ship {
		out[i] = [2]int{p.R, p.C}
	}
	return out
}
