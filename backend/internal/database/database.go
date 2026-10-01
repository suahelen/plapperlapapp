// Package database sets up the PostgreSQL connection pool and runs migrations.
package database

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// WithTx runs fn inside a transaction, committing on success and rolling back on error.
func WithTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// IsUniqueViolation reports whether err is a PostgreSQL unique constraint violation.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// IsUUID reports whether s is a syntactically valid UUID. Handlers use it to turn
// malformed path IDs into 404s instead of database errors.
func IsUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

// Migrate applies ("up") or reverts one step ("down") of the SQL migrations in dir.
func Migrate(databaseURL, dir, direction string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	m, err := migrate.New("file://"+filepath.ToSlash(abs), toMigrateURL(databaseURL))
	if err != nil {
		return fmt.Errorf("init migrations: %w", err)
	}
	defer m.Close()

	switch direction {
	case "up":
		err = m.Up()
	case "down":
		err = m.Steps(-1)
	default:
		return fmt.Errorf("unknown migrate direction %q (use up or down)", direction)
	}
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	return err
}

// golang-migrate's pgx/v5 driver registers the "pgx5" scheme.
func toMigrateURL(url string) string {
	for _, prefix := range []string{"postgres://", "postgresql://"} {
		if len(url) > len(prefix) && url[:len(prefix)] == prefix {
			return "pgx5://" + url[len(prefix):]
		}
	}
	return url
}
