// Package rooms hosts live multiplayer game rooms in memory.
//
// Single-screen games run entirely in the browser. Multi-screen games need a
// referee that holds hidden state (e.g. ship positions), validates moves and pushes
// each player's view to their device. A room is that referee: the hub stores rooms,
// authenticates players by token and delegates the rules to a game Engine.
//
// Rooms are deliberately not persisted: they are short-lived classroom sessions,
// and a server restart simply ends running games.
package rooms

import (
	"encoding/json"
	"math/rand/v2"
)

// Item is one vocabulary entry of the activity a room was created from.
type Item struct {
	ID             string          `json:"id"`
	Source         string          `json:"source"`
	Target         string          `json:"target"`
	SourceLanguage string          `json:"sourceLanguage,omitempty"`
	TargetLanguage string          `json:"targetLanguage,omitempty"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
}

// Content is what an engine gets to build a game: the activity's vocabulary and
// the teacher's settings for this game.
type Content struct {
	Items    []Item
	Settings json.RawMessage
}

// State is an engine's private game state. The hub never inspects it.
type State any

// Engine implements the rules of one multiplayer game. The hub serialises all calls
// for a room, so engines need no locking.
type Engine interface {
	MaxPlayers() int
	// New creates the game state. The creator joins afterwards via Join(state, 0).
	New(c Content, rng *rand.Rand) (State, error)
	// Join adds the player in the given seat. Games that are already running may refuse.
	Join(s State, seat int, name string) error
	// Apply performs a player's action. Rule violations return an *ActionError.
	Apply(s State, seat int, action json.RawMessage, rng *rand.Rand) error
	// View returns what the player in seat may see. It must hide other players' secrets.
	View(s State, seat int) any
}

// ActionError is a rule violation that is safe to show to the player.
type ActionError struct {
	Code    string
	Message string
}

func (e *ActionError) Error() string { return e.Message }

// Reject builds an ActionError.
func Reject(code, message string) *ActionError {
	return &ActionError{Code: code, Message: message}
}
