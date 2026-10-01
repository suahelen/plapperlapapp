// Package kaboom implements the Kaboom stick game for 2–6 players on their own devices.
// Rules mirror frontend/src/games/kaboom/logic.ts. The cup order stays on the server.
package kaboom

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"time"

	"plapperlapapp/internal/answer"
	"plapperlapapp/internal/rooms"
)

const (
	PhaseLobby    = "lobby"
	PhaseDraw     = "draw"
	PhaseAnswer   = "answer"
	PhaseKaboom   = "kaboom"
	PhaseFinished = "finished"

	minPlayers = 2
	maxPlayers = 6
)

// now is replaceable in tests.
var now = time.Now

type Engine struct{}

type settings struct {
	Direction   string `json:"direction"`
	Sticks      int    `json:"sticks"`
	KaboomShare string `json:"kaboomShare"`
	TimeLimit   int    `json:"timeLimit"` // minutes, 0 = until the cup has no word sticks
}

var shares = map[string]float64{"low": 0.1, "medium": 0.18, "high": 0.28}

// kaboomCount mirrors kaboomCount() in logic.ts (at least one KABOOM).
func kaboomCount(sticks int, share string) int {
	f, ok := shares[share]
	if !ok {
		f = shares["medium"]
	}
	return max(1, int(math.Round(float64(sticks)*f)))
}

type stick struct {
	Kaboom bool
	ItemID string
}

type player struct {
	Sticks   []stick
	Correct  int
	Answered int
	Kabooms  int
}

type Event struct {
	Seq      int    `json:"seq"`
	Seat     int    `json:"seat"`
	Kind     string `json:"kind"` // word | kaboom | correct | wrong | skip | timeup
	Lost     int    `json:"lost,omitempty"`
	Given    string `json:"given,omitempty"`
	Expected string `json:"expected,omitempty"`
}

type State struct {
	Roster   rooms.Roster
	items    map[string]rooms.Item
	itemList []rooms.Item
	settings settings
	Cup      []stick
	Players  []*player
	Turn     int
	Starter  int
	Phase    string
	Drawn    *stick
	Prompt   *rooms.Prompt
	EndsAt   time.Time
	Last     *Event
	seq      int
}

func (Engine) MaxPlayers() int { return maxPlayers }

func (Engine) New(c rooms.Content, _ *rand.Rand) (rooms.State, error) {
	var s settings
	_ = json.Unmarshal(c.Settings, &s)
	if s.Sticks < 5 || s.Sticks > 80 {
		s.Sticks = 30
	}
	if s.TimeLimit < 0 || s.TimeLimit > 60 {
		s.TimeLimit = 0
	}
	if len(c.Items) == 0 {
		return nil, rooms.Reject("NO_VOCABULARY", "This activity has no vocabulary.")
	}
	st := &State{settings: s, itemList: c.Items, items: map[string]rooms.Item{}, Phase: PhaseLobby}
	for _, it := range c.Items {
		st.items[it.ID] = it
	}
	return st, nil
}

func (Engine) Join(s rooms.State, seat int, name string) error {
	return s.(*State).Roster.Join(seat, name)
}

func (Engine) Apply(s rooms.State, seat int, raw json.RawMessage, rng *rand.Rand) error {
	st := s.(*State)
	var a struct {
		Type   string `json:"type"`
		Answer string `json:"answer"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return rooms.Reject("INVALID_ACTION", "Invalid action.")
	}
	switch a.Type {
	case "start":
		if err := st.Roster.Start(seat, minPlayers); err != nil {
			return err
		}
		st.setup(rng)
		return nil
	case "draw":
		if err := st.requireTurn(seat, PhaseDraw); err != nil {
			return err
		}
		st.draw(rng)
		return nil
	case "answer":
		if err := st.requireTurn(seat, PhaseAnswer); err != nil {
			return err
		}
		st.answer(a.Answer, rng)
		return nil
	case "continue":
		if st.Phase != PhaseKaboom {
			return rooms.Reject("WRONG_PHASE", "Nothing to continue.")
		}
		if seat != st.Turn && seat != 0 {
			return rooms.Reject("NOT_YOUR_TURN", "It's not your turn.")
		}
		st.nextTurn()
		return nil
	case "skip":
		if st.Phase != PhaseDraw && st.Phase != PhaseAnswer && st.Phase != PhaseKaboom {
			return rooms.Reject("WRONG_PHASE", "The game is not running.")
		}
		if err := rooms.CheckSkip(seat, st.Turn); err != nil {
			return err
		}
		if st.Phase == PhaseAnswer && st.Drawn != nil {
			st.returnToCup(rng, *st.Drawn)
		}
		st.event(st.Turn, "skip")
		st.nextTurn()
		return nil
	case "timeUp":
		if st.EndsAt.IsZero() || now().Before(st.EndsAt) {
			return rooms.Reject("NOT_YET", "Time is not up yet.")
		}
		if st.Phase != PhaseFinished {
			st.event(st.Turn, "timeup")
			st.finish()
		}
		return nil
	case "rematch":
		if st.Phase != PhaseFinished {
			return rooms.Reject("WRONG_PHASE", "The game is not over yet.")
		}
		st.Starter = (st.Starter + 1) % len(st.Roster.Names)
		st.setup(rng)
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

// setup fills and shuffles the cup; word sticks cycle through the shuffled vocabulary.
func (st *State) setup(rng *rand.Rand) {
	words := append([]rooms.Item(nil), st.itemList...)
	rng.Shuffle(len(words), func(i, j int) { words[i], words[j] = words[j], words[i] })
	st.Cup = st.Cup[:0]
	for i := range st.settings.Sticks {
		st.Cup = append(st.Cup, stick{ItemID: words[i%len(words)].ID})
	}
	for range kaboomCount(st.settings.Sticks, st.settings.KaboomShare) {
		st.Cup = append(st.Cup, stick{Kaboom: true})
	}
	rng.Shuffle(len(st.Cup), func(i, j int) { st.Cup[i], st.Cup[j] = st.Cup[j], st.Cup[i] })

	st.Players = make([]*player, len(st.Roster.Names))
	for i := range st.Players {
		st.Players[i] = &player{}
	}
	st.Turn, st.Phase, st.Drawn, st.Prompt, st.Last = st.Starter, PhaseDraw, nil, nil, nil
	st.EndsAt = time.Time{}
	if st.settings.TimeLimit > 0 {
		st.EndsAt = now().Add(time.Duration(st.settings.TimeLimit) * time.Minute)
	}
}

func (st *State) draw(rng *rand.Rand) {
	drawn := st.Cup[0]
	st.Cup = st.Cup[1:]
	st.Drawn = &drawn
	me := st.Players[st.Turn]
	if !drawn.Kaboom {
		p := rooms.MakePrompt(st.items[drawn.ItemID], st.settings.Direction, rng)
		st.Prompt = &p
		st.Phase = PhaseAnswer
		st.event(st.Turn, "word")
		return
	}
	// KABOOM: all the player's sticks go back into the cup, the KABOOM stick too.
	lost := len(me.Sticks)
	st.returnToCup(rng, append(me.Sticks, drawn)...)
	me.Sticks = nil
	me.Kabooms++
	st.Phase = PhaseKaboom
	st.event(st.Turn, "kaboom")
	st.Last.Lost = lost
}

func (st *State) answer(given string, rng *rand.Rand) {
	me := st.Players[st.Turn]
	me.Answered++
	expected := st.Prompt.Expected()
	if answer.IsCorrect(given, expected) {
		me.Correct++
		me.Sticks = append(me.Sticks, *st.Drawn)
		st.event(st.Turn, "correct")
	} else {
		st.returnToCup(rng, *st.Drawn)
		st.event(st.Turn, "wrong")
		st.Last.Given, st.Last.Expected = given, expected
	}
	st.nextTurn()
}

func (st *State) returnToCup(rng *rand.Rand, sticks ...stick) {
	st.Cup = append(st.Cup, sticks...)
	rng.Shuffle(len(st.Cup), func(i, j int) { st.Cup[i], st.Cup[j] = st.Cup[j], st.Cup[i] })
}

func (st *State) nextTurn() {
	st.Drawn, st.Prompt = nil, nil
	st.Turn = (st.Turn + 1) % len(st.Players)
	if st.wordsLeft() == 0 || (!st.EndsAt.IsZero() && !now().Before(st.EndsAt)) {
		st.finish()
		return
	}
	st.Phase = PhaseDraw
}

func (st *State) finish() {
	st.Phase = PhaseFinished
	st.Drawn, st.Prompt = nil, nil
}

func (st *State) wordsLeft() int {
	n := 0
	for _, s := range st.Cup {
		if !s.Kaboom {
			n++
		}
	}
	return n
}

func (st *State) event(seat int, kind string) {
	st.seq++
	st.Last = &Event{Seq: st.seq, Seat: seat, Kind: kind}
}

// --- view ------------------------------------------------------------------------

type PlayerView struct {
	Name     string `json:"name"`
	Sticks   int    `json:"sticks"`
	Correct  int    `json:"correct"`
	Answered int    `json:"answered"`
	Kabooms  int    `json:"kabooms"`
}

type View struct {
	Phase      string        `json:"phase"`
	You        int           `json:"you"`
	Turn       int           `json:"turn"`
	MinPlayers int           `json:"minPlayers"`
	Players    []PlayerView  `json:"players"`
	CupCount   int           `json:"cupCount"`
	WordsLeft  int           `json:"wordsLeft"`
	Capacity   int           `json:"capacity"`
	Prompt     *rooms.Prompt `json:"prompt"`
	EndsAt     int64         `json:"endsAt"` // epoch ms, 0 = no time limit
	Winners    []int         `json:"winners"`
	Last       *Event        `json:"lastEvent"`
}

func (Engine) View(s rooms.State, seat int) any {
	st := s.(*State)
	v := View{Phase: st.Phase, You: seat, Turn: st.Turn, MinPlayers: minPlayers, Prompt: st.Prompt,
		CupCount: len(st.Cup), WordsLeft: st.wordsLeft(), Last: st.Last, Winners: []int{}}
	if !st.EndsAt.IsZero() {
		v.EndsAt = st.EndsAt.UnixMilli()
	}
	held := 0
	for i, name := range st.Roster.Names {
		pv := PlayerView{Name: name}
		if i < len(st.Players) {
			p := st.Players[i]
			pv.Sticks, pv.Correct, pv.Answered, pv.Kabooms = len(p.Sticks), p.Correct, p.Answered, p.Kabooms
			held += len(p.Sticks)
		}
		v.Players = append(v.Players, pv)
	}
	v.Capacity = len(st.Cup) + held
	if st.Drawn != nil && st.Phase == PhaseAnswer {
		v.Capacity++
	}
	if st.Phase == PhaseFinished {
		best := -1
		for _, p := range v.Players {
			best = max(best, p.Sticks)
		}
		for i, p := range v.Players {
			if p.Sticks == best {
				v.Winners = append(v.Winners, i)
			}
		}
	}
	return v
}
