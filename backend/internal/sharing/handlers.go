package sharing

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"plapperlapapp/internal/auth"
	"plapperlapapp/internal/database"
	"plapperlapapp/internal/http/respond"
)

// Limiter is satisfied by auth.Limiter.
type Limiter interface {
	Allow(key string) bool
}

// Handlers serves /…/{id}/shares for one resource kind. Only the owner may list,
// add, change or remove shares.
type Handlers struct {
	db       *pgxpool.Pool
	kind     Kind
	limiter  Limiter
	notFound func(http.ResponseWriter)
	// AfterPut runs in the same transaction after a share was added or changed
	// (activities use it to give the colleague access to their word lists).
	AfterPut func(ctx context.Context, tx pgx.Tx, id, userID string) error
}

func NewHandlers(db *pgxpool.Pool, kind Kind, limiter Limiter, notFound func(http.ResponseWriter)) *Handlers {
	return &Handlers{db: db, kind: kind, limiter: limiter, notFound: notFound}
}

func (h *Handlers) List(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	if _, err := h.kind.Require(r.Context(), h.db, auth.UserID(r.Context()), id, IsOwner); !h.handle(w, r, err) {
		return
	}
	shares, err := h.kind.List(r.Context(), h.db, id)
	if !h.handle(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, shares)
}

func (h *Handlers) Put(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	userID := auth.UserID(r.Context())
	// Also limits probing which email addresses have an account.
	if !h.limiter.Allow(userID) {
		respond.Error(w, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many requests. Please wait a moment.")
		return
	}
	var in struct {
		Email string `json:"email"`
		Role  Role   `json:"role"`
	}
	if !respond.Decode(w, r, &in) {
		return
	}
	if !in.Role.Valid() || in.Email == "" {
		respond.ValidationError(w, "Email and a role (viewer or editor) are required.")
		return
	}
	var share Share
	err := database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		if _, err := h.kind.Require(r.Context(), tx, userID, id, IsOwner); err != nil {
			return err
		}
		var err error
		if share, err = h.kind.Put(r.Context(), tx, id, userID, in.Email, in.Role); err != nil {
			return err
		}
		if h.AfterPut != nil {
			return h.AfterPut(r.Context(), tx, id, share.UserID)
		}
		return nil
	})
	if !h.handle(w, r, err) {
		return
	}
	respond.JSON(w, http.StatusOK, share)
}

func (h *Handlers) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	target := chi.URLParam(r, "userId")
	if !database.IsUUID(target) {
		h.notFound(w)
		return
	}
	err := database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		if _, err := h.kind.Require(r.Context(), tx, auth.UserID(r.Context()), id, IsOwner); err != nil {
			return err
		}
		return h.kind.Remove(r.Context(), tx, id, target)
	})
	if !h.handle(w, r, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) id(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !database.IsUUID(id) {
		h.notFound(w)
		return "", false
	}
	return id, true
}

// handle writes the response for err and reports whether processing may continue.
func (h *Handlers) handle(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return true
	}
	if !WriteError(w, err) {
		if errors.Is(err, ErrNotFound) {
			h.notFound(w)
		} else {
			respond.Internal(w, r, err)
		}
	}
	return false
}

// WriteError writes the response for the sharing errors other than ErrNotFound and
// reports whether it did.
func WriteError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, ErrForbidden):
		respond.Error(w, http.StatusForbidden, "FORBIDDEN", "You don't have permission to do this.")
	case errors.Is(err, ErrUserNotFound):
		respond.Error(w, http.StatusNotFound, "USER_NOT_FOUND", "There is no teacher account with this email address.")
	case errors.Is(err, ErrSelf):
		respond.Error(w, http.StatusBadRequest, "CANNOT_SHARE_WITH_SELF", "You can't share with yourself.")
	default:
		return false
	}
	return true
}
