package activities

import (
	"context"
	"errors"

	"plapperlapapp/internal/rooms"
)

// LoadForRoom implements rooms.ActivityLoader: it returns the vocabulary and game
// settings of a published activity, provided the game is enabled for it.
func (s *Store) LoadForRoom(ctx context.Context, publicID, gameType string) (rooms.Content, error) {
	id, ok := normalizePublicID(publicID)
	if !ok {
		return rooms.Content{}, rooms.ErrActivityNotFound
	}
	a, err := s.GetPublic(ctx, id)
	if errors.Is(err, ErrNotFound) {
		return rooms.Content{}, rooms.ErrActivityNotFound
	}
	if err != nil {
		return rooms.Content{}, err
	}
	for _, g := range a.Games {
		if g.Type != gameType {
			continue
		}
		items := make([]rooms.Item, len(a.Vocabulary))
		for i, v := range a.Vocabulary {
			items[i] = rooms.Item{
				ID:             v.ID,
				Source:         v.Source,
				Target:         v.Target,
				SourceLanguage: v.SourceLanguage,
				TargetLanguage: v.TargetLanguage,
				Metadata:       v.Metadata,
			}
		}
		return rooms.Content{Items: items, Settings: g.Settings}, nil
	}
	return rooms.Content{}, rooms.ErrGameNotEnabled
}
