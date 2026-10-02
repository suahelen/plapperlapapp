// Package stats tracks lightweight, anonymous usage counters: no user data, just
// aggregate numbers (how many teachers, how many words, how many games played).
package stats

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ValidGameTypes mirrors the ids in frontend/src/games/*/definition.ts. Kept here
// rather than trusting client input, since this table is public and unauthenticated.
var ValidGameTypes = map[string]bool{
	"eile-mit-weile":  true,
	"balloon-pop":     true,
	"kaboom":          true,
	"battleship":      true,
	"memory":          true,
	"multiple-choice": true,
	"typing":          true,
	"tabu":            true,
}

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) RecordPlay(ctx context.Context, gameType string) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO game_play_counts (game_type, count) VALUES ($1, 1)
		ON CONFLICT (game_type) DO UPDATE SET count = game_play_counts.count + 1`,
		gameType)
	return err
}

type Totals struct {
	Users      int64            `json:"users"`
	Words      int64            `json:"words"`
	TotalPlays int64            `json:"totalPlays"`
	ByGame     map[string]int64 `json:"byGame"`
}

func (s *Store) Totals(ctx context.Context) (Totals, error) {
	t := Totals{ByGame: map[string]int64{}}
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&t.Users); err != nil {
		return Totals{}, err
	}
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM vocabulary_items`).Scan(&t.Words); err != nil {
		return Totals{}, err
	}
	rows, err := s.db.Query(ctx, `SELECT game_type, count FROM game_play_counts`)
	if err != nil {
		return Totals{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var gameType string
		var count int64
		if err := rows.Scan(&gameType, &count); err != nil {
			return Totals{}, err
		}
		t.ByGame[gameType] = count
		t.TotalPlays += count
	}
	return t, rows.Err()
}
