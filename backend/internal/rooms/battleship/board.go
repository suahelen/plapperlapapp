package battleship

import (
	"encoding/json"
	"math/rand/v2"
	"strconv"

	"plapperlapapp/internal/rooms"
)

const (
	maxGridAxis     = 8
	minUsableCells  = 12
	plainLargeSide  = 6
	plainSmallSide  = 5
	plainSmallBelow = 15 // fewer words than this → 5×5 board
)

// Cell is one board field. Its prompt is what a player must answer to fire at it.
type Cell struct {
	Usable       bool
	ItemID       string
	Question     string
	Expected     string
	ExpectedSide string // "source" or "target"; lets the client build answer choices
	QuestionLang string
	ExpectedLang string
}

// Layout is the shared board both players fire at (each at the other's fleet).
type Layout struct {
	Rows  []string
	Cols  []string
	Cells [][]Cell
	// Grid is true for conjugation tables (row × column headers carry meaning).
	Grid bool
}

func (l *Layout) usableCount() int {
	n := 0
	for _, row := range l.Cells {
		for _, c := range row {
			if c.Usable {
				n++
			}
		}
	}
	return n
}

type gridMeta struct {
	Grid *struct {
		Row string `json:"row"`
		Col string `json:"col"`
	} `json:"grid"`
}

// buildLayout uses conjugation-table items (metadata.grid) when there are enough of
// them; otherwise it lays ordinary vocabulary out on a square board.
func buildLayout(items []rooms.Item, direction string, rng *rand.Rand) (Layout, error) {
	if l, ok := gridLayout(items); ok {
		return l, nil
	}
	if len(items) == 0 {
		return Layout{}, rooms.Reject("NO_VOCABULARY", "This activity has no vocabulary.")
	}
	return plainLayout(items, direction, rng), nil
}

func gridLayout(items []rooms.Item) (Layout, bool) {
	var rows, cols []string
	rowIdx, colIdx := map[string]int{}, map[string]int{}
	type placed struct {
		r, c int
		item rooms.Item
	}
	var cells []placed
	for _, it := range items {
		var m gridMeta
		if len(it.Metadata) == 0 || json.Unmarshal(it.Metadata, &m) != nil || m.Grid == nil || m.Grid.Row == "" || m.Grid.Col == "" {
			continue
		}
		r, ok := rowIdx[m.Grid.Row]
		if !ok {
			if len(rows) >= maxGridAxis {
				continue
			}
			r = len(rows)
			rowIdx[m.Grid.Row] = r
			rows = append(rows, m.Grid.Row)
		}
		c, ok := colIdx[m.Grid.Col]
		if !ok {
			if len(cols) >= maxGridAxis {
				continue
			}
			c = len(cols)
			colIdx[m.Grid.Col] = c
			cols = append(cols, m.Grid.Col)
		}
		cells = append(cells, placed{r, c, it})
	}
	l := Layout{Rows: rows, Cols: cols, Grid: true, Cells: make([][]Cell, len(rows))}
	for r := range l.Cells {
		l.Cells[r] = make([]Cell, len(cols))
	}
	for _, p := range cells {
		if l.Cells[p.r][p.c].Usable {
			continue // duplicate cell: first entry wins
		}
		l.Cells[p.r][p.c] = Cell{
			Usable:       true,
			ItemID:       p.item.ID,
			Question:     p.item.Source,
			Expected:     p.item.Target,
			ExpectedSide: "target",
			QuestionLang: p.item.SourceLanguage,
			ExpectedLang: p.item.TargetLanguage,
		}
	}
	return l, l.usableCount() >= minUsableCells
}

func plainLayout(items []rooms.Item, direction string, rng *rand.Rand) Layout {
	side := plainLargeSide
	if len(items) < plainSmallBelow {
		side = plainSmallSide
	}
	l := Layout{Rows: make([]string, side), Cols: make([]string, side), Cells: make([][]Cell, side)}
	for i := range side {
		l.Rows[i] = strconv.Itoa(i + 1)
		l.Cols[i] = string(rune('A' + i))
	}
	// Deal words in shuffled order, reshuffling once all have been used.
	var deck []rooms.Item
	next := func() rooms.Item {
		if len(deck) == 0 {
			deck = append([]rooms.Item(nil), items...)
			rng.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })
		}
		it := deck[0]
		deck = deck[1:]
		return it
	}
	for r := range side {
		l.Cells[r] = make([]Cell, side)
		for c := range side {
			it := next()
			forward := direction != "target-to-source" && (direction != "mixed" || rng.IntN(2) == 0)
			if forward {
				l.Cells[r][c] = Cell{Usable: true, ItemID: it.ID, Question: it.Source, Expected: it.Target,
					ExpectedSide: "target", QuestionLang: it.SourceLanguage, ExpectedLang: it.TargetLanguage}
			} else {
				l.Cells[r][c] = Cell{Usable: true, ItemID: it.ID, Question: it.Target, Expected: it.Source,
					ExpectedSide: "source", QuestionLang: it.TargetLanguage, ExpectedLang: it.SourceLanguage}
			}
		}
	}
	return l
}

// fleetFor returns ship sizes scaled to the number of usable cells.
func fleetFor(usable int) []int {
	switch {
	case usable >= 36:
		return []int{4, 3, 2, 2}
	case usable >= 25:
		return []int{3, 2, 2}
	default:
		return []int{3, 2}
	}
}

type pos struct{ R, C int }

// placeFleet places ships randomly on usable cells. It first tries to keep ships from
// touching (including diagonally) and relaxes that rule if the board is too tight.
func placeFleet(l *Layout, sizes []int, rng *rand.Rand) [][]pos {
	for _, spacing := range []bool{true, false} {
		for attempt := 0; attempt < 50; attempt++ {
			if ships, ok := tryPlace(l, sizes, spacing, rng); ok {
				return ships
			}
		}
	}
	// Fall back to single-cell ships on usable cells; a valid (if odd) game beats an error.
	var ships [][]pos
	for r, row := range l.Cells {
		for c, cell := range row {
			if cell.Usable && len(ships) < len(sizes) {
				ships = append(ships, []pos{{r, c}})
			}
		}
	}
	return ships
}

func tryPlace(l *Layout, sizes []int, spacing bool, rng *rand.Rand) ([][]pos, bool) {
	rows, cols := len(l.Rows), len(l.Cols)
	taken := map[pos]bool{}
	var ships [][]pos
	for _, size := range sizes {
		placed := false
		for try := 0; try < 200 && !placed; try++ {
			horizontal := rng.IntN(2) == 0
			r, c := rng.IntN(rows), rng.IntN(cols)
			ship := make([]pos, 0, size)
			ok := true
			for k := 0; k < size && ok; k++ {
				p := pos{r, c + k}
				if !horizontal {
					p = pos{r + k, c}
				}
				if p.R >= rows || p.C >= cols || !l.Cells[p.R][p.C].Usable || taken[p] {
					ok = false
					break
				}
				if spacing && touches(p, taken) {
					ok = false
					break
				}
				ship = append(ship, p)
			}
			if ok {
				for _, p := range ship {
					taken[p] = true
				}
				ships = append(ships, ship)
				placed = true
			}
		}
		if !placed {
			return nil, false
		}
	}
	return ships, true
}

func touches(p pos, taken map[pos]bool) bool {
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			if taken[pos{p.R + dr, p.C + dc}] {
				return true
			}
		}
	}
	return false
}
