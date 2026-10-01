// Package auth implements teacher accounts, password login and cookie sessions.
package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"plapperlapapp/internal/http/respond"
)

const (
	cookieName        = "session"
	minPasswordLength = 8
	maxPasswordLength = 72 // bcrypt limit
	bcryptCost        = 12
)

// dummyHash is compared against when a login email is unknown so that response
// timing does not reveal which emails are registered.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-equaliser"), bcryptCost)

type Handlers struct {
	store        *Store
	limiter      *Limiter
	cookieSecure bool
	trustProxy   bool
}

func NewHandlers(store *Store, limiter *Limiter, cookieSecure, trustProxy bool) *Handlers {
	return &Handlers{store: store, limiter: limiter, cookieSecure: cookieSecure, trustProxy: trustProxy}
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r) {
		return
	}
	var in credentials
	if !respond.Decode(w, r, &in) {
		return
	}
	email := normalizeEmail(in.Email)
	if _, err := mail.ParseAddress(email); err != nil || len(email) > 254 {
		respond.ValidationError(w, "Please enter a valid email address.")
		return
	}
	if len(in.Password) < minPasswordLength || len(in.Password) > maxPasswordLength {
		respond.ValidationError(w, "Password must be between 8 and 72 characters.")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcryptCost)
	if err != nil {
		respond.Internal(w, r, err)
		return
	}
	user, err := h.store.CreateUser(r.Context(), email, string(hash))
	if errors.Is(err, ErrEmailTaken) {
		respond.Error(w, http.StatusConflict, "EMAIL_TAKEN", "An account with this email already exists.")
		return
	}
	if err != nil {
		respond.Internal(w, r, err)
		return
	}
	if err := h.startSession(w, r, user.ID); err != nil {
		respond.Internal(w, r, err)
		return
	}
	respond.JSON(w, http.StatusCreated, user)
}

func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r) {
		return
	}
	var in credentials
	if !respond.Decode(w, r, &in) {
		return
	}
	email := normalizeEmail(in.Email)
	user, err := h.store.UserByEmail(r.Context(), email)
	if err != nil && !errors.Is(err, ErrNotFound) {
		respond.Internal(w, r, err)
		return
	}
	hash := dummyHash
	if err == nil {
		hash = []byte(user.PasswordHash)
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(in.Password)) != nil || err != nil {
		slog.Info("login failed", "email", email, "ip", ClientIP(r, h.trustProxy))
		respond.Error(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Email or password is incorrect.")
		return
	}
	if err := h.startSession(w, r, user.ID); err != nil {
		respond.Internal(w, r, err)
		return
	}
	respond.JSON(w, http.StatusOK, user)
}

func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		if err := h.store.DeleteSession(r.Context(), c.Value); err != nil {
			respond.Internal(w, r, err)
			return
		}
	}
	h.setCookie(w, "", time.Unix(0, 0))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	user, err := h.store.UserByID(r.Context(), UserID(r.Context()))
	if errors.Is(err, ErrNotFound) {
		respond.Error(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Please log in.")
		return
	}
	if err != nil {
		respond.Internal(w, r, err)
		return
	}
	respond.JSON(w, http.StatusOK, user)
}

// RequireUser rejects requests without a valid session and stores the user ID in the context.
func (h *Handlers) RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil || c.Value == "" {
			respond.Error(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Please log in.")
			return
		}
		userID, err := h.store.UserIDForSession(r.Context(), c.Value)
		if errors.Is(err, ErrNotFound) {
			respond.Error(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Please log in.")
			return
		}
		if err != nil {
			respond.Internal(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDKey{}, userID)))
	})
}

type userIDKey struct{}

// UserID returns the authenticated user's ID. Only valid behind RequireUser.
func UserID(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey{}).(string)
	return id
}

func (h *Handlers) allow(w http.ResponseWriter, r *http.Request) bool {
	if h.limiter.Allow(ClientIP(r, h.trustProxy)) {
		return true
	}
	respond.Error(w, http.StatusTooManyRequests, "TOO_MANY_ATTEMPTS", "Too many attempts. Please wait a minute and try again.")
	return false
}

func (h *Handlers) startSession(w http.ResponseWriter, r *http.Request, userID string) error {
	token, expires, err := h.store.CreateSession(r.Context(), userID)
	if err != nil {
		return err
	}
	h.setCookie(w, token, expires)
	return nil
}

func (h *Handlers) setCookie(w http.ResponseWriter, value string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func normalizeEmail(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}
