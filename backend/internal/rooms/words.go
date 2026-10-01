package rooms

import "math/rand/v2"

// Prompt is a word a player has to answer. The expected answer is unexported so it
// can never end up in a JSON view by accident.
type Prompt struct {
	ItemID       string `json:"itemId"`
	Question     string `json:"question"`
	ExpectedSide string `json:"expectedSide"` // "source" or "target"
	QuestionLang string `json:"questionLang,omitempty"`
	ExpectedLang string `json:"expectedLang,omitempty"`
	expected     string
}

// Expected returns the answer to check against.
func (p Prompt) Expected() string { return p.expected }

// MakePrompt asks for an item in the given direction
// ("source-to-target", "target-to-source" or "mixed").
func MakePrompt(it Item, direction string, rng *rand.Rand) Prompt {
	forward := direction != "target-to-source" && (direction != "mixed" || rng.IntN(2) == 0)
	if forward {
		return Prompt{ItemID: it.ID, Question: it.Source, ExpectedSide: "target",
			QuestionLang: it.SourceLanguage, ExpectedLang: it.TargetLanguage, expected: it.Target}
	}
	return Prompt{ItemID: it.ID, Question: it.Target, ExpectedSide: "source",
		QuestionLang: it.TargetLanguage, ExpectedLang: it.SourceLanguage, expected: it.Source}
}

// WordQueue mirrors frontend/src/games/shared/wordQueue.ts: each word once per pass
// in random order; missed words come back after a short gap.
type WordQueue struct {
	items []Item
	queue []int
}

func NewWordQueue(items []Item) *WordQueue {
	return &WordQueue{items: items}
}

func (q *WordQueue) Next(rng *rand.Rand) Item {
	if len(q.queue) == 0 {
		q.queue = rng.Perm(len(q.items))
	}
	i := q.queue[0]
	q.queue = q.queue[1:]
	return q.items[i]
}

// RetryLater schedules the item to come back after `gap` other words.
func (q *WordQueue) RetryLater(itemID string, gap int) {
	idx := -1
	for i, it := range q.items {
		if it.ID == itemID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return
	}
	rest := q.queue[:0:0]
	for _, i := range q.queue {
		if i != idx {
			rest = append(rest, i)
		}
	}
	if gap > len(rest) {
		gap = len(rest)
	}
	q.queue = append(rest[:gap:gap], append([]int{idx}, rest[gap:]...)...)
}
