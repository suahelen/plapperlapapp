package rooms

import (
	"strings"
	"unicode/utf8"
)

const maxNameLength = 20

// CleanName trims and shortens a player name. An empty name stays empty: clients show
// "Spieler N" / "Joueur N" / … in the game's language instead.
func CleanName(name string, _ int) string {
	name = strings.Join(strings.Fields(name), " ")
	if utf8.RuneCountInString(name) > maxNameLength {
		name = string([]rune(name)[:maxNameLength])
	}
	return name
}

// Roster tracks players in a lobby-style game: players join until the host
// (seat 0) starts the game; afterwards the roster is closed.
type Roster struct {
	Names   []string
	Started bool
}

func (r *Roster) Join(seat int, name string) error {
	if r.Started {
		return Reject("GAME_STARTED", "This game has already started.")
	}
	for len(r.Names) <= seat {
		r.Names = append(r.Names, "")
	}
	r.Names[seat] = CleanName(name, seat)
	return nil
}

// Start closes the roster. Only the host may start, with at least min players.
func (r *Roster) Start(seat, min int) error {
	switch {
	case r.Started:
		return Reject("ALREADY_STARTED", "The game has already started.")
	case seat != 0:
		return Reject("NOT_HOST", "Only the player who created the room can start the game.")
	case len(r.Names) < min:
		return Reject("NOT_ENOUGH_PLAYERS", "Wait for more players to join.")
	}
	r.Started = true
	return nil
}

// CheckSkip allows the host to skip another player's turn (e.g. a disconnected device).
func CheckSkip(actor, current int) error {
	if actor != 0 {
		return Reject("NOT_HOST", "Only the player who created the room can skip a turn.")
	}
	if current == 0 {
		return Reject("INVALID_ACTION", "You can't skip your own turn.")
	}
	return nil
}
