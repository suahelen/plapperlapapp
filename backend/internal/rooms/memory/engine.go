// Package memory implements Memory for 2–4 players on their own devices.
// Rules mirror frontend/src/games/memory/logic.ts; card faces stay on the server
// until a card is turned over.
package memory

import (
	"encoding/json"
	"math/rand/v2"

	"plapperlapapp/internal/rooms"
)

const (
	PhaseLobby    = "lobby"
	PhasePlaying  = "playing"
	PhaseFinished = "finished"

	minPlayers   = 2
	maxPlayers   = 4
	defaultPairs = 8
)

type Engine struct{}

type card struct {
	PairID  string
	Text    string
	Side    string
	Matched bool
	Owner   int
}

type Event struct {
	Seq   int    `json:"seq"`
	Seat  int    `json:"seat"`
	Kind  string `json:"kind"` // flip | match | mismatch | skip
	Cards []int  `json:"cards,omitempty"`
}

type State struct {
	Roster rooms.Roster
	items  []rooms.Item
	pairs  int
	Cards  []card
	FaceUp []int
	// PendingHide: after a mismatch both cards stay visible until the next flip.
	PendingHide bool
	Scores      []int
	Turn        int
	Starter     int
	Phase       string
	Last        *Event
	seq         int
}

func (Engine) MaxPlayers() int { return maxPlayers }

func (Engine) New(c rooms.Content, _ *rand.Rand) (rooms.State, error) {
	var s struct {
		Pairs int `json:"pairs"`
	}
	_ = json.Unmarshal(c.Settings, &s)
	if s.Pairs < 2 || s.Pairs > 15 {
		s.Pairs = defaultPairs
	}
	if len(c.Items) < 2 {
		return nil, rooms.Reject("NOT_ENOUGH_WORDS", "Memory needs at least 2 words.")
	}
	return &State{items: c.Items, pairs: s.Pairs, Phase: PhaseLobby}, nil
}

func (Engine) Join(s rooms.State, seat int, name string) error {
	return s.(*State).Roster.Join(seat, name)
}

func (Engine) Apply(s rooms.State, seat int, raw json.RawMessage, rng *rand.Rand) error {
	st := s.(*State)
	var a struct {
		Type  string `json:"type"`
		Index int    `json:"index"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return rooms.Reject("INVALID_ACTION", "Invalid action.")
	}
	switch a.Type {
	case "start":
		if err := st.Roster.Start(seat, minPlayers); err != nil {
			return err
		}
		st.deal(rng)
		return nil
	case "flip":
		return st.flip(seat, a.Index)
	case "skip":
		if st.Phase != PhasePlaying {
			return rooms.Reject("WRONG_PHASE", "The game is not running.")
		}
		if err := rooms.CheckSkip(seat, st.Turn); err != nil {
			return err
		}
		st.hidePending()
		st.FaceUp = nil
		st.event(st.Turn, "skip", nil)
		st.nextTurn()
		return nil
	case "rematch":
		if st.Phase != PhaseFinished {
			return rooms.Reject("WRONG_PHASE", "The game is not over yet.")
		}
		st.Starter = (st.Starter + 1) % len(st.Roster.Names)
		st.deal(rng)
		return nil
	}
	return rooms.Reject("INVALID_ACTION", "Unknown action.")
}

func (st *State) deal(rng *rand.Rand) {
	items := append([]rooms.Item(nil), st.items...)
	rng.Shuffle(len(items), func(i, j int) { items[i], items[j] = items[j], items[i] })
	if len(items) > st.pairs {
		items = items[:st.pairs]
	}
	st.Cards = st.Cards[:0]
	for _, it := range items {
		st.Cards = append(st.Cards,
			card{PairID: it.ID, Text: it.Source, Side: "source", Owner: -1},
			card{PairID: it.ID, Text: it.Target, Side: "target", Owner: -1})
	}
	rng.Shuffle(len(st.Cards), func(i, j int) { st.Cards[i], st.Cards[j] = st.Cards[j], st.Cards[i] })
	st.FaceUp, st.PendingHide = nil, false
	st.Scores = make([]int, len(st.Roster.Names))
	st.Turn = st.Starter
	st.Phase = PhasePlaying
	st.Last = nil
}

func (st *State) flip(seat, index int) error {
	switch {
	case st.Phase != PhasePlaying:
		return rooms.Reject("WRONG_PHASE", "The game is not running.")
	case seat != st.Turn:
		return rooms.Reject("NOT_YOUR_TURN", "It's not your turn.")
	case index < 0 || index >= len(st.Cards):
		return rooms.Reject("INVALID_CARD", "This card doesn't exist.")
	}
	st.hidePending()
	if st.Cards[index].Matched || contains(st.FaceUp, index) {
		return rooms.Reject("INVALID_CARD", "This card is already face up.")
	}
	st.FaceUp = append(st.FaceUp, index)
	if len(st.FaceUp) < 2 {
		st.event(seat, "flip", st.FaceUp)
		return nil
	}

	a, b := st.FaceUp[0], st.FaceUp[1]
	if st.Cards[a].PairID != st.Cards[b].PairID {
		// Both stay visible until the next flip; the turn passes.
		st.PendingHide = true
		st.event(seat, "mismatch", []int{a, b})
		st.nextTurn()
		return nil
	}
	for _, i := range []int{a, b} {
		st.Cards[i].Matched = true
		st.Cards[i].Owner = seat
	}
	st.Scores[seat]++
	st.FaceUp = nil
	st.event(seat, "match", []int{a, b})
	if st.allMatched() {
		st.Phase = PhaseFinished
	}
	// A match earns another turn.
	return nil
}

func (st *State) hidePending() {
	if st.PendingHide {
		st.FaceUp = nil
		st.PendingHide = false
	}
}

func (st *State) nextTurn() { st.Turn = (st.Turn + 1) % len(st.Roster.Names) }

func (st *State) allMatched() bool {
	for _, c := range st.Cards {
		if !c.Matched {
			return false
		}
	}
	return true
}

func (st *State) event(seat int, kind string, cards []int) {
	st.seq++
	st.Last = &Event{Seq: st.seq, Seat: seat, Kind: kind, Cards: append([]int(nil), cards...)}
}

func contains(xs []int, x int) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// --- view ---------------------------------------------------------------------

type CardView struct {
	FaceUp  bool   `json:"faceUp"`
	Matched bool   `json:"matched"`
	Owner   int    `json:"owner"`
	Text    string `json:"text,omitempty"` // only for visible cards
	Side    string `json:"side,omitempty"`
}

type PlayerView struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
}

type View struct {
	Phase      string       `json:"phase"`
	You        int          `json:"you"`
	Turn       int          `json:"turn"`
	MinPlayers int          `json:"minPlayers"`
	Players    []PlayerView `json:"players"`
	Cards      []CardView   `json:"cards"`
	Winners    []int        `json:"winners"`
	Last       *Event       `json:"lastEvent"`
}

func (Engine) View(s rooms.State, seat int) any {
	st := s.(*State)
	v := View{Phase: st.Phase, You: seat, Turn: st.Turn, MinPlayers: minPlayers, Last: st.Last,
		Cards: make([]CardView, len(st.Cards)), Winners: []int{}}
	for i, name := range st.Roster.Names {
		score := 0
		if i < len(st.Scores) {
			score = st.Scores[i]
		}
		v.Players = append(v.Players, PlayerView{Name: name, Score: score})
	}
	for i, c := range st.Cards {
		cv := CardView{Matched: c.Matched, Owner: c.Owner, FaceUp: c.Matched || contains(st.FaceUp, i)}
		if cv.FaceUp {
			cv.Text, cv.Side = c.Text, c.Side
		}
		v.Cards[i] = cv
	}
	if st.Phase == PhaseFinished {
		best := -1
		for _, sc := range st.Scores {
			best = max(best, sc)
		}
		for i, sc := range st.Scores {
			if sc == best {
				v.Winners = append(v.Winners, i)
			}
		}
	}
	return v
}
