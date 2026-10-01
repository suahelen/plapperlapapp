package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"plapperlapapp/internal/database"
)

const sessionLifetime = 30 * 24 * time.Hour

var (
	ErrNotFound   = errors.New("not found")
	ErrEmailTaken = errors.New("email already registered")
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Store handles users and sessions in the database.
// Session tokens are never stored directly; only an HMAC of the token is persisted.
type Store struct {
	db     *pgxpool.Pool
	secret []byte
}

func NewStore(db *pgxpool.Pool, secret []byte) *Store {
	return &Store{db: db, secret: secret}
}

func (s *Store) CreateUser(ctx context.Context, email, passwordHash string) (User, error) {
	var u User
	err := s.db.QueryRow(ctx,
		`INSERT INTO users (email, password_hash) VALUES ($1, $2)
		 RETURNING id, email, password_hash, created_at`,
		email, passwordHash,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if database.IsUniqueViolation(err) {
		return User{}, ErrEmailTaken
	}
	return u, err
}

func (s *Store) UserByEmail(ctx context.Context, email string) (User, error) {
	return s.scanUser(s.db.QueryRow(ctx,
		`SELECT id, email, password_hash, created_at FROM users WHERE email = $1`, email))
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	return s.scanUser(s.db.QueryRow(ctx,
		`SELECT id, email, password_hash, created_at FROM users WHERE id = $1`, id))
}

func (s *Store) scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// CreateSession returns a new random session token for the user.
func (s *Store) CreateSession(ctx context.Context, userID string) (string, time.Time, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", time.Time{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	expires := time.Now().Add(sessionLifetime)
	_, err := s.db.Exec(ctx,
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		s.hash(token), userID, expires)
	if err != nil {
		return "", time.Time{}, err
	}
	return token, expires, nil
}

// UserIDForSession returns the user owning a valid, unexpired session token.
func (s *Store) UserIDForSession(ctx context.Context, token string) (string, error) {
	var userID string
	var expires time.Time
	err := s.db.QueryRow(ctx,
		`SELECT user_id, expires_at FROM sessions WHERE token_hash = $1`, s.hash(token),
	).Scan(&userID, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if time.Now().After(expires) {
		_ = s.DeleteSession(ctx, token)
		return "", ErrNotFound
	}
	return userID, nil
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, s.hash(token))
	return err
}

func (s *Store) hash(token string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(token))
	return mac.Sum(nil)
}
