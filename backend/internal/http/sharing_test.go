package http_test

import (
	"testing"
)

// Integration tests for sharing (need TEST_DATABASE_URL, like the other API tests).
// They walk through the rights table in package sharing.

type sharedSet struct {
	set
	Role         string `json:"role"`
	OwnerEmail   string `json:"ownerEmail"`
	UsedByOthers int    `json:"usedByOthers"`
}

type share struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	Role   string `json:"role"`
}

func shareSet(c *client, setID, email, role string) int {
	c.t.Helper()
	return c.do("POST", "/api/vocabulary-sets/"+setID+"/shares", map[string]string{"email": email, "role": role}, nil)
}

func TestSharingWordLists(t *testing.T) {
	srv := newServer(t)
	anna, ben, carla := newClient(t, srv), newClient(t, srv), newClient(t, srv)
	anna.register("anna@school.test")
	ben.register("ben@school.test")
	carla.register("carla@school.test")
	s := anna.createSet("Unit 1", "house", "Haus", "dog", "Hund")

	// Not shared yet: invisible to colleagues.
	if st := ben.do("GET", "/api/vocabulary-sets/"+s.ID, nil, nil); st != 404 {
		t.Fatalf("unshared get: %d", st)
	}
	var e apiError
	if st := anna.do("POST", "/api/vocabulary-sets/"+s.ID+"/shares", map[string]string{"email": "nobody@school.test", "role": "viewer"}, &e); st != 404 || e.Error.Code != "USER_NOT_FOUND" {
		t.Fatalf("unknown email: %d %s", st, e.Error.Code)
	}
	if st := anna.do("POST", "/api/vocabulary-sets/"+s.ID+"/shares", map[string]string{"email": "anna@school.test", "role": "viewer"}, &e); st != 400 || e.Error.Code != "CANNOT_SHARE_WITH_SELF" {
		t.Fatalf("self share: %d %s", st, e.Error.Code)
	}

	// Viewer: sees and copies, cannot edit, share or delete.
	if st := shareSet(anna, s.ID, "BEN@school.test", "viewer"); st != 200 {
		t.Fatalf("share viewer: %d", st)
	}
	var got sharedSet
	if st := ben.do("GET", "/api/vocabulary-sets/"+s.ID, nil, &got); st != 200 || got.Role != "viewer" || got.OwnerEmail != "anna@school.test" || len(got.Items) != 2 {
		t.Fatalf("viewer get: %d %+v", st, got)
	}
	var list []sharedSet
	ben.do("GET", "/api/vocabulary-sets", nil, &list)
	if len(list) != 1 || list[0].Role != "viewer" {
		t.Fatalf("viewer list: %+v", list)
	}
	update := map[string]any{"title": "Hacked", "items": []map[string]string{{"source": "a", "target": "b"}}}
	if st := ben.do("PUT", "/api/vocabulary-sets/"+s.ID, update, &e); st != 403 || e.Error.Code != "FORBIDDEN" {
		t.Fatalf("viewer update: %d %s", st, e.Error.Code)
	}
	if st := ben.do("DELETE", "/api/vocabulary-items/"+s.Items[0].ID, nil, nil); st != 403 {
		t.Fatalf("viewer delete item: %d", st)
	}
	if st := shareSet(ben, s.ID, "carla@school.test", "viewer"); st != 403 {
		t.Fatalf("viewer reshare: %d", st)
	}
	if st := ben.do("DELETE", "/api/vocabulary-sets/"+s.ID, nil, nil); st != 403 {
		t.Fatalf("viewer delete: %d", st)
	}
	var copied sharedSet
	if st := ben.do("POST", "/api/vocabulary-sets/"+s.ID+"/copy", map[string]string{"suffix": " (Kopie)"}, &copied); st != 201 ||
		copied.Role != "owner" || copied.Title != "Unit 1 (Kopie)" || len(copied.Items) != 2 {
		t.Fatalf("copy: %d %+v", st, copied)
	}

	// Editor: may edit, still not share or delete.
	if st := shareSet(anna, s.ID, "ben@school.test", "editor"); st != 200 {
		t.Fatalf("upgrade to editor: %d", st)
	}
	if st := ben.do("PUT", "/api/vocabulary-sets/"+s.ID, map[string]any{"title": "Unit 1 (fixed)"}, &got); st != 200 || got.Title != "Unit 1 (fixed)" {
		t.Fatalf("editor update: %d %+v", st, got)
	}
	if st := shareSet(ben, s.ID, "carla@school.test", "viewer"); st != 403 {
		t.Fatalf("editor reshare: %d", st)
	}
	if st := ben.do("DELETE", "/api/vocabulary-sets/"+s.ID, nil, nil); st != 403 {
		t.Fatalf("editor delete: %d", st)
	}

	// Owner manages shares; revoking hides the list again.
	var shares []share
	if st := anna.do("GET", "/api/vocabulary-sets/"+s.ID+"/shares", nil, &shares); st != 200 || len(shares) != 1 || shares[0].Role != "editor" {
		t.Fatalf("list shares: %d %+v", st, shares)
	}
	if st := ben.do("GET", "/api/vocabulary-sets/"+s.ID+"/shares", nil, nil); st != 403 {
		t.Fatalf("editor lists shares: %d", st)
	}
	if st := anna.do("DELETE", "/api/vocabulary-sets/"+s.ID+"/shares/"+shares[0].UserID, nil, nil); st != 204 {
		t.Fatalf("revoke: %d", st)
	}
	if st := ben.do("GET", "/api/vocabulary-sets/"+s.ID, nil, nil); st != 404 {
		t.Fatalf("after revoke: %d", st)
	}
	if st := carla.do("GET", "/api/vocabulary-sets/"+s.ID+"/shares", nil, nil); st != 404 {
		t.Fatalf("stranger lists shares: %d", st)
	}
}

func TestSharedListInOwnActivity(t *testing.T) {
	srv := newServer(t)
	anna, ben := newClient(t, srv), newClient(t, srv)
	anna.register("anna@school.test")
	ben.register("ben@school.test")
	s := anna.createSet("Unit 1", "house", "Haus", "dog", "Hund")

	// Ben can't use Anna's list before it is shared …
	if st := ben.do("POST", "/api/activities", activityBody("Quiz", true, s.ID), nil); st != 400 {
		t.Fatalf("foreign list: %d", st)
	}
	shareSet(anna, s.ID, "ben@school.test", "viewer")
	var a activity
	if st := ben.do("POST", "/api/activities", activityBody("Quiz", true, s.ID), &a); st != 201 {
		t.Fatalf("shared list in own activity: %d", st)
	}
	var got sharedSet
	anna.do("GET", "/api/vocabulary-sets/"+s.ID, nil, &got)
	if got.UsedByOthers != 1 {
		t.Fatalf("usedByOthers = %d", got.UsedByOthers)
	}

	// … and it is a reference: Anna's fix shows up in Ben's activity.
	anna.do("PUT", "/api/vocabulary-sets/"+s.ID, map[string]any{"title": "Unit 1", "items": []map[string]string{
		{"id": s.Items[0].ID, "source": "house", "target": "das Haus"}, {"id": s.Items[1].ID, "source": "dog", "target": "Hund"},
	}}, nil)
	var pub struct {
		Vocabulary []struct{ Target string } `json:"vocabulary"`
	}
	anon := newClient(t, srv)
	anon.do("GET", "/api/public/activities/"+a.PublicID, nil, &pub)
	if len(pub.Vocabulary) != 2 || pub.Vocabulary[0].Target != "das Haus" {
		t.Fatalf("public after owner edit: %+v", pub.Vocabulary)
	}

	// Deleting the list removes it from Ben's activity.
	anna.do("DELETE", "/api/vocabulary-sets/"+s.ID, nil, nil)
	var after struct {
		VocabularySetIDs []string `json:"vocabularySetIds"`
	}
	ben.do("GET", "/api/activities/"+a.ID, nil, &after)
	if len(after.VocabularySetIDs) != 0 {
		t.Fatalf("deleted list still referenced: %v", after.VocabularySetIDs)
	}
}

func TestSharingActivities(t *testing.T) {
	srv := newServer(t)
	anna, ben := newClient(t, srv), newClient(t, srv)
	anna.register("anna@school.test")
	ben.register("ben@school.test")
	s := anna.createSet("Unit 1", "house", "Haus", "dog", "Hund")
	var a activity
	anna.do("POST", "/api/activities", activityBody("Quiz", true, s.ID), &a)

	if st := anna.do("POST", "/api/activities/"+a.ID+"/shares", map[string]string{"email": "ben@school.test", "role": "viewer"}, nil); st != 200 {
		t.Fatalf("share activity: %d", st)
	}
	// Sharing the activity also shares its list (as viewer).
	var got sharedSet
	if st := ben.do("GET", "/api/vocabulary-sets/"+s.ID, nil, &got); st != 200 || got.Role != "viewer" {
		t.Fatalf("list via activity share: %d %+v", st, got)
	}
	if st := ben.do("PUT", "/api/activities/"+a.ID, activityBody("Changed", true, s.ID), nil); st != 403 {
		t.Fatalf("viewer edits activity: %d", st)
	}
	var cp struct {
		activity
		Title            string   `json:"title"`
		Role             string   `json:"role"`
		VocabularySetIDs []string `json:"vocabularySetIds"`
	}
	if st := ben.do("POST", "/api/activities/"+a.ID+"/copy", map[string]string{"suffix": " (Kopie)"}, &cp); st != 201 ||
		cp.Role != "owner" || cp.Published || cp.PublicID == a.PublicID || len(cp.VocabularySetIDs) != 1 || cp.Title != "Quiz (Kopie)" {
		t.Fatalf("copy activity: %d %+v", st, cp)
	}

	anna.do("POST", "/api/activities/"+a.ID+"/shares", map[string]string{"email": "ben@school.test", "role": "editor"}, nil)
	if st := ben.do("PUT", "/api/activities/"+a.ID, activityBody("Changed", true, s.ID), nil); st != 200 {
		t.Fatalf("editor edits activity: %d", st)
	}
	if st := ben.do("DELETE", "/api/activities/"+a.ID, nil, nil); st != 403 {
		t.Fatalf("editor deletes activity: %d", st)
	}
}

func TestActivityWordFilter(t *testing.T) {
	srv := newServer(t)
	anna := newClient(t, srv)
	anna.register("anna@school.test")
	items := []map[string]any{
		{"source": "house", "target": "Haus", "metadata": map[string]any{"fields": map[string]string{"Unit": "1"}}},
		{"source": "dog", "target": "Hund", "metadata": map[string]any{"fields": map[string]string{"Unit": "2"}}},
		{"source": "cat", "target": "Katze", "metadata": map[string]any{"fields": map[string]string{"Unit": "2"}}},
	}
	var s set
	anna.do("POST", "/api/vocabulary-sets", map[string]any{"title": "Textbook", "items": items}, &s)

	var fields map[string][]struct {
		Value string `json:"value"`
		Count int    `json:"count"`
	}
	if st := anna.do("GET", "/api/vocabulary-sets/"+s.ID+"/fields", nil, &fields); st != 200 || len(fields["Unit"]) != 2 || fields["Unit"][1].Count != 2 {
		t.Fatalf("fields: %d %+v", st, fields)
	}

	body := activityBody("Unit 2", true)
	delete(body, "vocabularySetIds")
	body["vocabularySets"] = []map[string]any{{"id": s.ID, "filter": map[string][]string{"Unit": {"2"}}}}
	var a activity
	if st := anna.do("POST", "/api/activities", body, &a); st != 201 {
		t.Fatalf("create filtered activity: %d", st)
	}
	var pub struct {
		Vocabulary []struct{ Source string } `json:"vocabulary"`
	}
	newClient(t, srv).do("GET", "/api/public/activities/"+a.PublicID, nil, &pub)
	if len(pub.Vocabulary) != 2 || pub.Vocabulary[0].Source != "dog" {
		t.Fatalf("filtered vocabulary: %+v", pub.Vocabulary)
	}
}
