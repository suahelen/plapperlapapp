// Package vocabulary manages teachers' vocabulary sets and their items.
package vocabulary

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxTitleLength    = 200
	maxLanguageLength = 50
	maxTermLength     = 500
	maxItemsPerSet    = 2000
	maxMetadataBytes  = 4096
)

var (
	ErrNotFound = errors.New("not found")
	// ErrForbidden: the user can see the list but not do this (e.g. a viewer editing).
	ErrForbidden = errors.New("forbidden")
)

const (
	maxFields          = 10
	maxFieldNameLength = 40
	maxFieldValueLen   = 100
)

type Set struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	SourceLanguage string `json:"sourceLanguage"`
	TargetLanguage string `json:"targetLanguage"`
	ItemCount      int    `json:"itemCount"`
	// Role of the requesting teacher: owner, editor or viewer.
	Role       string `json:"role"`
	OwnerEmail string `json:"ownerEmail"`
	// UsedByOthers counts activities of other teachers that use this list (GetSet only).
	UsedByOthers int       `json:"usedByOthers"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Items        []Item    `json:"items,omitempty"`
}

type Item struct {
	ID        string          `json:"id"`
	Source    string          `json:"source"`
	Target    string          `json:"target"`
	Metadata  json.RawMessage `json:"metadata,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// SetInput is the body for creating or updating a set.
// When Items is non-nil on update, the set's items are synchronised to match it.
type SetInput struct {
	Title          string      `json:"title"`
	SourceLanguage string      `json:"sourceLanguage"`
	TargetLanguage string      `json:"targetLanguage"`
	Items          []ItemInput `json:"items"`
}

type ItemInput struct {
	ID       string          `json:"id,omitempty"`
	Source   string          `json:"source"`
	Target   string          `json:"target"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}

// Normalize trims fields and validates the input. It returns a user-facing message on failure.
func (in *SetInput) Normalize() error {
	in.Title = strings.TrimSpace(in.Title)
	in.SourceLanguage = strings.TrimSpace(in.SourceLanguage)
	in.TargetLanguage = strings.TrimSpace(in.TargetLanguage)
	if in.Title == "" {
		return errors.New("Title must not be empty.")
	}
	if utf8.RuneCountInString(in.Title) > maxTitleLength {
		return fmt.Errorf("Title must be at most %d characters.", maxTitleLength)
	}
	if utf8.RuneCountInString(in.SourceLanguage) > maxLanguageLength || utf8.RuneCountInString(in.TargetLanguage) > maxLanguageLength {
		return fmt.Errorf("Language names must be at most %d characters.", maxLanguageLength)
	}
	return normalizeItems(in.Items)
}

func normalizeItems(items []ItemInput) error {
	if len(items) > maxItemsPerSet {
		return fmt.Errorf("A vocabulary set can contain at most %d entries.", maxItemsPerSet)
	}
	for i := range items {
		if err := items[i].Normalize(); err != nil {
			return fmt.Errorf("Row %d: %w", i+1, err)
		}
	}
	return nil
}

func (in *ItemInput) Normalize() error {
	in.Source = strings.TrimSpace(in.Source)
	in.Target = strings.TrimSpace(in.Target)
	if in.Source == "" || in.Target == "" {
		return errors.New("source and target must not be empty.")
	}
	if utf8.RuneCountInString(in.Source) > maxTermLength || utf8.RuneCountInString(in.Target) > maxTermLength {
		return fmt.Errorf("entries must be at most %d characters.", maxTermLength)
	}
	if len(in.Metadata) > 0 {
		if string(in.Metadata) == "null" {
			in.Metadata = nil
			return nil
		}
		if len(in.Metadata) > maxMetadataBytes {
			return errors.New("metadata is too large.")
		}
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(in.Metadata, &obj); err != nil {
			return errors.New("metadata must be a JSON object.")
		}
		if raw, ok := obj["fields"]; ok {
			return validateFields(raw)
		}
	}
	return nil
}

// validateFields checks metadata.fields: extra column values such as {"Unit": "3"}.
func validateFields(raw json.RawMessage) error {
	var fields map[string]string
	if err := json.Unmarshal(raw, &fields); err != nil {
		return errors.New("extra columns must be text values.")
	}
	if len(fields) > maxFields {
		return fmt.Errorf("at most %d extra columns are allowed.", maxFields)
	}
	for k, v := range fields {
		if strings.TrimSpace(k) == "" || utf8.RuneCountInString(k) > maxFieldNameLength {
			return fmt.Errorf("extra column names must have 1–%d characters.", maxFieldNameLength)
		}
		if utf8.RuneCountInString(v) > maxFieldValueLen {
			return fmt.Errorf("extra column values must be at most %d characters.", maxFieldValueLen)
		}
	}
	return nil
}
