package activities

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxFilterFields = 10
	maxFilterValues = 200
)

// SetRef is a word list used by an activity, with an optional filter on its extra
// columns (vocabulary_items.metadata.fields).
type SetRef struct {
	ID     string `json:"id"`
	Filter Filter `json:"filter"`
}

// Filter selects words by extra column values: {"Unit": ["3", "4"], "Wortart": ["Verb"]}
// keeps words whose Unit is 3 or 4 AND whose Wortart is Verb. Empty keeps all words.
type Filter map[string][]string

func (f *Filter) normalize() error {
	if *f == nil {
		*f = Filter{}
	}
	if len(*f) > maxFilterFields {
		return fmt.Errorf("A word filter can use at most %d columns.", maxFilterFields)
	}
	for key, values := range *f {
		if strings.TrimSpace(key) == "" || utf8.RuneCountInString(key) > 40 {
			return errors.New("Invalid column name in word filter.")
		}
		if len(values) == 0 {
			delete(*f, key) // no values chosen = no restriction
			continue
		}
		if len(values) > maxFilterValues {
			return errors.New("Too many values in word filter.")
		}
	}
	return nil
}

// Matches reports whether an item's metadata passes the filter.
func (f Filter) Matches(metadata json.RawMessage) bool {
	if len(f) == 0 {
		return true
	}
	var meta struct {
		Fields map[string]string `json:"fields"`
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &meta) // unparsable metadata simply has no fields
	}
	for key, allowed := range f {
		value, ok := meta.Fields[key]
		if !ok || !contains(allowed, value) {
			return false
		}
	}
	return true
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func setIDs(refs []SetRef) []string {
	ids := make([]string, len(refs))
	for i, r := range refs {
		ids[i] = r.ID
	}
	return ids
}
