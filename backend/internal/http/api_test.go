package http_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"plapperlapapp/internal/config"
	apihttp "plapperlapapp/internal/http"
	"plapperlapapp/internal/rooms"
	"plapperlapapp/internal/testutil"
)

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newServer(t *testing.T) *httptest.Server {
	db := testutil.DB(t)
	cfg := config.Config{SessionSecret: []byte("test-secret-test-secret")}
	srv := httptest.NewServer(apihttp.NewRouter(cfg, db, rooms.NewHub(nil)))
	t.Cleanup(srv.Close)
	return srv
}

func newClient(t *testing.T, srv *httptest.Server) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: srv.URL, http: &http.Client{Jar: jar}}
}

// do sends a JSON request and decodes the JSON response into out (if non-nil).
func (c *client) do(method, path string, body any, out any, headers ...string) int {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, r)
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			c.t.Fatalf("%s %s: decode %q: %v", method, path, data, err)
		}
	}
	return resp.StatusCode
}

func (c *client) register(email string) {
	c.t.Helper()
	if s := c.do("POST", "/api/auth/register", map[string]string{"email": email, "password": "password123"}, nil); s != 201 {
		c.t.Fatalf("register %s: status %d", email, s)
	}
}

type apiError struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type set struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Items []struct {
		ID     string `json:"id"`
		Source string `json:"source"`
		Target string `json:"target"`
	} `json:"items"`
}

type activity struct {
	ID        string `json:"id"`
	PublicID  string `json:"publicId"`
	Published bool   `json:"published"`
}

func (c *client) createSet(title string, pairs ...string) set {
	c.t.Helper()
	items := []map[string]string{}
	for i := 0; i+1 < len(pairs); i += 2 {
		items = append(items, map[string]string{"source": pairs[i], "target": pairs[i+1]})
	}
	var s set
	if st := c.do("POST", "/api/vocabulary-sets", map[string]any{"title": title, "items": items}, &s); st != 201 {
		c.t.Fatalf("create set: status %d", st)
	}
	return s
}

func activityBody(title string, published bool, setIDs ...string) map[string]any {
	return map[string]any{
		"title":            title,
		"published":        published,
		"vocabularySetIds": setIDs,
		"games":            []map[string]any{{"type": "eile-mit-weile", "settings": map[string]any{"players": 2}}},
	}
}

func TestAuthFlow(t *testing.T) {
	srv := newServer(t)
	c := newClient(t, srv)

	if s := c.do("GET", "/api/auth/me", nil, nil); s != 401 {
		t.Fatalf("me without session: want 401, got %d", s)
	}

	var e apiError
	if s := c.do("POST", "/api/auth/register", map[string]string{"email": "not-an-email", "password": "password123"}, &e); s != 400 || e.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("invalid email: got %d %s", s, e.Error.Code)
	}
	if s := c.do("POST", "/api/auth/register", map[string]string{"email": "a@example.com", "password": "short"}, nil); s != 400 {
		t.Fatalf("short password: want 400, got %d", s)
	}

	c.register("Teacher@Example.com ")
	var me struct{ Email string }
	if s := c.do("GET", "/api/auth/me", nil, &me); s != 200 || me.Email != "teacher@example.com" {
		t.Fatalf("me after register: %d %q", s, me.Email)
	}
	if s := c.do("POST", "/api/auth/register", map[string]string{"email": "teacher@example.com", "password": "password123"}, &e); s != 409 {
		t.Fatalf("duplicate register: want 409, got %d", s)
	}

	if s := c.do("POST", "/api/auth/logout", nil, nil); s != 204 {
		t.Fatalf("logout: %d", s)
	}
	if s := c.do("GET", "/api/auth/me", nil, nil); s != 401 {
		t.Fatalf("me after logout: want 401, got %d", s)
	}

	if s := c.do("POST", "/api/auth/login", map[string]string{"email": "teacher@example.com", "password": "wrong-password"}, &e); s != 401 || e.Error.Code != "INVALID_CREDENTIALS" {
		t.Fatalf("wrong password: %d %s", s, e.Error.Code)
	}
	if s := c.do("POST", "/api/auth/login", map[string]string{"email": "nobody@example.com", "password": "password123"}, &e); s != 401 || e.Error.Code != "INVALID_CREDENTIALS" {
		t.Fatalf("unknown email: %d %s", s, e.Error.Code)
	}
	if s := c.do("POST", "/api/auth/login", map[string]string{"email": "TEACHER@example.com", "password": "password123"}, nil); s != 200 {
		t.Fatalf("login: %d", s)
	}
	if s := c.do("GET", "/api/auth/me", nil, nil); s != 200 {
		t.Fatalf("me after login: %d", s)
	}
}

func TestLoginRateLimit(t *testing.T) {
	srv := newServer(t)
	c := newClient(t, srv)
	last := 0
	for range 25 {
		last = c.do("POST", "/api/auth/login", map[string]string{"email": "x@example.com", "password": "password123"}, nil)
	}
	if last != 429 {
		t.Fatalf("want 429 after many attempts, got %d", last)
	}
}

func TestCrossOriginRejected(t *testing.T) {
	srv := newServer(t)
	c := newClient(t, srv)
	c.register("t@example.com")
	var e apiError
	s := c.do("POST", "/api/vocabulary-sets", map[string]any{"title": "x"}, &e, "Sec-Fetch-Site", "cross-site")
	if s != 403 || e.Error.Code != "CROSS_ORIGIN_REQUEST" {
		t.Fatalf("cross-origin POST: %d %s", s, e.Error.Code)
	}
}

func TestVocabularyCRUD(t *testing.T) {
	srv := newServer(t)
	c := newClient(t, srv)

	if s := c.do("GET", "/api/vocabulary-sets", nil, nil); s != 401 {
		t.Fatalf("list without session: %d", s)
	}
	c.register("t@example.com")

	var e apiError
	if s := c.do("POST", "/api/vocabulary-sets", map[string]any{"title": "  "}, &e); s != 400 || e.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("empty title: %d %s", s, e.Error.Code)
	}
	if s := c.do("POST", "/api/vocabulary-sets", map[string]any{"title": "x", "items": []map[string]string{{"source": "a", "target": " "}}}, &e); s != 400 {
		t.Fatalf("empty target: %d", s)
	}

	s1 := c.createSet("Unit 4", "house", "Haus", "tree", "Baum", "dog", "Hund")
	if len(s1.Items) != 3 || s1.Items[0].Source != "house" {
		t.Fatalf("created set items: %+v", s1.Items)
	}

	// Sync: keep+edit first, drop second, keep third, add new.
	var updated set
	body := map[string]any{
		"title": "Unit 4b",
		"items": []map[string]string{
			{"id": s1.Items[0].ID, "source": "house", "target": "das Haus"},
			{"id": s1.Items[2].ID, "source": "dog", "target": "Hund"},
			{"source": "cat", "target": "Katze"},
		},
	}
	if s := c.do("PUT", "/api/vocabulary-sets/"+s1.ID, body, &updated); s != 200 {
		t.Fatalf("update set: %d", s)
	}
	if updated.Title != "Unit 4b" || len(updated.Items) != 3 ||
		updated.Items[0].ID != s1.Items[0].ID || updated.Items[0].Target != "das Haus" ||
		updated.Items[1].ID != s1.Items[2].ID || updated.Items[2].Source != "cat" {
		t.Fatalf("sync result: %+v", updated)
	}

	var items []struct{ ID, Source string }
	if s := c.do("POST", "/api/vocabulary-sets/"+s1.ID+"/items", []map[string]string{{"source": "bird", "target": "Vogel"}}, &items); s != 201 || len(items) != 4 || items[3].Source != "bird" {
		t.Fatalf("add items: %d %+v", s, items)
	}
	if s := c.do("PUT", "/api/vocabulary-items/"+items[3].ID, map[string]string{"source": "bird", "target": "der Vogel"}, nil); s != 200 {
		t.Fatalf("update item: %d", s)
	}
	if s := c.do("DELETE", "/api/vocabulary-items/"+items[3].ID, nil, nil); s != 204 {
		t.Fatalf("delete item: %d", s)
	}

	var list []struct {
		ID        string
		ItemCount int
	}
	if s := c.do("GET", "/api/vocabulary-sets", nil, &list); s != 200 || len(list) != 1 || list[0].ItemCount != 3 {
		t.Fatalf("list: %d %+v", s, list)
	}

	if s := c.do("GET", "/api/vocabulary-sets/not-a-uuid", nil, &e); s != 404 || e.Error.Code != "VOCABULARY_SET_NOT_FOUND" {
		t.Fatalf("bad id: %d %s", s, e.Error.Code)
	}
	if s := c.do("DELETE", "/api/vocabulary-sets/"+s1.ID, nil, nil); s != 204 {
		t.Fatalf("delete set: %d", s)
	}
	if s := c.do("GET", "/api/vocabulary-sets/"+s1.ID, nil, nil); s != 404 {
		t.Fatalf("get deleted: %d", s)
	}
}

func TestAuthorization(t *testing.T) {
	srv := newServer(t)
	alice := newClient(t, srv)
	bob := newClient(t, srv)
	alice.register("alice@example.com")
	bob.register("bob@example.com")

	aliceSet := alice.createSet("Alice", "a", "b")
	var aliceAct activity
	if s := alice.do("POST", "/api/activities", activityBody("A", false, aliceSet.ID), &aliceAct); s != 201 {
		t.Fatalf("alice create activity: %d", s)
	}

	checks := []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/vocabulary-sets/" + aliceSet.ID, nil},
		{"PUT", "/api/vocabulary-sets/" + aliceSet.ID, map[string]any{"title": "hacked"}},
		{"DELETE", "/api/vocabulary-sets/" + aliceSet.ID, nil},
		{"POST", "/api/vocabulary-sets/" + aliceSet.ID + "/items", []map[string]string{{"source": "x", "target": "y"}}},
		{"PUT", "/api/vocabulary-items/" + aliceSet.Items[0].ID, map[string]string{"source": "x", "target": "y"}},
		{"DELETE", "/api/vocabulary-items/" + aliceSet.Items[0].ID, nil},
		{"GET", "/api/activities/" + aliceAct.ID, nil},
		{"PUT", "/api/activities/" + aliceAct.ID, activityBody("hacked", true, aliceSet.ID)},
		{"DELETE", "/api/activities/" + aliceAct.ID, nil},
	}
	for _, ch := range checks {
		if s := bob.do(ch.method, ch.path, ch.body, nil); s != 404 {
			t.Errorf("bob %s %s: want 404, got %d", ch.method, ch.path, s)
		}
	}

	// Bob must not be able to attach Alice's set to his own activity.
	var e apiError
	if s := bob.do("POST", "/api/activities", activityBody("B", true, aliceSet.ID), &e); s != 400 || e.Error.Code != "VOCABULARY_SET_NOT_FOUND" {
		t.Errorf("bob uses alice's set: %d %s", s, e.Error.Code)
	}

	var list []any
	if bob.do("GET", "/api/vocabulary-sets", nil, &list); len(list) != 0 {
		t.Errorf("bob sees alice's sets: %v", list)
	}

	// Alice's data is untouched.
	var got set
	if s := alice.do("GET", "/api/vocabulary-sets/"+aliceSet.ID, nil, &got); s != 200 || got.Title != "Alice" || len(got.Items) != 1 {
		t.Errorf("alice's set changed: %d %+v", s, got)
	}
}

func TestActivityCRUDAndPublic(t *testing.T) {
	srv := newServer(t)
	c := newClient(t, srv)
	c.register("t@example.com")
	s1 := c.createSet("Unit 3", "house", "Haus", "tree", "Baum")
	s2 := c.createSet("Unit 4", "dog", "Hund", "house", "Haus")

	var e apiError
	bad := []map[string]any{
		{"title": "", "vocabularySetIds": []string{s1.ID}, "games": []map[string]any{{"type": "memory"}}},
		{"title": "x", "vocabularySetIds": []string{}, "games": []map[string]any{{"type": "memory"}}},
		{"title": "x", "vocabularySetIds": []string{s1.ID}, "games": []map[string]any{}},
		{"title": "x", "vocabularySetIds": []string{s1.ID}, "games": []map[string]any{{"type": "Bad Type!"}}},
		{"title": "x", "vocabularySetIds": []string{s1.ID}, "games": []map[string]any{{"type": "memory", "settings": []int{1}}}},
	}
	for i, b := range bad {
		if s := c.do("POST", "/api/activities", b, &e); s != 400 || e.Error.Code != "VALIDATION_ERROR" {
			t.Errorf("invalid activity %d: %d %s", i, s, e.Error.Code)
		}
	}

	var a activity
	if s := c.do("POST", "/api/activities", activityBody("Practice", false, s1.ID, s2.ID), &a); s != 201 {
		t.Fatalf("create activity: %d", s)
	}
	if len(a.PublicID) != 8 || a.Published {
		t.Fatalf("activity: %+v", a)
	}

	// Unpublished: not publicly visible.
	anon := newClient(t, srv)
	if s := anon.do("GET", "/api/public/activities/"+a.PublicID, nil, &e); s != 404 || e.Error.Code != "ACTIVITY_NOT_FOUND" {
		t.Fatalf("unpublished public: %d %s", s, e.Error.Code)
	}

	if s := c.do("PUT", "/api/activities/"+a.ID, activityBody("Practice!", true, s1.ID, s2.ID), &a); s != 200 || !a.Published {
		t.Fatalf("publish: %d %+v", s, a)
	}

	var raw map[string]any
	if s := anon.do("GET", "/api/public/activities/"+strings.ToLower(a.PublicID), nil, &raw); s != 200 {
		t.Fatalf("public: %d", s)
	}
	for _, forbidden := range []string{"id", "ownerId", "publicId", "published"} {
		if _, ok := raw[forbidden]; ok {
			t.Errorf("public payload exposes %q", forbidden)
		}
	}
	if raw["title"] != "Practice!" {
		t.Errorf("title: %v", raw["title"])
	}
	vocab := raw["vocabulary"].([]any)
	if len(vocab) != 3 { // house/Haus appears in both sets and is de-duplicated
		t.Errorf("want 3 vocabulary items, got %d: %v", len(vocab), vocab)
	}
	games := raw["games"].([]any)
	if len(games) != 1 || games[0].(map[string]any)["type"] != "eile-mit-weile" {
		t.Errorf("games: %v", games)
	}

	var list []activity
	if s := c.do("GET", "/api/activities", nil, &list); s != 200 || len(list) != 1 {
		t.Fatalf("list activities: %d %v", s, list)
	}

	if s := anon.do("GET", "/api/public/activities/NOPE", nil, nil); s != 404 {
		t.Errorf("malformed public id: %d", s)
	}
	if s := c.do("DELETE", "/api/activities/"+a.ID, nil, nil); s != 204 {
		t.Fatalf("delete activity: %d", s)
	}
	if s := anon.do("GET", "/api/public/activities/"+a.PublicID, nil, nil); s != 404 {
		t.Errorf("deleted activity still public: %d", s)
	}
}
