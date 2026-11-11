package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rp3222079-byte/avito-buddy/backend/internal/api"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

type memorySessions struct {
	values map[string]domain.Session
}

func (s *memorySessions) Create(_ context.Context, session domain.Session, _ time.Duration) (string, error) {
	s.values["session-1"] = session
	return "session-1", nil
}

func (s *memorySessions) Get(_ context.Context, id string) (domain.Session, error) {
	session, ok := s.values[id]
	if !ok {
		return domain.Session{}, domain.ErrNotFound
	}
	return session, nil
}

func (s *memorySessions) Delete(_ context.Context, id string) error {
	delete(s.values, id)
	return nil
}

type memoryTasks struct {
	tasks []domain.Task
}

func (s memoryTasks) ForUser(_ context.Context, userID string) ([]domain.Task, error) {
	result := make([]domain.Task, 0)
	for _, task := range s.tasks {
		if task.Assignee == userID {
			result = append(result, task)
		}
	}
	return result, nil
}

type memoryMentors struct {
	interns map[string][]domain.Intern
}

func (s memoryMentors) ForMentor(_ context.Context, mentorID string) ([]domain.Intern, error) {
	return s.interns[mentorID], nil
}

type memoryTickets struct {
	byKey map[string]domain.Ticket
}

func (s *memoryTickets) CreateOrGet(_ context.Context, userID string, system string) (domain.Ticket, bool, error) {
	key := userID + ":" + system
	if ticket, ok := s.byKey[key]; ok {
		return ticket, false, nil
	}
	ticket := domain.Ticket{TicketID: "IT-123", UserID: userID, System: system, Status: "pending", SLAHours: 2}
	s.byKey[key] = ticket
	return ticket, true, nil
}

type memoryNotifier struct{}

func (memoryNotifier) Notify(_ context.Context, userID string, message string) (domain.Notification, error) {
	if userID != "intern_ivan" || message == "" {
		return domain.Notification{}, domain.ErrNotFound
	}
	return domain.Notification{Status: "sent", MentorName: "Алексей Смит"}, nil
}

type memoryBriefings struct {
	sent map[string]bool
}

func (s *memoryBriefings) Status(_ context.Context, userID string, date string) (bool, error) {
	return s.sent[userID+":"+date], nil
}

func (s *memoryBriefings) Claim(_ context.Context, userID string, date string, _ time.Duration, force bool) (bool, error) {
	key := userID + ":" + date
	if s.sent[key] && !force {
		return false, nil
	}
	s.sent[key] = true
	return true, nil
}

func newRouterWith(configure ...func(*api.Dependencies)) http.Handler {
	deps := api.Dependencies{
		Sessions: &memorySessions{values: make(map[string]domain.Session)},
		Tasks: memoryTasks{tasks: []domain.Task{
			{ID: "AVT-555", Title: "Исправить ошибку", Status: "In Progress", Priority: "Blocker", Assignee: "intern_ivan"},
			{ID: "AVT-559", Title: "Исправить шрифты", Status: "To Do", Priority: "Medium", Assignee: "intern_anna"},
		}},
		Mentors: memoryMentors{interns: map[string][]domain.Intern{
			"mentor_smith": {{InternID: "intern_ivan", Name: "Иван Иванов", ProgressPercent: 55, Status: "blocked"}},
		}},
		Tickets:    &memoryTickets{byKey: make(map[string]domain.Ticket)},
		Notifier:   memoryNotifier{},
		Briefings:  &memoryBriefings{sent: make(map[string]bool)},
		SessionTTL: 24 * time.Hour,
		Now: func() time.Time {
			return time.Date(2026, time.November, 11, 9, 0, 0, 0, time.UTC)
		},
		AllowedIdentities: map[string]domain.Role{
			"intern_ivan":  domain.RoleIntern,
			"mentor_smith": domain.RoleMentor,
		},
	}
	for _, apply := range configure {
		apply(&deps)
	}
	return api.NewRouter(deps)
}

func newRouter() http.Handler {
	return newRouterWith()
}

func login(t *testing.T, router http.Handler, userID string, role domain.Role) *http.Cookie {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(`{"user_id":"`+userID+`","role":"`+string(role)+`"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("login status = %d; body=%s", response.Code, response.Body.String())
	}
	return response.Result().Cookies()[0]
}

func TestSessionAllowsKnownIdentityAndTasksUseIt(t *testing.T) {
	router := newRouter()
	login := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(`{"user_id":"intern_ivan","role":"intern"}`))
	login.Header.Set("Content-Type", "application/json")
	loginResponse := httptest.NewRecorder()
	router.ServeHTTP(loginResponse, login)

	if loginResponse.Code != http.StatusCreated {
		t.Fatalf("POST /api/session status = %d, want %d; body=%s", loginResponse.Code, http.StatusCreated, loginResponse.Body.String())
	}
	if len(loginResponse.Result().Cookies()) != 1 {
		t.Fatalf("session cookie count = %d, want 1", len(loginResponse.Result().Cookies()))
	}

	tasksRequest := httptest.NewRequest(http.MethodGet, "/api/jira/tasks", nil)
	tasksRequest.AddCookie(loginResponse.Result().Cookies()[0])
	tasksResponse := httptest.NewRecorder()
	router.ServeHTTP(tasksResponse, tasksRequest)

	if tasksResponse.Code != http.StatusOK {
		t.Fatalf("GET /api/jira/tasks status = %d, want %d; body=%s", tasksResponse.Code, http.StatusOK, tasksResponse.Body.String())
	}
	var body struct {
		Tasks []domain.Task `json:"tasks"`
	}
	if err := json.Unmarshal(tasksResponse.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Tasks) != 1 || body.Tasks[0].ID != "AVT-555" {
		t.Fatalf("tasks = %#v, want only AVT-555", body.Tasks)
	}
}

func TestTasksRejectRequestWithoutSession(t *testing.T) {
	response := httptest.NewRecorder()
	newRouter().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/jira/tasks", nil))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestDeleteSessionRevokesCookie(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)
	request := httptest.NewRequest(http.MethodDelete, "/api/session", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("DELETE /api/session status = %d; body=%s", response.Code, response.Body.String())
	}
	tasksRequest := httptest.NewRequest(http.MethodGet, "/api/jira/tasks", nil)
	tasksRequest.AddCookie(cookie)
	tasksResponse := httptest.NewRecorder()
	router.ServeHTTP(tasksResponse, tasksRequest)
	if tasksResponse.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session status = %d, want %d", tasksResponse.Code, http.StatusUnauthorized)
	}
}

func TestInternalTokenAuthenticatesAIServiceWithoutBrowserCookie(t *testing.T) {
	router := newRouterWith(func(deps *api.Dependencies) {
		deps.InternalToken = "shared-secret"
	})
	request := httptest.NewRequest(http.MethodGet, "/api/jira/tasks", nil)
	request.Header.Set("X-Internal-Token", "shared-secret")
	request.Header.Set("X-User-ID", "intern_ivan")
	request.Header.Set("X-User-Role", "intern")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("internal request status = %d; body=%s", response.Code, response.Body.String())
	}
}

func TestIdentityHeadersWithoutInternalTokenAreRejected(t *testing.T) {
	router := newRouterWith(func(deps *api.Dependencies) {
		deps.InternalToken = "shared-secret"
	})
	request := httptest.NewRequest(http.MethodGet, "/api/jira/tasks", nil)
	request.Header.Set("X-User-ID", "intern_ivan")
	request.Header.Set("X-User-Role", "intern")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("forged request status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestCORSAllowsConfiguredFrontendWithCredentials(t *testing.T) {
	router := newRouterWith(func(deps *api.Dependencies) {
		deps.AllowedOrigins = []string{"http://localhost:5173"}
	})
	request := httptest.NewRequest(http.MethodOptions, "/api/session", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d", response.Code)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("allow origin = %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
	if response.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("allow credentials = %q", response.Header().Get("Access-Control-Allow-Credentials"))
	}
}

func TestInternCannotReadMentorDashboard(t *testing.T) {
	router := newRouter()
	request := httptest.NewRequest(http.MethodGet, "/api/mentor/interns", nil)
	request.AddCookie(login(t, router, "intern_ivan", domain.RoleIntern))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestMentorReadsOnlyOwnInterns(t *testing.T) {
	router := newRouter()
	request := httptest.NewRequest(http.MethodGet, "/api/mentor/interns", nil)
	request.AddCookie(login(t, router, "mentor_smith", domain.RoleMentor))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var body struct {
		Interns []domain.Intern `json:"interns"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Interns) != 1 || body.Interns[0].InternID != "intern_ivan" {
		t.Fatalf("interns = %#v", body.Interns)
	}
}

func TestRepeatedAccessRequestReturnsExistingTicket(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)

	create := func(system string) (int, domain.Ticket) {
		request := httptest.NewRequest(http.MethodPost, "/api/jira/ticket", strings.NewReader(`{"system":"`+system+`"}`))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		var ticket domain.Ticket
		if err := json.Unmarshal(response.Body.Bytes(), &ticket); err != nil {
			t.Fatal(err)
		}
		return response.Code, ticket
	}

	firstStatus, first := create(" Confluence ")
	secondStatus, second := create("confluence")
	if firstStatus != http.StatusCreated {
		t.Fatalf("first status = %d, want %d", firstStatus, http.StatusCreated)
	}
	if secondStatus != http.StatusOK {
		t.Fatalf("second status = %d, want %d", secondStatus, http.StatusOK)
	}
	if first.TicketID != second.TicketID {
		t.Fatalf("tickets = %#v and %#v", first, second)
	}
}

func TestNotificationUsesMentorFromSession(t *testing.T) {
	router := newRouter()
	request := httptest.NewRequest(http.MethodPost, "/api/notify-mentor", strings.NewReader(`{"message":"Нужна помощь с задачей"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(login(t, router, "intern_ivan", domain.RoleIntern))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var body domain.Notification
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "sent" || body.MentorName != "Алексей Смит" {
		t.Fatalf("notification = %#v", body)
	}
}

func TestBriefingClaimPreventsDuplicateButForceBypassesFlag(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)
	claim := func(force bool) domain.BriefingClaim {
		request := httptest.NewRequest(http.MethodPost, "/api/briefing/claim", strings.NewReader(`{"force":`+map[bool]string{true: "true", false: "false"}[force]+`}`))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
		}
		var body domain.BriefingClaim
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}

	if first := claim(false); !first.ShouldSend || first.Date != "2026-11-11" {
		t.Fatalf("first claim = %#v", first)
	}
	if second := claim(false); second.ShouldSend {
		t.Fatalf("second claim = %#v", second)
	}
	if forced := claim(true); !forced.ShouldSend {
		t.Fatalf("forced claim = %#v", forced)
	}
}

func TestChatProxyReplacesForgedIdentityHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-User-ID") != "intern_ivan" || request.Header.Get("X-User-Role") != "intern" {
			t.Errorf("identity headers = %q/%q", request.Header.Get("X-User-ID"), request.Header.Get("X-User-Role"))
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"reply":"ok"}`))
	}))
	defer upstream.Close()

	router := newRouterWith(func(deps *api.Dependencies) {
		deps.AIBaseURL = upstream.URL
		deps.HTTPClient = upstream.Client()
	})
	request := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{"message":"Привет"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-User-ID", "mentor_smith")
	request.Header.Set("X-User-Role", "mentor")
	request.AddCookie(login(t, router, "intern_ivan", domain.RoleIntern))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || response.Body.String() != `{"reply":"ok"}` {
		t.Fatalf("status/body = %d/%s", response.Code, response.Body.String())
	}
}

func TestChatProxyForwardsSSEWithoutChangingBody(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/event-stream")
		_, _ = response.Write([]byte("event: token\ndata: {\"text\":\"Привет\"}\n\n"))
	}))
	defer upstream.Close()
	router := newRouterWith(func(deps *api.Dependencies) {
		deps.AIBaseURL = upstream.URL
		deps.HTTPClient = upstream.Client()
	})
	request := httptest.NewRequest(http.MethodPost, "/api/chat/stream", strings.NewReader(`{"message":"Привет"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(login(t, router, "intern_ivan", domain.RoleIntern))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	if !strings.Contains(response.Body.String(), "event: token") {
		t.Fatalf("body = %q", response.Body.String())
	}
}
