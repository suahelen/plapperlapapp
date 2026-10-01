package activities

import (
	"errors"
	"net/http"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"plapperlapapp/internal/auth"
	"plapperlapapp/internal/database"
	"plapperlapapp/internal/http/respond"
)

type Handlers struct {
	store *Store
}

func NewHandlers(store *Store) *Handlers {
	return &Handlers{store: store}
}

func (h *Handlers) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.List(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		respond.Internal(w, r, err)
		return
	}
	respond.JSON(w, http.StatusOK, list)
}

func (h *Handlers) Create(w http.ResponseWriter, r *http.Request) {
	var in Input
	if !respond.Decode(w, r, &in) {
		return
	}
	if err := in.Normalize(); err != nil {
		respond.ValidationError(w, err.Error())
		return
	}
	a, err := h.store.Create(r.Context(), auth.UserID(r.Context()), in)
	if !handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusCreated, a)
}

func (h *Handlers) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := activityID(w, r)
	if !ok {
		return
	}
	a, err := h.store.Get(r.Context(), auth.UserID(r.Context()), id)
	if !handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, a)
}

func (h *Handlers) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := activityID(w, r)
	if !ok {
		return
	}
	var in Input
	if !respond.Decode(w, r, &in) {
		return
	}
	if err := in.Normalize(); err != nil {
		respond.ValidationError(w, err.Error())
		return
	}
	a, err := h.store.Update(r.Context(), auth.UserID(r.Context()), id, in)
	if !handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, a)
}

func (h *Handlers) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := activityID(w, r)
	if !ok {
		return
	}
	if !handleErr(w, r, h.store.Delete(r.Context(), auth.UserID(r.Context()), id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Copy creates the user's own unpublished copy (optional body {"suffix": " (Kopie)"}).
func (h *Handlers) Copy(w http.ResponseWriter, r *http.Request) {
	id, ok := activityID(w, r)
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
	a, err := h.store.Copy(r.Context(), auth.UserID(r.Context()), id, in.Suffix)
	if !handleErr(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusCreated, a)
}

// Public serves a published activity to anonymous students.
func (h *Handlers) Public(w http.ResponseWriter, r *http.Request) {
	publicID, ok := normalizePublicID(chi.URLParam(r, "publicId"))
	if !ok {
		notFound(w)
		return
	}
	a, err := h.store.GetPublic(r.Context(), publicID)
	if !handleErr(w, r, err) {
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	respond.JSON(w, http.StatusOK, a)
}

func handleErr(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, ErrNotFound):
		notFound(w)
	case errors.Is(err, ErrForbidden):
		respond.Error(w, http.StatusForbidden, "FORBIDDEN", "You don't have permission to do this.")
	case errors.Is(err, ErrForeignSet):
		// Same response whether the set does not exist or the user may not see it.
		respond.Error(w, http.StatusBadRequest, "VOCABULARY_SET_NOT_FOUND", "One of the selected vocabulary sets was not found.")
	default:
		respond.Internal(w, r, err)
	}
	return false
}

func activityID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !database.IsUUID(id) {
		notFound(w)
		return "", false
	}
	return id, true
}

func notFound(w http.ResponseWriter) {
	respond.Error(w, http.StatusNotFound, "ACTIVITY_NOT_FOUND", "Activity was not found.")
}
