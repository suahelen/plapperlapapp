package rooms

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

type fakeLoader struct{}

func (fakeLoader) LoadForRoom(_ context.Context, publicID, gameType string) (Content, error) {
	switch {
	case publicID != "DEMO2345":
		return Content{}, ErrActivityNotFound
	case gameType != "counter":
		return Content{}, ErrGameNotEnabled
	}
	return Content{}, nil
}

type allowAll struct{}

func (allowAll) Allow(string) bool { return true }

func newRoomServer(t *testing.T) *httptest.Server {
	return newRoomServerWithTimeouts(t, 0)
}

// newRoomServerWithTimeouts mimics production, where the http.Server has read/write timeouts.
func newRoomServerWithTimeouts(t *testing.T, timeout time.Duration) *httptest.Server {
	h := NewHandlers(newTestHub(), fakeLoader{}, allowAll{}, func(*http.Request) string { return "test" })
	r := chi.NewRouter()
	r.Post("/api/rooms", h.Create)
	r.Post("/api/rooms/{code}/join", h.Join)
	r.Post("/api/rooms/{code}/actions", h.Action)
	r.Get("/api/rooms/{code}/events", h.Events)
	srv := httptest.NewUnstartedServer(r)
	srv.Config.ReadTimeout = timeout
	srv.Config.WriteTimeout = timeout
	srv.Start()
	t.Cleanup(srv.Close)
	return srv
}

// The event stream must keep working past the server's timeouts (30 s in production).
func TestEventStreamOutlivesServerTimeouts(t *testing.T) {
	srv := newRoomServerWithTimeouts(t, 300*time.Millisecond)
	_, created := post(t, srv.URL+"/api/rooms", `{"publicId":"DEMO2345","gameType":"counter"}`)
	code, tok := created["code"].(string), created["token"].(string)

	stream, err := http.Get(srv.URL + "/api/rooms/" + code + "/events?token=" + tok)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	lines := make(chan string, 10)
	go func() {
		sc := bufio.NewScanner(stream.Body)
		for sc.Scan() {
			if strings.HasPrefix(sc.Text(), "data: ") {
				lines <- sc.Text()
			}
		}
		close(lines)
	}()
	<-lines // initial view

	time.Sleep(900 * time.Millisecond) // well past both timeouts
	post(t, srv.URL+"/api/rooms/"+code+"/actions", `{"type":"inc"}`, "X-Room-Token", tok)
	select {
	case line, ok := <-lines:
		if !ok || !strings.Contains(line, `"mine":1`) {
			t.Fatalf("stream broke after timeout: %q ok=%v", line, ok)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no event after timeout")
	}
}

func post(t *testing.T, url, body string, headers ...string) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func errCode(body map[string]any) string {
	if e, ok := body["error"].(map[string]any); ok {
		return e["code"].(string)
	}
	return ""
}

func TestRoomHTTPFlow(t *testing.T) {
	srv := newRoomServer(t)

	resp, body := post(t, srv.URL+"/api/rooms", `{"publicId":"NOPE2345","gameType":"counter"}`)
	if resp.StatusCode != 404 || errCode(body) != "ACTIVITY_NOT_FOUND" {
		t.Fatalf("unknown activity: %d %v", resp.StatusCode, body)
	}
	resp, body = post(t, srv.URL+"/api/rooms", `{"publicId":"DEMO2345","gameType":"memory"}`)
	if resp.StatusCode != 400 || errCode(body) != "NOT_A_MULTIPLAYER_GAME" {
		t.Fatalf("single-player game: %d %v", resp.StatusCode, body)
	}

	resp, created := post(t, srv.URL+"/api/rooms", `{"publicId":"DEMO2345","gameType":"counter"}`)
	if resp.StatusCode != 201 {
		t.Fatalf("create: %d %v", resp.StatusCode, created)
	}
	code, tok0 := created["code"].(string), created["token"].(string)

	resp, joined := post(t, srv.URL+"/api/rooms/"+code+"/join", `{}`)
	if resp.StatusCode != 200 || joined["seat"] != 1.0 {
		t.Fatalf("join: %d %v", resp.StatusCode, joined)
	}
	resp, body = post(t, srv.URL+"/api/rooms/"+code+"/join", `{}`)
	if resp.StatusCode != 409 || errCode(body) != "ROOM_FULL" {
		t.Fatalf("full: %d %v", resp.StatusCode, body)
	}

	// Open the event stream for player 0.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/rooms/"+code+"/events?token="+tok0, nil)
	stream, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	if ct := stream.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	events := make(chan map[string]any, 10)
	go func() {
		sc := bufio.NewScanner(stream.Body)
		for sc.Scan() {
			if data, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
				var env map[string]any
				_ = json.Unmarshal([]byte(data), &env)
				events <- env
			}
		}
	}()
	next := func() map[string]any {
		select {
		case e := <-events:
			return e
		case <-time.After(3 * time.Second):
			t.Fatal("no event")
			return nil
		}
	}
	next() // initial view

	resp, body = post(t, srv.URL+"/api/rooms/"+code+"/actions", `{"type":"inc"}`, "X-Room-Token", tok0)
	if resp.StatusCode != 204 {
		t.Fatalf("action: %d %v", resp.StatusCode, body)
	}
	if v := next()["view"].(map[string]any); v["mine"] != 1.0 {
		t.Fatalf("view after action: %v", v)
	}

	resp, body = post(t, srv.URL+"/api/rooms/"+code+"/actions", `{"type":"inc"}`, "X-Room-Token", "forged")
	if resp.StatusCode != 403 || errCode(body) != "INVALID_ROOM_TOKEN" {
		t.Fatalf("forged token: %d %v", resp.StatusCode, body)
	}
	resp, body = post(t, srv.URL+"/api/rooms/"+code+"/actions", `{"type":"nope"}`, "X-Room-Token", tok0)
	if resp.StatusCode != 400 || errCode(body) != "INVALID_ACTION" {
		t.Fatalf("invalid action: %d %v", resp.StatusCode, body)
	}
	resp, _ = post(t, srv.URL+"/api/rooms/"+code+"/actions", `not json`, "X-Room-Token", tok0)
	if resp.StatusCode != 400 {
		t.Fatalf("invalid json: %d", resp.StatusCode)
	}

	bad, err := http.Get(srv.URL + "/api/rooms/" + code + "/events?token=forged")
	if err != nil {
		t.Fatal(err)
	}
	bad.Body.Close()
	if bad.StatusCode != 403 {
		t.Fatalf("stream with forged token: %d", bad.StatusCode)
	}
}
