// Package testutil provides a migrated PostgreSQL database for integration tests.
//
// Tests using it are skipped unless TEST_DATABASE_URL points at a disposable database.
// All tables are truncated before each test.
package testutil

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"plapperlapapp/internal/database"
)

var migrateOnce sync.Once
var migrateErr error

func DB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping database test")
	}

	migrateOnce.Do(func() {
		_, file, _, _ := runtime.Caller(0)
		dir := filepath.Join(filepath.Dir(file), "..", "..", "..", "database", "migrations")
		migrateErr = database.Migrate(url, dir, "up")
	})
	if migrateErr != nil {
		t.Fatalf("migrate: %v", migrateErr)
	}

	ctx := context.Background()
	pool, err := database.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	_, err = pool.Exec(ctx, `TRUNCATE users, sessions, vocabulary_sets, vocabulary_items,
		activities, activity_vocabulary_sets, activity_games, vocabulary_set_shares, activity_shares CASCADE`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}
