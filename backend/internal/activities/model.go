// Package activities manages shareable activities: a title, one or more vocabulary
// sets and the games enabled for them. The backend treats games as opaque plugins:
// it stores a game type and a settings object but contains no game logic.
package activities

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"plapperlapapp/internal/database"
)

const (
	maxTitleLength      = 200
	maxSetsPerActivity  = 50
	maxGamesPerActivity = 20
	maxSettingsBytes    = 8192
)

var (
	ErrNotFound       = errors.New("not found")
	ErrForeignSet     = errors.New("vocabulary set not owned by user")
	gameTypePattern   = regexp.MustCompile(`^[a-z0-9-]{1,50}$`)
	emptySettingsJSON = json.RawMessage(`{}`)
	// Languages the frontend has game texts for; "" = automatic (the language being learned).
	gameLanguages = map[string]bool{"": true, "de": true, "fr": true, "en": true, "it": true, "es": true}
)

type Activity struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	PublicID         string   `json:"publicId"`
	Published        bool     `json:"published"`
	VocabularySetIDs []string `json:"vocabularySetIds"`
	// VocabularySets is VocabularySetIDs with the word filter per list.
	VocabularySets []SetRef `json:"vocabularySets"`
	Games          []Game   `json:"games"`
	GameLanguage   string   `json:"gameLanguage"`
	// Role of the requesting teacher: owner, editor or viewer.
	Role       string    `json:"role"`
	OwnerEmail string    `json:"ownerEmail"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Game struct {
	Type     string          `json:"type"`
	Settings json.RawMessage `json:"settings"`
}

type Input struct {
	Title            string   `json:"title"`
	Published        bool     `json:"published"`
	VocabularySetIDs []string `json:"vocabularySetIds"`
	// VocabularySets (with filters) takes precedence; VocabularySetIDs is still accepted
	// (each list without a filter).
	VocabularySets []SetRef `json:"vocabularySets"`
	Games          []Game   `json:"games"`
	// GameLanguage is the language games are shown in; "" means automatic.
	GameLanguage string `json:"gameLanguage"`
}

// Normalize trims and validates the input, returning a user-facing message on failure.
func (in *Input) Normalize() error {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		return errors.New("Title must not be empty.")
	}
	if utf8.RuneCountInString(in.Title) > maxTitleLength {
		return fmt.Errorf("Title must be at most %d characters.", maxTitleLength)
	}

	in.GameLanguage = strings.ToLower(strings.TrimSpace(in.GameLanguage))
	if !gameLanguages[in.GameLanguage] {
		return errors.New("Unsupported game language.")
	}

	if len(in.VocabularySets) == 0 {
		for _, id := range in.VocabularySetIDs {
			in.VocabularySets = append(in.VocabularySets, SetRef{ID: id})
		}
	}
	if len(in.VocabularySets) == 0 {
		return errors.New("Select at least one vocabulary set.")
	}
	if len(in.VocabularySets) > maxSetsPerActivity {
		return fmt.Errorf("An activity can use at most %d vocabulary sets.", maxSetsPerActivity)
	}
	seenSets := map[string]bool{}
	sets := make([]SetRef, 0, len(in.VocabularySets))
	for _, ref := range in.VocabularySets {
		ref.ID = strings.ToLower(strings.TrimSpace(ref.ID))
		if !database.IsUUID(ref.ID) {
			return errors.New("Invalid vocabulary set ID.")
		}
		if err := ref.Filter.normalize(); err != nil {
			return err
		}
		if !seenSets[ref.ID] {
			seenSets[ref.ID] = true
			sets = append(sets, ref)
		}
	}
	in.VocabularySets = sets
	in.VocabularySetIDs = setIDs(sets)

	if len(in.Games) == 0 {
		return errors.New("Enable at least one game.")
	}
	if len(in.Games) > maxGamesPerActivity {
		return fmt.Errorf("An activity can enable at most %d games.", maxGamesPerActivity)
	}
	seenGames := map[string]bool{}
	for i := range in.Games {
		g := &in.Games[i]
		if !gameTypePattern.MatchString(g.Type) {
			return fmt.Errorf("Invalid game type %q.", g.Type)
		}
		if seenGames[g.Type] {
			return fmt.Errorf("Game %q is listed twice.", g.Type)
		}
		seenGames[g.Type] = true
		if len(g.Settings) == 0 || string(g.Settings) == "null" {
			g.Settings = emptySettingsJSON
			continue
		}
		if len(g.Settings) > maxSettingsBytes {
			return fmt.Errorf("Settings for %q are too large.", g.Type)
		}
		var obj map[string]any
		if err := json.Unmarshal(g.Settings, &obj); err != nil {
			return fmt.Errorf("Settings for %q must be a JSON object.", g.Type)
		}
	}
	return nil
}

// PublicActivity is the student-facing representation. It deliberately omits
// internal IDs, owner information and anything not needed to play.
type PublicActivity struct {
	Title        string       `json:"title"`
	GameLanguage string       `json:"gameLanguage,omitempty"`
	Games        []Game       `json:"games"`
	Vocabulary   []PublicItem `json:"vocabulary"`
}

type PublicItem struct {
	ID             string          `json:"id"`
	Source         string          `json:"source"`
	Target         string          `json:"target"`
	SourceLanguage string          `json:"sourceLanguage,omitempty"`
	TargetLanguage string          `json:"targetLanguage,omitempty"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
}
