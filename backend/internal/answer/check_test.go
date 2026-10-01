package answer

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

// Cases are shared with the frontend so both answer checkers behave identically.
func TestSharedCases(t *testing.T) {
	data, err := os.ReadFile("../../../shared/answer-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Normalize [][2]string `json:"normalize"`
		IsCorrect [][3]any    `json:"isCorrect"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases.Normalize {
		if got := Normalize(c[0]); got != c[1] {
			t.Errorf("Normalize(%q) = %q, want %q", c[0], got, c[1])
		}
	}
	for _, c := range cases.IsCorrect {
		given, expected, want := c[0].(string), c[1].(string), c[2].(bool)
		if got := IsCorrect(given, expected); got != want {
			t.Errorf("IsCorrect(%q, %q) = %v, want %v", given, expected, got, want)
		}
	}
}

// The frontend reads shared/lead-words.json directly; the Go copy must match it.
func TestLeadWordsMatchShared(t *testing.T) {
	data, err := os.ReadFile("../../../shared/lead-words.json")
	if err != nil {
		t.Fatal(err)
	}
	var shared struct {
		Words  []string `json:"words"`
		Elided []string `json:"elided"`
	}
	if err := json.Unmarshal(data, &shared); err != nil {
		t.Fatal(err)
	}
	if len(shared.Words) != len(leadWords) {
		t.Errorf("shared has %d lead words, Go has %d", len(shared.Words), len(leadWords))
	}
	for _, w := range shared.Words {
		if !leadWords[w] {
			t.Errorf("lead word %q missing in leadwords.go", w)
		}
	}
	if !slices.Equal(shared.Elided, elided) {
		t.Errorf("elided forms differ: shared %q, Go %q", shared.Elided, elided)
	}
}
