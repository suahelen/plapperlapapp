package vocabulary

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

// Store contains all vocabulary SQL. Every method checks the user's access: owners and
// colleagues a list is shared with may see it, owners and editors may change it, and
// only owners may delete it (see package sharing).
type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

var (
	visibleSQL = sharing.Sets.Visible("s", "$1")
	roleSQL    = sharing.Sets.RoleExpr("s", "$1")
)

// ListSets returns the user's own lists and the lists shared with them.
func (s *Store) ListSets(ctx context.Context, userID string) ([]Set, error) {
	rows, err := s.db.Query(ctx, fmt.Sprintf(`
		SELECT s.id, s.title, s.source_language, s.target_language, s.created_at, s.updated_at,
		       (SELECT count(*) FROM vocabulary_items i WHERE i.vocabulary_set_id = s.id),
		       %s, u.email
		FROM vocabulary_sets s JOIN users u ON u.id = s.owner_id
		WHERE %s
		ORDER BY s.updated_at DESC`, roleSQL, visibleSQL), userID)
	if err != nil {
		return nil, err
	}
	sets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Set, error) {
		var set Set
		err := row.Scan(&set.ID, &set.Title, &set.SourceLanguage, &set.TargetLanguage,
			&set.CreatedAt, &set.UpdatedAt, &set.ItemCount, &set.Role, &set.OwnerEmail)
		return set, err
	})
	if sets == nil {
		sets = []Set{}
	}
	return sets, err
}

func (s *Store) GetSet(ctx context.Context, userID, id string) (Set, error) {
	var set Set
	err := s.db.QueryRow(ctx, fmt.Sprintf(`
		SELECT s.id, s.title, s.source_language, s.target_language, s.created_at, s.updated_at, %s, u.email,
		       (SELECT count(DISTINCT a.id) FROM activity_vocabulary_sets avs JOIN activities a ON a.id = avs.activity_id
		        WHERE avs.vocabulary_set_id = s.id AND a.owner_id <> s.owner_id)
		FROM vocabulary_sets s JOIN users u ON u.id = s.owner_id
		WHERE s.id = $2 AND %s`, roleSQL, visibleSQL), userID, id,
	).Scan(&set.ID, &set.Title, &set.SourceLanguage, &set.TargetLanguage, &set.CreatedAt, &set.UpdatedAt,
		&set.Role, &set.OwnerEmail, &set.UsedByOthers)
	if errors.Is(err, pgx.ErrNoRows) {
		return Set{}, ErrNotFound
	}
	if err != nil {
		return Set{}, err
	}
	set.Items, err = s.listItems(ctx, id)
	set.ItemCount = len(set.Items)
	return set, err
}

func (s *Store) CreateSet(ctx context.Context, ownerID string, in SetInput) (Set, error) {
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		id, err = createSet(ctx, tx, ownerID, in)
		return err
	})
	if err != nil {
		return Set{}, err
	}
	return s.GetSet(ctx, ownerID, id)
}

func createSet(ctx context.Context, tx pgx.Tx, ownerID string, in SetInput) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO vocabulary_sets (owner_id, title, source_language, target_language)
		VALUES ($1, $2, $3, $4) RETURNING id`,
		ownerID, in.Title, in.SourceLanguage, in.TargetLanguage,
	).Scan(&id)
	if err != nil {
		return "", err
	}
	for i, item := range in.Items {
		if err := insertItem(ctx, tx, id, item, i); err != nil {
			return "", err
		}
	}
	return id, nil
}

// requireRole maps sharing errors to this package's errors.
func requireRole(ctx context.Context, q sharing.Querier, userID, id string, allowed func(sharing.Role) bool) error {
	_, err := sharing.Sets.Require(ctx, q, userID, id, allowed)
	switch {
	case errors.Is(err, sharing.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, sharing.ErrForbidden):
		return ErrForbidden
	}
	return err
}

func canEdit(r sharing.Role) bool { return r.CanEdit() }

// UpdateSet updates the set's fields (owners and editors). If in.Items is non-nil, items
// are synchronised: entries with a known ID are updated, entries without one are
// inserted, and items missing from the list are deleted. Row order becomes the position.
func (s *Store) UpdateSet(ctx context.Context, userID, id string, in SetInput) (Set, error) {
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := requireRole(ctx, tx, userID, id, canEdit); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE vocabulary_sets
			SET title = $2, source_language = $3, target_language = $4, updated_at = now()
			WHERE id = $1`,
			id, in.Title, in.SourceLanguage, in.TargetLanguage)
		if err != nil {
			return err
		}
		if in.Items == nil {
			return nil
		}

		keep := []string{}
		for i, item := range in.Items {
			if item.ID != "" && database.IsUUID(item.ID) {
				tag, err := tx.Exec(ctx, `
					UPDATE vocabulary_items
					SET source = $3, target = $4, metadata = $5, position = $6, updated_at = now()
					WHERE id = $1 AND vocabulary_set_id = $2`,
					item.ID, id, item.Source, item.Target, metadataParam(item.Metadata), i)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 1 {
					keep = append(keep, item.ID)
					continue
				}
			}
			var newID string
			err := tx.QueryRow(ctx, `
				INSERT INTO vocabulary_items (vocabulary_set_id, source, target, metadata, position)
				VALUES ($1, $2, $3, $4, $5) RETURNING id`,
				id, item.Source, item.Target, metadataParam(item.Metadata), i,
			).Scan(&newID)
			if err != nil {
				return err
			}
			keep = append(keep, newID)
		}
		_, err = tx.Exec(ctx, `
			DELETE FROM vocabulary_items
			WHERE vocabulary_set_id = $1 AND NOT (id = ANY($2::uuid[]))`, id, keep)
		return err
	})
	if err != nil {
		return Set{}, err
	}
	return s.GetSet(ctx, userID, id)
}

// DeleteSet deletes a list (owner only). Activities using it lose it.
func (s *Store) DeleteSet(ctx context.Context, userID, id string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := requireRole(ctx, tx, userID, id, sharing.IsOwner); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM vocabulary_sets WHERE id = $1`, id)
		return err
	})
}

// CopySet creates the user's own copy of a list they can see, with all items.
func (s *Store) CopySet(ctx context.Context, userID, id, titleSuffix string) (Set, error) {
	var newID string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := requireRole(ctx, tx, userID, id, sharing.AnyRole); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO vocabulary_sets (owner_id, title, source_language, target_language)
			SELECT $1, left(title || $3, 200), source_language, target_language FROM vocabulary_sets WHERE id = $2
			RETURNING id`, userID, id, titleSuffix).Scan(&newID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO vocabulary_items (vocabulary_set_id, source, target, metadata, position)
			SELECT $1, source, target, metadata, position FROM vocabulary_items WHERE vocabulary_set_id = $2`, newID, id)
		return err
	})
	if err != nil {
		return Set{}, err
	}
	return s.GetSet(ctx, userID, newID)
}

// FieldValue is one value of an extra column with how many words have it.
type FieldValue struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// Fields returns the extra columns of a list (metadata.fields) with their values, for
// choosing words by unit, page, … in an activity.
func (s *Store) Fields(ctx context.Context, userID, id string) (map[string][]FieldValue, error) {
	if err := requireRole(ctx, s.db, userID, id, sharing.AnyRole); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT f.key, f.value, count(*)
		FROM vocabulary_items i, jsonb_each_text(i.metadata->'fields') f
		WHERE i.vocabulary_set_id = $1 AND jsonb_typeof(i.metadata->'fields') = 'object'
		GROUP BY f.key, f.value
		ORDER BY f.key, f.value`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]FieldValue{}
	for rows.Next() {
		var key string
		var v FieldValue
		if err := rows.Scan(&key, &v.Value, &v.Count); err != nil {
			return nil, err
		}
		out[key] = append(out[key], v)
	}
	return out, rows.Err()
}

// AddItems appends items to the end of a set (owners and editors).
func (s *Store) AddItems(ctx context.Context, userID, setID string, items []ItemInput) ([]Item, error) {
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := requireRole(ctx, tx, userID, setID, canEdit); err != nil {
			return err
		}
		var next, count int
		err := tx.QueryRow(ctx, `
			SELECT coalesce(max(position) + 1, 0), count(id)
			FROM vocabulary_items WHERE vocabulary_set_id = $1`, setID,
		).Scan(&next, &count)
		if err != nil {
			return err
		}
		if count+len(items) > maxItemsPerSet {
			return errTooManyItems
		}
		for i, item := range items {
			if err := insertItem(ctx, tx, setID, item, next+i); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE vocabulary_sets SET updated_at = now() WHERE id = $1`, setID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.listItems(ctx, setID)
}

// setOfItem returns the list an item belongs to (no access check).
func setOfItem(ctx context.Context, q sharing.Querier, itemID string) (string, error) {
	var setID string
	err := q.QueryRow(ctx, `SELECT vocabulary_set_id FROM vocabulary_items WHERE id = $1`, itemID).Scan(&setID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return setID, err
}

func (s *Store) UpdateItem(ctx context.Context, userID, itemID string, in ItemInput) (Item, error) {
	var item Item
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		setID, err := setOfItem(ctx, tx, itemID)
		if err != nil {
			return err
		}
		if err := requireRole(ctx, tx, userID, setID, canEdit); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			UPDATE vocabulary_items SET source = $2, target = $3, metadata = $4, updated_at = now()
			WHERE id = $1
			RETURNING id, source, target, metadata, created_at, updated_at`,
			itemID, in.Source, in.Target, metadataParam(in.Metadata),
		).Scan(&item.ID, &item.Source, &item.Target, &item.Metadata, &item.CreatedAt, &item.UpdatedAt)
	})
	return item, err
}

func (s *Store) DeleteItem(ctx context.Context, userID, itemID string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		setID, err := setOfItem(ctx, tx, itemID)
		if err != nil {
			return err
		}
		if err := requireRole(ctx, tx, userID, setID, canEdit); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM vocabulary_items WHERE id = $1`, itemID)
		return err
	})
}

func (s *Store) listItems(ctx context.Context, setID string) ([]Item, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, source, target, metadata, created_at, updated_at
		FROM vocabulary_items WHERE vocabulary_set_id = $1
		ORDER BY position, created_at`, setID)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Item, error) {
		var it Item
		err := row.Scan(&it.ID, &it.Source, &it.Target, &it.Metadata, &it.CreatedAt, &it.UpdatedAt)
		return it, err
	})
	if items == nil {
		items = []Item{}
	}
	return items, err
}

func insertItem(ctx context.Context, tx pgx.Tx, setID string, item ItemInput, position int) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO vocabulary_items (vocabulary_set_id, source, target, metadata, position)
		VALUES ($1, $2, $3, $4, $5)`,
		setID, item.Source, item.Target, metadataParam(item.Metadata), position)
	return err
}

// metadataParam maps empty metadata to SQL NULL.
func metadataParam(m json.RawMessage) any {
	if len(m) == 0 {
		return nil
	}
	return string(m)
}
