package activities

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNewPublicID(t *testing.T) {
	seen := map[string]bool{}
	for range 1000 {
		id, err := newPublicID()
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := normalizePublicID(id); !ok {
			t.Fatalf("generated invalid id %q", id)
		}
		if seen[id] {
			t.Fatalf("duplicate id %q", id)
		}
		seen[id] = true
	}
}

func TestNormalizePublicID(t *testing.T) {
	if got, ok := normalizePublicID(" ab7kq2xz "); !ok || got != "AB7KQ2XZ" {
		t.Errorf("got %q %v", got, ok)
	}
	for _, bad := range []string{"", "ABC", "AB7KQ2X0", "AB7KQ2XZZ", "AB-KQ2XZ"} {
		if _, ok := normalizePublicID(bad); ok {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

func TestInputNormalize(t *testing.T) {
	const setID = "8b7c8e2e-4f8a-4d6f-9d3e-2b1a0c9d8e7f"
	in := Input{
		Title:            "  Test  ",
		VocabularySetIDs: []string{setID, setID},
		Games:            []Game{{Type: "memory"}, {Type: "typing", Settings: json.RawMessage(`{"direction":"target-to-source"}`)}},
	}
	if err := in.Normalize(); err != nil {
		t.Fatal(err)
	}
	if in.Title != "Test" || len(in.VocabularySetIDs) != 1 || string(in.Games[0].Settings) != "{}" {
		t.Errorf("normalized: %+v", in)
	}

	dup := Input{Title: "x", VocabularySetIDs: []string{setID}, Games: []Game{{Type: "memory"}, {Type: "memory"}}}
	if dup.Normalize() == nil {
		t.Error("duplicate game types should fail")
	}
}

func TestInputGameLanguage(t *testing.T) {
	const setID = "8b7c8e2e-4f8a-4d6f-9d3e-2b1a0c9d8e7f"
	for lang, ok := range map[string]bool{"": true, "fr": true, " EN ": true, "es": true, "nl": false, "french": false} {
		in := Input{Title: "x", VocabularySetIDs: []string{setID}, Games: []Game{{Type: "memory"}}, GameLanguage: lang}
		if err := in.Normalize(); (err == nil) != ok {
			t.Errorf("GameLanguage %q: err = %v, want ok = %v", lang, err, ok)
		}
		if ok && in.GameLanguage != strings.ToLower(strings.TrimSpace(lang)) {
			t.Errorf("GameLanguage %q normalized to %q", lang, in.GameLanguage)
		}
	}
}
