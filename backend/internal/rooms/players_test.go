package rooms

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"
)

func code(err error) string {
	var ae *ActionError
	if errors.As(err, &ae) {
		return ae.Code
	}
	return fmt.Sprint(err)
}

func TestCleanName(t *testing.T) {
	cases := map[string]string{
		"  Lena  ":              "Lena",
		"":                      "",
		"Anna   Maria":          "Anna Maria",
		strings.Repeat("x", 30): strings.Repeat("x", 20),
		strings.Repeat("ü", 25): strings.Repeat("ü", 20),
	}
	for in, want := range cases {
		if got := CleanName(in, 2); got != want {
			t.Errorf("CleanName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRoster(t *testing.T) {
	var r Roster
	_ = r.Join(0, "Host")
	if err := r.Start(0, 2); code(err) != "NOT_ENOUGH_PLAYERS" {
		t.Fatalf("start alone: %v", err)
	}
	_ = r.Join(1, "")
	if r.Names[1] != "" {
		t.Errorf("default name: %q", r.Names[1])
	}
	if err := r.Start(1, 2); code(err) != "NOT_HOST" {
		t.Fatalf("non-host start: %v", err)
	}
	if err := r.Start(0, 2); err != nil {
		t.Fatal(err)
	}
	if err := r.Join(2, "Late"); code(err) != "GAME_STARTED" {
		t.Fatalf("late join: %v", err)
	}
	if err := r.Start(0, 2); code(err) != "ALREADY_STARTED" {
		t.Fatalf("double start: %v", err)
	}
}

func TestCheckSkip(t *testing.T) {
	if err := CheckSkip(0, 2); err != nil {
		t.Error(err)
	}
	if code(CheckSkip(1, 2)) != "NOT_HOST" || code(CheckSkip(0, 0)) != "INVALID_ACTION" {
		t.Error("skip rules")
	}
}

func TestWordQueue(t *testing.T) {
	items := []Item{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}}
	rng := rand.New(rand.NewPCG(1, 1))
	q := NewWordQueue(items)
	seen := map[string]bool{}
	for range items {
		seen[q.Next(rng).ID] = true
	}
	if len(seen) != len(items) {
		t.Fatalf("each word once per pass: %v", seen)
	}
	first := q.Next(rng)
	q.RetryLater(first.ID, 2)
	got := []string{q.Next(rng).ID, q.Next(rng).ID, q.Next(rng).ID}
	if got[2] != first.ID {
		t.Fatalf("missed word should come back third: %v (missed %s)", got, first.ID)
	}
}

func TestMakePromptHidesAnswer(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 1))
	it := Item{ID: "1", Source: "dog", Target: "Hund"}
	p := MakePrompt(it, "source-to-target", rng)
	if p.Question != "dog" || p.Expected() != "Hund" || p.ExpectedSide != "target" {
		t.Fatalf("forward: %+v", p)
	}
	if r := MakePrompt(it, "target-to-source", rng); r.Question != "Hund" || r.Expected() != "dog" {
		t.Fatalf("reverse: %+v", r)
	}
}
