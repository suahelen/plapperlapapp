// Package http wires the API routes and cross-cutting middleware.
package http

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"plapperlapapp/internal/activities"
	"plapperlapapp/internal/auth"
	"plapperlapapp/internal/config"
	"plapperlapapp/internal/http/respond"
	"plapperlapapp/internal/rooms"
	"plapperlapapp/internal/sharing"
	"plapperlapapp/internal/speech"
	"plapperlapapp/internal/stats"
	"plapperlapapp/internal/vocabulary"
)

const maxBodyBytes = 1 << 20 // 1 MB

// NewRouter wires all routes. The room hub is passed in because it outlives requests
// (main starts its cleanup loop).
func NewRouter(cfg config.Config, db *pgxpool.Pool, hub *rooms.Hub) http.Handler {
	authH := auth.NewHandlers(
		auth.NewStore(db, cfg.SessionSecret),
		auth.NewLimiter(20, time.Minute),
		cfg.CookieSecure, cfg.TrustProxy,
	)
	vocabH := vocabulary.NewHandlers(vocabulary.NewStore(db))
	actStore := activities.NewStore(db)
	actH := activities.NewHandlers(actStore)
	// Sharing with colleagues (owner only). The limit also slows probing for registered emails.
	shareLimiter := auth.NewLimiter(30, time.Minute)
	setShares := sharing.NewHandlers(db, sharing.Sets, shareLimiter, func(w http.ResponseWriter) {
		respond.Error(w, http.StatusNotFound, "VOCABULARY_SET_NOT_FOUND", "Vocabulary set was not found.")
	})
	actShares := sharing.NewHandlers(db, sharing.Activities, shareLimiter, func(w http.ResponseWriter) {
		respond.Error(w, http.StatusNotFound, "ACTIVITY_NOT_FOUND", "Activity was not found.")
	})
	// A shared activity also gives the colleague access to its word lists.
	actShares.AfterPut = activities.ShareSetsWith
	// Generous limit: a whole class usually shares one school IP address.
	roomH := rooms.NewHandlers(hub, actStore, auth.NewLimiter(300, time.Minute),
		func(r *http.Request) string { return auth.ClientIP(r, cfg.TrustProxy) })
	// Spoken answers: a class shares one IP, and one clip is sent per answer attempt.
	speechH := speech.New(cfg.ASRURL, auth.NewLimiter(600, time.Minute),
		func(r *http.Request) string { return auth.ClientIP(r, cfg.TrustProxy) })

	r := chi.NewRouter()
	r.Use(recoverer, requestLogger, limitBody(maxBodyBytes))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			respond.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})

		r.Post("/auth/register", authH.Register)
		r.Post("/auth/login", authH.Login)
		r.Post("/auth/logout", authH.Logout)

		r.Get("/public/activities/{publicId}", actH.Public)

		// Anonymous, aggregate-only usage stats: no user data.
		statsH := stats.NewHandlers(stats.NewStore(db), auth.NewLimiter(60, time.Minute),
			func(r *http.Request) string { return auth.ClientIP(r, cfg.TrustProxy) })
		r.Get("/stats", statsH.Totals)
		r.Post("/stats/play", statsH.RecordPlay)

		// Multiplayer rooms: anonymous; players are identified by per-room tokens.
		r.Post("/rooms", roomH.Create)
		r.Post("/rooms/{code}/join", roomH.Join)
		r.Post("/rooms/{code}/actions", roomH.Action)
		r.Get("/rooms/{code}/events", roomH.Events)

		// Speech-to-text for spoken answers (anonymous; limited in the speech package).
		r.Get("/speech/status", speechH.Status)
		r.Post("/transcribe", speechH.Transcribe)

		r.Group(func(r chi.Router) {
			r.Use(authH.RequireUser)

			r.Get("/auth/me", authH.Me)

			r.Get("/vocabulary-sets", vocabH.ListSets)
			r.Post("/vocabulary-sets", vocabH.CreateSet)
			r.Get("/vocabulary-sets/{id}", vocabH.GetSet)
			r.Put("/vocabulary-sets/{id}", vocabH.UpdateSet)
			r.Delete("/vocabulary-sets/{id}", vocabH.DeleteSet)
			r.Post("/vocabulary-sets/{id}/copy", vocabH.CopySet)
			r.Get("/vocabulary-sets/{id}/fields", vocabH.Fields)
			r.Get("/vocabulary-sets/{id}/shares", setShares.List)
			r.Post("/vocabulary-sets/{id}/shares", setShares.Put)
			r.Delete("/vocabulary-sets/{id}/shares/{userId}", setShares.Delete)
			r.Post("/vocabulary-sets/{id}/items", vocabH.AddItems)
			r.Put("/vocabulary-items/{id}", vocabH.UpdateItem)
			r.Delete("/vocabulary-items/{id}", vocabH.DeleteItem)

			r.Get("/activities", actH.List)
			r.Post("/activities", actH.Create)
			r.Get("/activities/{id}", actH.Get)
			r.Put("/activities/{id}", actH.Update)
			r.Delete("/activities/{id}", actH.Delete)
			r.Post("/activities/{id}/copy", actH.Copy)
			r.Get("/activities/{id}/shares", actShares.List)
			r.Post("/activities/{id}/shares", actShares.Put)
			r.Delete("/activities/{id}/shares/{userId}", actShares.Delete)
		})

		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			respond.Error(w, http.StatusNotFound, "NOT_FOUND", "Endpoint was not found.")
		})
		r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
			respond.Error(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method is not allowed.")
		})
	})

	// Reject cross-origin state-changing requests (CSRF) using Sec-Fetch-Site / Origin.
	csrf := http.NewCrossOriginProtection()
	csrf.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		respond.Error(w, http.StatusForbidden, "CROSS_ORIGIN_REQUEST", "Cross-origin request was rejected.")
	}))
	return csrf.Handler(r)
}
