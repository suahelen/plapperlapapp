package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"plapperlapapp/internal/database"
	"plapperlapapp/internal/sharing"
)

// Store contains all activity SQL. Teacher-facing methods check access: owners and
// colleagues an activity is shared with may see it, owners and editors may change it,
// only owners may delete it (see package sharing).
type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

var (
	ErrForbidden = errors.New("forbidden")

	activityColumns = fmt.Sprintf(`a.id, a.title, a.public_id, a.published, a.game_language, a.created_at, a.updated_at, %s, u.email`,
		sharing.Activities.RoleExpr("a", "$1"))
	activityVisible = sharing.Activities.Visible("a", "$1")
)

// List returns the user's own activities and those shared with them.
func (s *Store) List(ctx context.Context, userID string) ([]Activity, error) {
	rows, err := s.db.Query(ctx, fmt.Sprintf(`
		SELECT %s FROM activities a JOIN users u ON u.id = a.owner_id
		WHERE %s ORDER BY a.updated_at DESC`, activityColumns, activityVisible), userID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanActivity)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if err := s.loadRelations(ctx, &list[i]); err != nil {
			return nil, err
		}
	}
	if list == nil {
		list = []Activity{}
	}
	return list, nil
}

func (s *Store) Get(ctx context.Context, userID, id string) (Activity, error) {
	rows, err := s.db.Query(ctx, fmt.Sprintf(`
		SELECT %s FROM activities a JOIN users u ON u.id = a.owner_id
		WHERE a.id = $2 AND %s`, activityColumns, activityVisible), userID, id)
	if err != nil {
		return Activity{}, err
	}
	a, err := pgx.CollectExactlyOneRow(rows, scanActivity)
	if errors.Is(err, pgx.ErrNoRows) {
		return Activity{}, ErrNotFound
	}
	if err != nil {
		return Activity{}, err
	}
	return a, s.loadRelations(ctx, &a)
}

func requireRole(ctx context.Context, q sharing.Querier, userID, id string, allowed func(sharing.Role) bool) error {
	_, err := sharing.Activities.Require(ctx, q, userID, id, allowed)
	switch {
	case errors.Is(err, sharing.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, sharing.ErrForbidden):
		return ErrForbidden
	}
	return err
}

func (s *Store) Create(ctx context.Context, userID string, in Input) (Activity, error) {
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := checkSetAccess(ctx, tx, userID, "", in.VocabularySetIDs); err != nil {
			return err
		}
		var err error
		id, err = insertActivity(ctx, tx, userID, in)
		if err != nil {
			return err
		}
		return replaceRelations(ctx, tx, id, in)
	})
	if err != nil {
		return Activity{}, err
	}
	return s.Get(ctx, userID, id)
}

// insertActivity creates the activity row with a fresh public ID.
func insertActivity(ctx context.Context, tx pgx.Tx, ownerID string, in Input) (string, error) {
	var id string
	// Retry on the (very unlikely) event of a public ID collision.
	for attempt := 0; ; attempt++ {
		publicID, err := newPublicID()
		if err != nil {
			return "", err
		}
		if _, err = tx.Exec(ctx, `SAVEPOINT public_id`); err != nil {
			return "", err
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO activities (owner_id, title, public_id, published, game_language)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			ownerID, in.Title, publicID, in.Published, in.GameLanguage,
		).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !database.IsUniqueViolation(err) || attempt >= 5 {
			return "", err
		}
		if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT public_id`); err != nil {
			return "", err
		}
	}
}

// Update changes an activity (owners and editors).
func (s *Store) Update(ctx context.Context, userID, id string, in Input) (Activity, error) {
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := requireRole(ctx, tx, userID, id, func(r sharing.Role) bool { return r.CanEdit() }); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE activities SET title = $2, published = $3, game_language = $4, updated_at = now()
			WHERE id = $1`, id, in.Title, in.Published, in.GameLanguage); err != nil {
			return err
		}
		if err := checkSetAccess(ctx, tx, userID, id, in.VocabularySetIDs); err != nil {
			return err
		}
		return replaceRelations(ctx, tx, id, in)
	})
	if err != nil {
		return Activity{}, err
	}
	return s.Get(ctx, userID, id)
}

// Delete removes an activity (owner only).
func (s *Store) Delete(ctx context.Context, userID, id string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := requireRole(ctx, tx, userID, id, sharing.IsOwner); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM activities WHERE id = $1`, id)
		return err
	})
}

// Copy creates the user's own unpublished copy of an activity they can see. It uses
// the same word lists (by reference, with the same filters) – those the user can see.
func (s *Store) Copy(ctx context.Context, userID, id, titleSuffix string) (Activity, error) {
	var newID string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := requireRole(ctx, tx, userID, id, sharing.AnyRole); err != nil {
			return err
		}
		src := Input{}
		if err := tx.QueryRow(ctx, `SELECT left(title || $2, 200), game_language FROM activities WHERE id = $1`, id, titleSuffix).
			Scan(&src.Title, &src.GameLanguage); err != nil {
			return err
		}
		var err error
		if newID, err = insertActivity(ctx, tx, userID, src); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO activity_vocabulary_sets (activity_id, vocabulary_set_id, filter)
			SELECT $2, avs.vocabulary_set_id, avs.filter
			FROM activity_vocabulary_sets avs JOIN vocabulary_sets s ON s.id = avs.vocabulary_set_id
			WHERE avs.activity_id = $3 AND %s`, sharing.Sets.Visible("s", "$1")), userID, newID, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO activity_games (activity_id, game_type, settings, position)
			SELECT $1, game_type, settings, position FROM activity_games WHERE activity_id = $2`, newID, id)
		return err
	})
	if err != nil {
		return Activity{}, err
	}
	return s.Get(ctx, userID, newID)
}

// ShareSetsWith gives a colleague view access to the word lists of an activity that
// belong to the activity's owner, so a shared activity works for them. It runs when an
// activity is shared (sharing.Handlers.AfterPut).
func ShareSetsWith(ctx context.Context, tx pgx.Tx, activityID, userID string) error {
	rows, err := tx.Query(ctx, `
		SELECT avs.vocabulary_set_id
		FROM activity_vocabulary_sets avs
		JOIN activities a ON a.id = avs.activity_id
		JOIN vocabulary_sets s ON s.id = avs.vocabulary_set_id AND s.owner_id = a.owner_id
		WHERE avs.activity_id = $1`, activityID)
	if err != nil {
		return err
	}
	setIDs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, setID := range setIDs {
		if err := sharing.Sets.GrantView(ctx, tx, setID, userID); err != nil {
			return err
		}
	}
	return nil
}

// GetPublic loads a published activity by its public ID, merging the vocabulary of
// all linked sets (each reduced to the activity's filter for it). Exact duplicate
// source/target pairs are dropped.
func (s *Store) GetPublic(ctx context.Context, publicID string) (PublicActivity, error) {
	var activityID string
	out := PublicActivity{Games: []Game{}, Vocabulary: []PublicItem{}}
	err := s.db.QueryRow(ctx, `
		SELECT id, title, game_language FROM activities WHERE public_id = $1 AND published`, publicID,
	).Scan(&activityID, &out.Title, &out.GameLanguage)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicActivity{}, ErrNotFound
	}
	if err != nil {
		return PublicActivity{}, err
	}

	if out.Games, err = s.listGames(ctx, activityID); err != nil {
		return PublicActivity{}, err
	}

	rows, err := s.db.Query(ctx, `
		SELECT i.id, i.source, i.target, s.source_language, s.target_language, i.metadata, avs.filter
		FROM activity_vocabulary_sets avs
		JOIN vocabulary_sets s ON s.id = avs.vocabulary_set_id
		JOIN vocabulary_items i ON i.vocabulary_set_id = s.id
		WHERE avs.activity_id = $1
		ORDER BY s.title, s.id, i.position, i.created_at`, activityID)
	if err != nil {
		return PublicActivity{}, err
	}
	type row struct {
		item   PublicItem
		filter Filter
	}
	items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		var filter []byte
		err := r.Scan(&x.item.ID, &x.item.Source, &x.item.Target, &x.item.SourceLanguage, &x.item.TargetLanguage, &x.item.Metadata, &filter)
		if err == nil {
			err = json.Unmarshal(filter, &x.filter)
		}
		return x, err
	})
	if err != nil {
		return PublicActivity{}, err
	}
	seen := map[[2]string]bool{}
	for _, x := range items {
		if !x.filter.Matches(x.item.Metadata) {
			continue
		}
		key := [2]string{x.item.Source, x.item.Target}
		if seen[key] {
			continue
		}
		seen[key] = true
		out.Vocabulary = append(out.Vocabulary, x.item)
	}
	return out, nil
}

func (s *Store) loadRelations(ctx context.Context, a *Activity) error {
	rows, err := s.db.Query(ctx, `
		SELECT vocabulary_set_id, filter FROM activity_vocabulary_sets WHERE activity_id = $1`, a.ID)
	if err != nil {
		return err
	}
	a.VocabularySets, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (SetRef, error) {
		var ref SetRef
		var filter []byte
		err := r.Scan(&ref.ID, &filter)
		if err == nil {
			err = json.Unmarshal(filter, &ref.Filter)
		}
		if ref.Filter == nil {
			ref.Filter = Filter{}
		}
		return ref, err
	})
	if err != nil {
		return err
	}
	if a.VocabularySets == nil {
		a.VocabularySets = []SetRef{}
	}
	a.VocabularySetIDs = setIDs(a.VocabularySets)
	a.Games, err = s.listGames(ctx, a.ID)
	return err
}

func (s *Store) listGames(ctx context.Context, activityID string) ([]Game, error) {
	rows, err := s.db.Query(ctx, `
		SELECT game_type, settings FROM activity_games
		WHERE activity_id = $1 ORDER BY position`, activityID)
	if err != nil {
		return nil, err
	}
	games, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Game, error) {
		var g Game
		var settings []byte
		err := row.Scan(&g.Type, &settings)
		g.Settings = json.RawMessage(settings)
		return g, err
	})
	if games == nil {
		games = []Game{}
	}
	return games, err
}

func scanActivity(row pgx.CollectableRow) (Activity, error) {
	var a Activity
	err := row.Scan(&a.ID, &a.Title, &a.PublicID, &a.Published, &a.GameLanguage, &a.CreatedAt, &a.UpdatedAt, &a.Role, &a.OwnerEmail)
	return a, err
}

// checkSetAccess ensures the user may use every referenced list: lists they can see,
// plus lists the activity already uses (an editor may keep a colleague's list they
// can't see themselves).
func checkSetAccess(ctx context.Context, tx pgx.Tx, userID, activityID string, setIDs []string) error {
	var n int
	err := tx.QueryRow(ctx, fmt.Sprintf(`
		SELECT count(*) FROM vocabulary_sets s
		WHERE s.id = ANY($2::uuid[]) AND (%s OR EXISTS (
			SELECT 1 FROM activity_vocabulary_sets avs
			WHERE avs.vocabulary_set_id = s.id AND avs.activity_id::text = $3))`, sharing.Sets.Visible("s", "$1")),
		userID, setIDs, activityID).Scan(&n)
	if err != nil {
		return err
	}
	if n != len(setIDs) {
		return ErrForeignSet
	}
	return nil
}

func replaceRelations(ctx context.Context, tx pgx.Tx, activityID string, in Input) error {
	if _, err := tx.Exec(ctx, `DELETE FROM activity_vocabulary_sets WHERE activity_id = $1`, activityID); err != nil {
		return err
	}
	for _, ref := range in.VocabularySets {
		filter, err := json.Marshal(ref.Filter)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO activity_vocabulary_sets (activity_id, vocabulary_set_id, filter) VALUES ($1, $2, $3)`,
			activityID, ref.ID, string(filter)); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM activity_games WHERE activity_id = $1`, activityID); err != nil {
		return err
	}
	for i, g := range in.Games {
		if _, err := tx.Exec(ctx, `
			INSERT INTO activity_games (activity_id, game_type, settings, position) VALUES ($1, $2, $3, $4)`,
			activityID, g.Type, string(g.Settings), i); err != nil {
			return err
		}
	}
	return nil
}
