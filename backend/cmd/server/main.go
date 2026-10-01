// Command server runs the vocabulary games API.
//
// Usage:
//
//	server                 start the HTTP API (default)
//	server serve           start the HTTP API
//	server migrate up      apply all pending migrations
//	server migrate down    revert the most recent migration
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"plapperlapapp/internal/config"
	"plapperlapapp/internal/database"
	apihttp "plapperlapapp/internal/http"
	"plapperlapapp/internal/rooms"
	"plapperlapapp/internal/rooms/battleship"
	"plapperlapapp/internal/rooms/eilemitweile"
	"plapperlapapp/internal/rooms/kaboom"
	"plapperlapapp/internal/rooms/memory"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(os.Args[1:]); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	cmd := "serve"
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "serve":
		return serve(cfg)
	case "migrate":
		direction := "up"
		if len(args) > 1 {
			direction = args[1]
		}
		if err := database.Migrate(cfg.DatabaseURL, cfg.MigrationsPath, direction); err != nil {
			return fmt.Errorf("migrate %s: %w", direction, err)
		}
		slog.Info("migrations applied", "direction", direction)
		return nil
	default:
		return fmt.Errorf("unknown command %q (use serve or migrate)", cmd)
	}
}

func serve(cfg config.Config) error {
	if err := cfg.ValidateForServe(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	hub := rooms.NewHub(map[string]rooms.Engine{
		"battleship":     battleship.Engine{},
		"memory":         memory.Engine{},
		"kaboom":         kaboom.Engine{},
		"eile-mit-weile": eilemitweile.Engine{},
	})
	go hub.Run(ctx)

	srv := &http.Server{
		Addr:    ":" + cfg.HTTPPort,
		Handler: apihttp.NewRouter(cfg, db, hub),
		// Request contexts end on shutdown, so long-lived event streams close promptly.
		BaseContext:       func(net.Listener) context.Context { return ctx },
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("server starting", "addr", srv.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
	return nil
}
