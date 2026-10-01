// Package answer checks typed answers. It mirrors frontend/src/games/shared/answer/check.ts;
// shared/answer-cases.json keeps both implementations in agreement.
package answer

import (
	"slices"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// punctuation is sentence punctuation that never changes a vocabulary answer. Speech
// recognition adds it ("Haus."). Apostrophes and hyphens matter and are kept, but
// typographic apostrophes count as "'".
var punctuation = strings.NewReplacer(
	".", " ", ",", " ", "!", " ", "?", " ", "¡", " ", "¿", " ", ":", " ",
	"\"", " ", "«", " ", "»", " ", "“", " ", "”", " ", "„", " ", "…", " ",
	"’", "'", "‘", "'", "`", "'", "´", "'",
)

// Normalize removes sentence punctuation, unifies apostrophes, trims, collapses
// whitespace, lowercases and applies Unicode NFC.
func Normalize(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(punctuation.Replace(norm.NFC.String(s))), " "))
}

// Alternatives returns the accepted answers for an expected text: the full text and
// every part separated by "/" or ";" (e.g. "Haus / das Haus").
func Alternatives(expected string) []string {
	out := []string{Normalize(expected)}
	for _, part := range strings.FieldsFunc(expected, func(r rune) bool { return r == '/' || r == ';' }) {
		if p := Normalize(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// dropLeadWord removes one allowed leading word ("vous allez" → "allez", "j'aime" →
// "aime"); ok is false if the answer doesn't start with one.
func dropLeadWord(normalized string) (rest string, ok bool) {
	first, after, hasSpace := strings.Cut(normalized, " ")
	if hasSpace && leadWords[first] {
		return after, true
	}
	for _, e := range elided {
		if len(first) > len(e) && strings.HasPrefix(first, e) {
			return normalized[len(e):], true
		}
	}
	return "", false
}

// IsCorrect reports whether given matches expected or one of its alternatives. Pronouns
// and articles the student adds in front are ignored ("vous allez" for "allez"); words
// the expected answer contains are still required.
func IsCorrect(given, expected string) bool {
	accepted := Alternatives(expected)
	for g, ok := Normalize(given), true; ok && g != ""; g, ok = dropLeadWord(g) {
		if slices.Contains(accepted, g) {
			return true
		}
	}
	return false
}
