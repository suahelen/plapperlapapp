package activities

import (
	"encoding/json"
	"testing"
)

func TestFilterMatches(t *testing.T) {
	f := Filter{"Unit": {"3", "4"}, "Wortart": {"Verb"}}
	cases := []struct {
		meta string
		want bool
	}{
		{`{"fields":{"Unit":"3","Wortart":"Verb"}}`, true},
		{`{"fields":{"Unit":"4","Wortart":"Verb","Seite":"12"}}`, true},
		{`{"fields":{"Unit":"5","Wortart":"Verb"}}`, false},
		{`{"fields":{"Unit":"3"}}`, false},
		{`{"grid":{"row":"je","col":"être"}}`, false},
		{``, false},
		{`not json`, false},
	}
	for _, c := range cases {
		if got := f.Matches(json.RawMessage(c.meta)); got != c.want {
			t.Errorf("Matches(%s) = %v, want %v", c.meta, got, c.want)
		}
	}
	if !(Filter{}).Matches(nil) || !Filter(nil).Matches(json.RawMessage(`{}`)) {
		t.Error("an empty filter keeps every word")
	}
}

func TestInputSetsAndFilters(t *testing.T) {
	const a, b = "8b7c8e2e-4f8a-4d6f-9d3e-2b1a0c9d8e7f", "1b7c8e2e-4f8a-4d6f-9d3e-2b1a0c9d8e7f"
	// Old clients send only IDs.
	in := Input{Title: "x", VocabularySetIDs: []string{a}, Games: []Game{{Type: "memory"}}}
	if err := in.Normalize(); err != nil || len(in.VocabularySets) != 1 || in.VocabularySets[0].Filter == nil {
		t.Fatalf("ids only: %v %+v", err, in.VocabularySets)
	}
	// New clients send lists with filters; empty value lists are dropped, duplicates merged.
	in = Input{Title: "x", Games: []Game{{Type: "memory"}}, VocabularySets: []SetRef{
		{ID: a, Filter: Filter{"Unit": {"3"}, "Seite": {}}}, {ID: b}, {ID: a},
	}}
	if err := in.Normalize(); err != nil {
		t.Fatal(err)
	}
	if len(in.VocabularySets) != 2 || len(in.VocabularySets[0].Filter) != 1 || len(in.VocabularySetIDs) != 2 {
		t.Fatalf("normalized: %+v", in.VocabularySets)
	}
	bad := Input{Title: "x", Games: []Game{{Type: "memory"}}, VocabularySets: []SetRef{{ID: a, Filter: Filter{"": {"1"}}}}}
	if bad.Normalize() == nil {
		t.Error("an empty column name should fail")
	}
}
