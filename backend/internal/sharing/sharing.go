// Package sharing lets teachers share word lists and activities with colleagues,
// with view or edit rights. The same rules apply to both kinds of resource:
//
//	              owner  editor  viewer
//	see / use       ✓      ✓       ✓
//	copy            ✓      ✓       ✓
//	edit            ✓      ✓       –
//	share, delete   ✓      –       –
package sharing

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Role string

const (
	Owner  Role = "owner"
	Editor Role = "editor"
	Viewer Role = "viewer"
)

func (r Role) CanEdit() bool { return r == Owner || r == Editor }

// Valid reports whether r can be granted to a colleague.
func (r Role) Valid() bool { return r == Editor || r == Viewer }

var (
	// ErrNotFound: the resource doesn't exist or the user may not see it (indistinguishable on purpose).
	ErrNotFound = errors.New("not found")
	// ErrForbidden: the user may see the resource but not do this (e.g. a viewer editing).
	ErrForbidden    = errors.New("forbidden")
	ErrUserNotFound = errors.New("user not found")
	ErrSelf         = errors.New("cannot share with yourself")
)

// Querier is satisfied by *pgxpool.Pool and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Kind describes one shareable resource table. All names are constants, never input.
type Kind struct {
	Resource string // table with id and owner_id
	Shares   string // table with <Column>, user_id, role
	Column   string
}

var (
	Sets       = Kind{Resource: "vocabulary_sets", Shares: "vocabulary_set_shares", Column: "vocabulary_set_id"}
	Activities = Kind{Resource: "activities", Shares: "activity_shares", Column: "activity_id"}
)

// Visible is an SQL condition: the row <alias> is visible to the user in <userParam> ($n).
func (k Kind) Visible(alias, userParam string) string {
	return fmt.Sprintf(`(%[1]s.owner_id = %[2]s OR EXISTS (SELECT 1 FROM %[3]s sh WHERE sh.%[4]s = %[1]s.id AND sh.user_id = %[2]s))`,
		alias, userParam, k.Shares, k.Column)
}

// RoleExpr is an SQL expression with the user's role for row <alias> ('owner', 'editor', 'viewer' or NULL).
func (k Kind) RoleExpr(alias, userParam string) string {
	return fmt.Sprintf(`CASE WHEN %[1]s.owner_id = %[2]s THEN 'owner' ELSE (SELECT sh.role FROM %[3]s sh WHERE sh.%[4]s = %[1]s.id AND sh.user_id = %[2]s) END`,
		alias, userParam, k.Shares, k.Column)
}

// RoleOf returns the user's role for a resource, or ErrNotFound if they have none.
func (k Kind) RoleOf(ctx context.Context, q Querier, userID, id string) (Role, error) {
	var role *string
	err := q.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s r WHERE r.id = $1`, k.RoleExpr("r", "$2"), k.Resource), id, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && role == nil) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return Role(*role), nil
}

// Require returns nil if the user's role allows the action, ErrForbidden if they can see
// the resource but not do this, and ErrNotFound otherwise.
func (k Kind) Require(ctx context.Context, q Querier, userID, id string, allowed func(Role) bool) (Role, error) {
	role, err := k.RoleOf(ctx, q, userID, id)
	if err != nil {
		return "", err
	}
	if !allowed(role) {
		return role, ErrForbidden
	}
	return role, nil
}

func IsOwner(r Role) bool { return r == Owner }
func AnyRole(Role) bool   { return true }

type Share struct {
	UserID    string    `json:"userId"`
	Email     string    `json:"email"`
	Role      Role      `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
}

// List returns the colleagues a resource is shared with.
func (k Kind) List(ctx context.Context, q Querier, id string) ([]Share, error) {
	rows, err := q.Query(ctx, fmt.Sprintf(`
		SELECT u.id, u.email, sh.role, sh.created_at
		FROM %s sh JOIN users u ON u.id = sh.user_id
		WHERE sh.%s = $1 ORDER BY u.email`, k.Shares, k.Column), id)
	if err != nil {
		return nil, err
	}
	shares, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Share, error) {
		var s Share
		err := row.Scan(&s.UserID, &s.Email, &s.Role, &s.CreatedAt)
		return s, err
	})
	if shares == nil {
		shares = []Share{}
	}
	return shares, err
}

// Put shares a resource with the teacher who has this email (or changes their role).
func (k Kind) Put(ctx context.Context, q Querier, id, ownerID, email string, role Role) (Share, error) {
	var s Share
	err := q.QueryRow(ctx, `SELECT id, email FROM users WHERE lower(email) = lower($1)`, strings.TrimSpace(email)).Scan(&s.UserID, &s.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return Share{}, ErrUserNotFound
	}
	if err != nil {
		return Share{}, err
	}
	if s.UserID == ownerID {
		return Share{}, ErrSelf
	}
	err = q.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %[1]s (%[2]s, user_id, role) VALUES ($1, $2, $3)
		ON CONFLICT (%[2]s, user_id) DO UPDATE SET role = EXCLUDED.role
		RETURNING role, created_at`, k.Shares, k.Column), id, s.UserID, role).Scan(&s.Role, &s.CreatedAt)
	return s, err
}

// GrantView gives a user at least view access (never downgrades an existing share;
// does nothing for the owner).
func (k Kind) GrantView(ctx context.Context, q Querier, id, userID string) error {
	_, err := q.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %[1]s (%[2]s, user_id, role)
		SELECT $1, $2, 'viewer' FROM %[3]s r WHERE r.id = $1 AND r.owner_id <> $2
		ON CONFLICT (%[2]s, user_id) DO NOTHING`, k.Shares, k.Column, k.Resource), id, userID)
	return err
}

// Remove revokes a colleague's access.
func (k Kind) Remove(ctx context.Context, q Querier, id, userID string) error {
	tag, err := q.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE %s = $1 AND user_id = $2`, k.Shares, k.Column), id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
