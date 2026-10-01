// Package eilemitweile implements Eile mit Weile for 2–4 players on their own devices.
// Rules mirror frontend/src/games/eile-mit-weile/logic.ts; the server rolls the die
// and checks answers.
package eilemitweile

import (
	"encoding/json"
	"math/rand/v2"

	"plapperlapapp/internal/answer"
	"plapperlapapp/internal/rooms"
)

const (
	PhaseLobby    = "lobby"
	PhaseRoll     = "roll"
	PhaseAnswer   = "answer"
	PhaseChoose   = "choose-pawn"
	PhaseFinished = "finished"

	minPlayers = 2
	maxPlayers = 4
	homeLength = 4
)

var colors = []string{"red", "blue", "green", "yellow"}

// seats gives the board side for each player count, so two players sit opposite.
var seats = map[int][]int{2: {0, 2}, 3: {0, 1, 2}, 4: {0, 1, 2, 3}}

type Engine struct{}

type config struct {
	Direction      string `json:"direction"`
	BoardSize      int    `json:"boardSize"`
	PawnsPerPlayer int    `json:"pawnsPerPlayer"`
	SixRollsAgain  *bool  `json:"sixRollsAgain"`
}

type player struct {
	Side     int // board side 0–3 (colour)
	Pawns    []int
	Correct  int
	Answered int
}

type Capture struct {
	Player int `json:"player"`
	Pawn   int `json:"pawn"`
	From   int `json:"from"`
}

type Event struct {
	Seq      int       `json:"seq"`
	Seat     int       `json:"seat"`
	Kind     string    `json:"kind"` // roll | correct | wrong | move | skip
	Roll     int       `json:"roll,omitempty"`
	Pawn     int       `json:"pawn"`
	From     int       `json:"from"`
	To       int       `json:"to"`
	Captured []Capture `json:"captured,omitempty"`
	Given    string    `json:"given,omitempty"`
	Expected string    `json:"expected,omitempty"`
}

type State struct {
	Roster        rooms.Roster
	words         *rooms.WordQueue
	direction     string
	TrackLength   int
	PawnsPer      int
	SixRollsAgain bool
	Players       []*player
	Turn          int
	Starter       int
	Round         int
	Phase         string
	Roll          int
	Prompt        *rooms.Prompt
	Winner        int
	Last          *Event
	seq           int
}

func (Engine) MaxPlayers() int { return maxPlayers }

func (Engine) New(c rooms.Content, _ *rand.Rand) (rooms.State, error) {
	var cfg config
	_ = json.Unmarshal(c.Settings, &cfg)
	if cfg.BoardSize != 32 && cfg.BoardSize != 64 {
		cfg.BoardSize = 48
	}
	if cfg.PawnsPerPlayer < 1 || cfg.PawnsPerPlayer > 4 {
		cfg.PawnsPerPlayer = 1
	}
	if len(c.Items) == 0 {
		return nil, rooms.Reject("NO_VOCABULARY", "This activity has no vocabulary.")
	}
	return &State{
		words:         rooms.NewWordQueue(c.Items),
		direction:     cfg.Direction,
		TrackLength:   cfg.BoardSize,
		PawnsPer:      cfg.PawnsPerPlayer,
		SixRollsAgain: cfg.SixRollsAgain == nil || *cfg.SixRollsAgain,
		Phase:         PhaseLobby,
		Winner:        -1,
	}, nil
}

func (Engine) Join(s rooms.State, seat int, name string) error {
	return s.(*State).Roster.Join(seat, name)
}

func (Engine) Apply(s rooms.State, seat int, raw json.RawMessage, rng *rand.Rand) error {
	st := s.(*State)
	var a struct {
		Type   string `json:"type"`
		Answer string `json:"answer"`
		Pawn   int    `json:"pawn"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return rooms.Reject("INVALID_ACTION", "Invalid action.")
	}
	switch a.Type {
	case "start":
		if err := st.Roster.Start(seat, minPlayers); err != nil {
			return err
		}
		st.setup()
		return nil
	case "roll":
		if err := st.requireTurn(seat, PhaseRoll); err != nil {
			return err
		}
		st.Roll = rng.IntN(6) + 1
		p := rooms.MakePrompt(st.words.Next(rng), st.direction, rng)
		st.Prompt = &p
		st.Phase = PhaseAnswer
		st.event(seat, "roll").Roll = st.Roll
		return nil
	case "answer":
		if err := st.requireTurn(seat, PhaseAnswer); err != nil {
			return err
		}
		st.answer(a.Answer)
		return nil
	case "choose":
		if err := st.requireTurn(seat, PhaseChoose); err != nil {
			return err
		}
		if !containsInt(st.movable(), a.Pawn) {
			return rooms.Reject("INVALID_PAWN", "This pawn can't move.")
		}
		st.move(a.Pawn)
		return nil
	case "skip":
		if st.Phase != PhaseRoll && st.Phase != PhaseAnswer && st.Phase != PhaseChoose {
			return rooms.Reject("WRONG_PHASE", "The game is not running.")
		}
		if err := rooms.CheckSkip(seat, st.Turn); err != nil {
			return err
		}
		st.event(st.Turn, "skip")
		st.endTurn(false)
		return nil
	case "rematch":
		if st.Phase != PhaseFinished {
			return rooms.Reject("WRONG_PHASE", "The game is not over yet.")
		}
		st.Starter = (st.Starter + 1) % len(st.Players)
		st.setup()
		return nil
	}
	return rooms.Reject("INVALID_ACTION", "Unknown action.")
}

func (st *State) requireTurn(seat int, phase string) error {
	if st.Phase != phase {
		return rooms.Reject("WRONG_PHASE", "That's not possible right now.")
	}
	if seat != st.Turn {
		return rooms.Reject("NOT_YOUR_TURN", "It's not your turn.")
	}
	return nil
}

func (st *State) setup() {
	sides := seats[len(st.Roster.Names)]
	st.Players = make([]*player, len(st.Roster.Names))
	for i := range st.Players {
		pawns := make([]int, st.PawnsPer)
		for k := range pawns {
			pawns[k] = -1 // in the stall
		}
		st.Players[i] = &player{Side: sides[i], Pawns: pawns}
	}
	st.Turn, st.Round, st.Phase, st.Roll, st.Prompt, st.Winner, st.Last = st.Starter, 1, PhaseRoll, 0, nil, -1, nil
}

func (st *State) goal() int { return st.TrackLength + homeLength - 1 }

// trackField returns the absolute track field for a pawn, or -1 in the stall / home stretch.
func (st *State) trackField(side, progress int) int {
	if progress < 0 || progress >= st.TrackLength {
		return -1
	}
	return (side*st.TrackLength/4 + progress) % st.TrackLength
}

// isSafe: every eighth field is a Bänkli, including all start fields.
func (st *State) isSafe(field int) bool { return field%(st.TrackLength/8) == 0 }

// movable returns one pawn per distinct position that hasn't reached the goal.
func (st *State) movable() []int {
	var out []int
	seen := map[int]bool{}
	for i, p := range st.Players[st.Turn].Pawns {
		if p < st.goal() && !seen[p] {
			seen[p] = true
			out = append(out, i)
		}
	}
	return out
}

func (st *State) answer(given string) {
	me := st.Players[st.Turn]
	me.Answered++
	expected := st.Prompt.Expected()
	if !answer.IsCorrect(given, expected) {
		st.words.RetryLater(st.Prompt.ItemID, 3)
		ev := st.event(st.Turn, "wrong")
		ev.Given, ev.Expected, ev.Roll = given, expected, st.Roll
		st.endTurn(false)
		return
	}
	me.Correct++
	st.Prompt = nil
	switch movable := st.movable(); len(movable) {
	case 0:
		st.endTurn(false)
	case 1:
		st.move(movable[0])
	default:
		st.Phase = PhaseChoose
		st.event(st.Turn, "correct").Roll = st.Roll
	}
}

func (st *State) move(pawn int) {
	me := st.Players[st.Turn]
	from := me.Pawns[pawn]
	to := min(from+st.Roll, st.goal())
	me.Pawns[pawn] = to

	ev := st.event(st.Turn, "move")
	ev.Roll, ev.Pawn, ev.From, ev.To = st.Roll, pawn, from, to
	if field := st.trackField(me.Side, to); field >= 0 && !st.isSafe(field) {
		for pi, p := range st.Players {
			if pi == st.Turn {
				continue
			}
			for k, prog := range p.Pawns {
				if st.trackField(p.Side, prog) == field {
					ev.Captured = append(ev.Captured, Capture{Player: pi, Pawn: k, From: prog})
					p.Pawns[k] = -1
				}
			}
		}
	}
	for _, p := range me.Pawns {
		if p != st.goal() {
			st.endTurn(st.Roll == 6 && st.SixRollsAgain)
			return
		}
	}
	st.Phase, st.Winner, st.Prompt = PhaseFinished, st.Turn, nil
}

func (st *State) endTurn(again bool) {
	st.Phase, st.Prompt = PhaseRoll, nil
	if again {
		return
	}
	st.Turn = (st.Turn + 1) % len(st.Players)
	if st.Turn == st.Starter {
		st.Round++
	}
}

func (st *State) event(seat int, kind string) *Event {
	st.seq++
	st.Last = &Event{Seq: st.seq, Seat: seat, Kind: kind}
	return st.Last
}

func containsInt(xs []int, x int) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// --- view ------------------------------------------------------------------------

type PlayerView struct {
	Name     string `json:"name"`
	Color    string `json:"color"`
	Pawns    []int  `json:"pawns"`
	Correct  int    `json:"correct"`
	Answered int    `json:"answered"`
}

type View struct {
	Phase          string        `json:"phase"`
	You            int           `json:"you"`
	Turn           int           `json:"turn"`
	Round          int           `json:"round"`
	MinPlayers     int           `json:"minPlayers"`
	TrackLength    int           `json:"trackLength"`
	HomeLength     int           `json:"homeLength"`
	PawnsPerPlayer int           `json:"pawnsPerPlayer"`
	SixRollsAgain  bool          `json:"sixRollsAgain"`
	Players        []PlayerView  `json:"players"`
	Roll           int           `json:"roll"`
	Prompt         *rooms.Prompt `json:"prompt"`
	Movable        []int         `json:"movable"`
	Winner         int           `json:"winner"`
	Last           *Event        `json:"lastEvent"`
}

func (Engine) View(s rooms.State, seat int) any {
	st := s.(*State)
	v := View{Phase: st.Phase, You: seat, Turn: st.Turn, Round: st.Round, MinPlayers: minPlayers,
		TrackLength: st.TrackLength, HomeLength: homeLength, PawnsPerPlayer: st.PawnsPer,
		SixRollsAgain: st.SixRollsAgain, Roll: st.Roll, Winner: st.Winner, Last: st.Last, Movable: []int{}}
	if st.Phase == PhaseAnswer {
		v.Prompt = st.Prompt
	}
	if st.Phase == PhaseChoose {
		v.Movable = st.movable()
	}
	sides := seats[max(len(st.Roster.Names), minPlayers)]
	for i, name := range st.Roster.Names {
		pv := PlayerView{Name: name, Pawns: []int{}}
		if i < len(st.Players) {
			p := st.Players[i]
			pv.Color, pv.Pawns, pv.Correct, pv.Answered = colors[p.Side], p.Pawns, p.Correct, p.Answered
		} else if i < len(sides) {
			pv.Color = colors[sides[i]]
		}
		v.Players = append(v.Players, pv)
	}
	return v
}
