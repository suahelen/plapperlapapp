package vocabulary

import (
	"errors"
	"net/http"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"plapperlapapp/internal/auth"
	"plapperlapapp/internal/database"
	"plapperlapapp/internal/http/respond"
)

var errTooManyItems = errors.New("too many items")

type Handlers struct {
	store *Store
}

func NewHandlers(store *Store) *Handlers {
	return &Handlers{store: store}
}

func (h *Handlers) ListSets(w http.ResponseWriter, r *http.Request) {
	sets, err := h.store.ListSets(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		respond.Internal(w, r, err)
		return
	}
	respond.JSON(w, http.StatusOK, sets)
}

func (h *Handlers) CreateSet(w http.ResponseWriter, r *http.Request) {
	var in SetInput
	if !respond.Decode(w, r, &in) {
		return
	}
	if err := in.Normalize(); err != nil {
		respond.ValidationError(w, err.Error())
		return
	}
	set, err := h.store.CreateSet(r.Context(), auth.UserID(r.Context()), in)
	if err != nil {
		respond.Internal(w, r, err)
		return
	}
	respond.JSON(w, http.StatusCreated, set)
}

func (h *Handlers) GetSet(w http.ResponseWriter, r *http.Request) {
	id, ok := setID(w, r)
	if !ok {
		return
	}
	set, err := h.store.GetSet(r.Context(), auth.UserID(r.Context()), id)
	if !h.handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, set)
}

func (h *Handlers) UpdateSet(w http.ResponseWriter, r *http.Request) {
	id, ok := setID(w, r)
	if !ok {
		return
	}
	var in SetInput
	if !respond.Decode(w, r, &in) {
		return
	}
	if err := in.Normalize(); err != nil {
		respond.ValidationError(w, err.Error())
		return
	}
	set, err := h.store.UpdateSet(r.Context(), auth.UserID(r.Context()), id, in)
	if !h.handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, set)
}

func (h *Handlers) DeleteSet(w http.ResponseWriter, r *http.Request) {
	id, ok := setID(w, r)
	if !ok {
		return
	}
	if !h.handleErr(w, r, h.store.DeleteSet(r.Context(), auth.UserID(r.Context()), id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// CopySet creates the user's own copy of a list they can see. The optional body
// {"suffix": " (Kopie)"} is appended to the title (the client sends it in the UI language).
func (h *Handlers) CopySet(w http.ResponseWriter, r *http.Request) {
	id, ok := setID(w, r)
	if !ok {
		return
	}
	in := struct {
		Suffix string `json:"suffix"`
	}{Suffix: " (2)"}
	if r.ContentLength > 0 && !respond.Decode(w, r, &in) {
		return
	}
	if utf8.RuneCountInString(in.Suffix) > 40 {
		in.Suffix = " (2)"
	}
	set, err := h.store.CopySet(r.Context(), auth.UserID(r.Context()), id, in.Suffix)
	if !h.handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusCreated, set)
}

// Fields lists the extra columns of a list with their values and counts.
func (h *Handlers) Fields(w http.ResponseWriter, r *http.Request) {
	id, ok := setID(w, r)
	if !ok {
		return
	}
	fields, err := h.store.Fields(r.Context(), auth.UserID(r.Context()), id)
	if !h.handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, fields)
}

// AddItems accepts a JSON array of items and appends them to the set.
func (h *Handlers) AddItems(w http.ResponseWriter, r *http.Request) {
	id, ok := setID(w, r)
	if !ok {
		return
	}
	var items []ItemInput
	if !respond.Decode(w, r, &items) {
		return
	}
	if len(items) == 0 {
		respond.ValidationError(w, "At least one entry is required.")
		return
	}
	if err := normalizeItems(items); err != nil {
		respond.ValidationError(w, err.Error())
		return
	}
	all, err := h.store.AddItems(r.Context(), auth.UserID(r.Context()), id, items)
	if !h.handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusCreated, all)
}

func (h *Handlers) UpdateItem(w http.ResponseWriter, r *http.Request) {
	id, ok := itemID(w, r)
	if !ok {
		return
	}
	var in ItemInput
	if !respond.Decode(w, r, &in) {
		return
	}
	if err := in.Normalize(); err != nil {
		respond.ValidationError(w, "Entry: "+err.Error())
		return
	}
	item, err := h.store.UpdateItem(r.Context(), auth.UserID(r.Context()), id, in)
	if !h.handleItemErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, item)
}

func (h *Handlers) DeleteItem(w http.ResponseWriter, r *http.Request) {
	id, ok := itemID(w, r)
	if !ok {
		return
	}
	if !h.handleItemErr(w, r, h.store.DeleteItem(r.Context(), auth.UserID(r.Context()), id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleErr writes an error response if err is non-nil and reports whether processing may continue.
func (h *Handlers) handleErr(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, ErrNotFound):
		setNotFound(w)
	case errors.Is(err, ErrForbidden):
		respond.Error(w, http.StatusForbidden, "FORBIDDEN", "You don't have permission to do this.")
	case errors.Is(err, errTooManyItems):
		respond.ValidationError(w, "A vocabulary set can contain at most 2000 entries.")
	default:
		respond.Internal(w, r, err)
	}
	return false
}

func (h *Handlers) handleItemErr(w http.ResponseWriter, r *http.Request, err error) bool {
	if errors.Is(err, ErrNotFound) {
		itemNotFound(w)
		return false
	}
	return h.handleErr(w, r, err)
}

func setID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !database.IsUUID(id) {
		setNotFound(w)
		return "", false
	}
	return id, true
}

func itemID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !database.IsUUID(id) {
		itemNotFound(w)
		return "", false
	}
	return id, true
}

func setNotFound(w http.ResponseWriter) {
	respond.Error(w, http.StatusNotFound, "VOCABULARY_SET_NOT_FOUND", "Vocabulary set was not found.")
}

func itemNotFound(w http.ResponseWriter) {
	respond.Error(w, http.StatusNotFound, "VOCABULARY_ITEM_NOT_FOUND", "Vocabulary entry was not found.")
}
