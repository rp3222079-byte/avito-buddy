package api_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rp3222079-byte/avito-buddy/backend/internal/api"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

type memorySessions struct {
	values  map[string]domain.Session
	counter int
}

func (s *memorySessions) Create(_ context.Context, session domain.Session, _ time.Duration) (string, error) {
	s.counter++
	id := fmt.Sprintf("session-%d", s.counter)
	s.values[id] = session
	return id, nil
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
	ticket := domain.Ticket{RequestID: "IT-123", UserID: userID, System: system, AccessLevel: "read", Status: "pending", SLAHours: 2}
	s.byKey[key] = ticket
	return ticket, true, nil
}

type memoryNotifier struct {
	sent map[string]domain.Notification
}

func (m *memoryNotifier) Notify(_ context.Context, userID string, message string, idempotencyKey string) (domain.Notification, error) {
	if idempotencyKey != "" {
		if notif, ok := m.sent[idempotencyKey]; ok {
			return notif, nil
		}
		notification := domain.Notification{Status: "sent", MentorName: "Алексей Смит"}
		m.sent[idempotencyKey] = notification
		return notification, nil
	}
	if userID != "intern_ivan" || message == "" {
		return domain.Notification{}, domain.ErrNotFound
	}
	return domain.Notification{Status: "sent", MentorName: "Алексей Смит"}, nil
}

type blockingNotifier struct {
	started chan string
	release chan struct{}
	mu      sync.Mutex
	calls   []string
}

func (m *blockingNotifier) Notify(_ context.Context, _ string, _ string, idempotencyKey string) (domain.Notification, error) {
	m.mu.Lock()
	m.calls = append(m.calls, idempotencyKey)
	m.mu.Unlock()
	m.started <- idempotencyKey
	<-m.release
	return domain.Notification{Status: "sent", MentorName: "Алексей Смит"}, nil
}

type memoryBriefings struct {
	sent map[string]bool
}

func (s *memoryBriefings) Status(_ context.Context, userID string, date string) (bool, error) {
	return s.sent[userID+":"+date], nil
}

func (s *memoryBriefings) Claim(_ context.Context, userID string, date string, _ time.Duration) (bool, error) {
	key := userID + ":" + date
	if s.sent[key] {
		return false, nil
	}
	s.sent[key] = true
	return true, nil
}

type memoryPendingActions struct {
	mu               sync.Mutex
	actions          map[string]*domain.PendingAction
	failTransitionTo string
}

func (m *memoryPendingActions) CreatePendingAction(_ context.Context, action *domain.PendingAction) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	copy := *action
	m.actions[action.PendingID] = &copy
	return nil
}

func (m *memoryPendingActions) GetPendingAction(_ context.Context, pendingID string) (*domain.PendingAction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	action, ok := m.actions[pendingID]
	if !ok {
		return nil, domain.ErrNotFound
	}
	copy := *action
	return &copy, nil
}

func (m *memoryPendingActions) ClaimPendingAction(_ context.Context, pendingID, userID string) (*domain.PendingAction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if action, ok := m.actions[pendingID]; ok {
		if action.UserID != userID {
			return nil, domain.ErrForbidden
		}
		if action.Status != "pending" {
			return nil, domain.ErrConflict
		}
		action.Status = "processing"
		copy := *action
		return &copy, nil
	}
	return nil, domain.ErrNotFound
}

func (m *memoryPendingActions) TransitionPendingActionStatus(_ context.Context, pendingID, userID, from, to string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	action, ok := m.actions[pendingID]
	if !ok {
		return domain.ErrNotFound
	}
	if action.UserID != userID {
		return domain.ErrForbidden
	}
	if action.Status != from {
		return domain.ErrConflict
	}
	if to == m.failTransitionTo {
		return fmt.Errorf("injected status write failure")
	}
	action.Status = to
	return nil
}

func (m *memoryPendingActions) DeletePendingAction(_ context.Context, pendingID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.actions, pendingID)
	return nil
}

func newRouterWith(configure ...func(*api.Dependencies)) http.Handler {
	fixedTime := time.Date(2026, time.November, 11, 9, 0, 0, 0, time.UTC)
	mocks := &memoryTickets{byKey: make(map[string]domain.Ticket)}
	notifier := &memoryNotifier{sent: make(map[string]domain.Notification)}
	briefings := &memoryBriefings{sent: make(map[string]bool)}
	pendingActions := &memoryPendingActions{actions: make(map[string]*domain.PendingAction)}

	deps := api.Dependencies{
		Sessions: &memorySessions{values: make(map[string]domain.Session)},
		Tasks: memoryTasks{tasks: []domain.Task{
			{ID: "AVT-555", Title: "Исправить ошибку", Status: "In Progress", Priority: "Blocker", Assignee: "intern_ivan"},
			{ID: "AVT-559", Title: "Исправить шрифты", Status: "To Do", Priority: "Medium", Assignee: "intern_anna"},
		}},
		Mentors: memoryMentors{interns: map[string][]domain.Intern{
			"mentor_smith": {{InternID: "intern_ivan", Name: "Иван Иванов", ProgressPercent: 55, Status: "blocked"}},
		}},
		Tickets:          mocks,
		Notifier:         notifier,
		Briefings:        briefings,
		PendingActions:   pendingActions,
		SessionTTL:       24 * time.Hour,
		BriefingTTL:      48 * time.Hour,
		PendingActionTTL: 10 * time.Minute,
		Now: func() time.Time {
			return fixedTime
		},
		AllowedIdentities: map[string]domain.Role{
			"intern_ivan":  domain.RoleIntern,
			"intern_anna":  domain.RoleIntern,
			"mentor_smith": domain.RoleMentor,
		},
		DemoMode: true,
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

func TestSessionIsUnavailableOutsideDemoMode(t *testing.T) {
	router := newRouterWith(func(deps *api.Dependencies) { deps.DemoMode = false })
	request := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(`{"user_id":"intern_ivan","role":"intern"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "demo_mode_disabled") {
		t.Fatalf("status/body = %d/%s", response.Code, response.Body.String())
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
	if first.RequestID != second.RequestID {
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

func TestNotificationIdempotency(t *testing.T) {
	router := newRouter()
	request := httptest.NewRequest(http.MethodPost, "/api/notify-mentor", strings.NewReader(`{"message":"Нужна помощь","idempotency_key":"test-key-1"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(login(t, router, "intern_ivan", domain.RoleIntern))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("first status = %d", response.Code)
	}

	// Second request with same idempotency key
	request2 := httptest.NewRequest(http.MethodPost, "/api/notify-mentor", strings.NewReader(`{"message":"Другое сообщение","idempotency_key":"test-key-1"}`))
	request2.Header.Set("Content-Type", "application/json")
	request2.AddCookie(login(t, router, "intern_ivan", domain.RoleIntern))
	response2 := httptest.NewRecorder()
	router.ServeHTTP(response2, request2)

	if response2.Code != http.StatusOK {
		t.Fatalf("second status = %d", response2.Code)
	}
	// Should return same result
	if response.Body.String() != response2.Body.String() {
		t.Fatalf("idempotency failed: %s vs %s", response.Body.String(), response2.Body.String())
	}
}

func TestNotificationAcceptsIdempotencyHeader(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)
	send := func(message string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/notify-mentor", strings.NewReader(`{"message":"`+message+`"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Idempotency-Key", "header-key-1")
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	first := send("Нужна помощь")
	second := send("Другое сообщение")
	if first.Code != http.StatusOK || first.Body.String() != second.Body.String() {
		t.Fatalf("responses = %d/%s and %d/%s", first.Code, first.Body.String(), second.Code, second.Body.String())
	}
}

func TestBriefingClaimPreventsDuplicate(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)
	claim := func() domain.BriefingClaim {
		request := httptest.NewRequest(http.MethodPost, "/api/briefing/claim", nil)
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

	if first := claim(); !first.ShouldSend || first.Date != "2026-11-11" {
		t.Fatalf("first claim = %#v", first)
	}
	if second := claim(); second.ShouldSend {
		t.Fatalf("second claim = %#v", second)
	}
}

func TestCreatePendingAction(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)

	request := httptest.NewRequest(http.MethodPost, "/api/pending-action", strings.NewReader(`{"action":"create_access_ticket","payload":{"system":"confluence","access_level":"read","reason":"For tasks"}}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
	}
	var body struct {
		PendingID        string         `json:"pending_id"`
		Action           string         `json:"action"`
		Status           string         `json:"status"`
		ExpiresInSeconds int            `json:"expires_in_seconds"`
		Payload          map[string]any `json:"payload"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.PendingID == "" || body.Action != "create_access_ticket" || body.Status != "pending" {
		t.Fatalf("invalid response: %#v", body)
	}
}

func TestConfirmPendingActionCreatesTicket(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)

	// Create pending action
	createReq := httptest.NewRequest(http.MethodPost, "/api/pending-action", strings.NewReader(`{"action":"create_access_ticket","payload":{"system":"confluence"}}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(cookie)
	createResp := httptest.NewRecorder()
	router.ServeHTTP(createResp, createReq)

	var createBody struct {
		PendingID string `json:"pending_id"`
	}
	if err := json.Unmarshal(createResp.Body.Bytes(), &createBody); err != nil {
		t.Fatal(err)
	}

	// Confirm it
	confirmReq := httptest.NewRequest(http.MethodPost, "/api/pending-action/confirm", strings.NewReader(`{"pending_id":"`+createBody.PendingID+`"}`))
	confirmReq.Header.Set("Content-Type", "application/json")
	confirmReq.AddCookie(cookie)
	confirmResp := httptest.NewRecorder()
	router.ServeHTTP(confirmResp, confirmReq)

	if confirmResp.Code != http.StatusCreated {
		t.Fatalf("confirm status = %d, want %d; body=%s", confirmResp.Code, http.StatusCreated, confirmResp.Body.String())
	}
	var ticket domain.Ticket
	if err := json.Unmarshal(confirmResp.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.RequestID == "" || ticket.System != "confluence" {
		t.Fatalf("invalid ticket: %#v", ticket)
	}
}

func TestConfirmPendingNotificationIsClaimedAtomically(t *testing.T) {
	notifier := &blockingNotifier{started: make(chan string, 2), release: make(chan struct{})}
	router := newRouterWith(func(deps *api.Dependencies) { deps.Notifier = notifier })
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)
	pendingID := createPendingNotification(t, router, cookie)

	firstResponse := make(chan *httptest.ResponseRecorder, 1)
	go func() { firstResponse <- confirmPendingNotification(router, cookie, pendingID) }()
	if key := <-notifier.started; key != pendingID {
		close(notifier.release)
		t.Fatalf("notification idempotency key = %q, want %q", key, pendingID)
	}
	secondResponseChannel := make(chan *httptest.ResponseRecorder, 1)
	go func() { secondResponseChannel <- confirmPendingNotification(router, cookie, pendingID) }()
	var secondResponse *httptest.ResponseRecorder
	select {
	case secondResponse = <-secondResponseChannel:
	case <-time.After(2 * time.Second):
		close(notifier.release)
		<-firstResponse
		t.Fatal("second confirmation entered the notification side effect instead of being rejected")
	}
	close(notifier.release)
	first := <-firstResponse

	if first.Code != http.StatusOK {
		t.Fatalf("first confirmation status = %d, want %d; body=%s", first.Code, http.StatusOK, first.Body.String())
	}
	if secondResponse.Code != http.StatusConflict {
		t.Fatalf("parallel confirmation status = %d, want %d; body=%s", secondResponse.Code, http.StatusConflict, secondResponse.Body.String())
	}
	notifier.mu.Lock()
	defer notifier.mu.Unlock()
	if len(notifier.calls) != 1 {
		t.Fatalf("notification calls = %d, want 1", len(notifier.calls))
	}
}

func TestConfirmPendingNotificationDoesNotResendWhenStatusWriteFails(t *testing.T) {
	var pendingStore *memoryPendingActions
	var notifier *memoryNotifier
	router := newRouterWith(func(deps *api.Dependencies) {
		pendingStore = &memoryPendingActions{actions: make(map[string]*domain.PendingAction), failTransitionTo: "confirmed"}
		notifier = &memoryNotifier{sent: make(map[string]domain.Notification)}
		deps.PendingActions = pendingStore
		deps.Notifier = notifier
	})
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)
	pendingID := createPendingNotification(t, router, cookie)

	firstResponse := confirmPendingNotification(router, cookie, pendingID)
	if firstResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("first confirmation status = %d, want %d; body=%s", firstResponse.Code, http.StatusServiceUnavailable, firstResponse.Body.String())
	}
	if _, ok := notifier.sent[pendingID]; !ok {
		t.Fatalf("notification was not sent with stable idempotency key %q", pendingID)
	}
	secondResponse := confirmPendingNotification(router, cookie, pendingID)
	if secondResponse.Code != http.StatusConflict {
		t.Fatalf("retry status = %d, want %d; body=%s", secondResponse.Code, http.StatusConflict, secondResponse.Body.String())
	}
	if len(notifier.sent) != 1 {
		t.Fatalf("unique notifications = %d, want 1", len(notifier.sent))
	}
}

func createPendingNotification(t *testing.T, router http.Handler, cookie *http.Cookie) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/pending-action", strings.NewReader(`{"action":"notify_mentor","payload":{"message":"Нужна помощь"}}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create pending status = %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
	}
	var body struct {
		PendingID string `json:"pending_id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.PendingID
}

func confirmPendingNotification(router http.Handler, cookie *http.Cookie, pendingID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/pending-action/confirm", strings.NewReader(`{"pending_id":"`+pendingID+`"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestConfirmPendingActionRejectsExpired(t *testing.T) {
	router := newRouterWith(func(deps *api.Dependencies) {
		deps.PendingActionTTL = -1 * time.Hour // Expired
	})
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)

	// Create pending action
	createReq := httptest.NewRequest(http.MethodPost, "/api/pending-action", strings.NewReader(`{"action":"create_access_ticket","payload":{"system":"confluence"}}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(cookie)
	createResp := httptest.NewRecorder()
	router.ServeHTTP(createResp, createReq)

	var createBody struct {
		PendingID string `json:"pending_id"`
	}
	if err := json.Unmarshal(createResp.Body.Bytes(), &createBody); err != nil {
		t.Fatal(err)
	}

	// Confirm expired action
	confirmReq := httptest.NewRequest(http.MethodPost, "/api/pending-action/confirm", strings.NewReader(`{"pending_id":"`+createBody.PendingID+`"}`))
	confirmReq.Header.Set("Content-Type", "application/json")
	confirmReq.AddCookie(cookie)
	confirmResp := httptest.NewRecorder()
	router.ServeHTTP(confirmResp, confirmReq)

	if confirmResp.Code != http.StatusGone {
		t.Fatalf("status = %d, want %d", confirmResp.Code, http.StatusGone)
	}
}

func TestConfirmPendingActionRejectsWrongUser(t *testing.T) {
	router := newRouter()
	cookie1 := login(t, router, "intern_ivan", domain.RoleIntern)
	cookie2 := login(t, router, "intern_anna", domain.RoleIntern)

	// Create pending action as ivan
	createReq := httptest.NewRequest(http.MethodPost, "/api/pending-action", strings.NewReader(`{"action":"create_access_ticket","payload":{"system":"confluence"}}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(cookie1)
	createResp := httptest.NewRecorder()
	router.ServeHTTP(createResp, createReq)

	var createBody struct {
		PendingID string `json:"pending_id"`
	}
	if err := json.Unmarshal(createResp.Body.Bytes(), &createBody); err != nil {
		t.Fatal(err)
	}

	// Try to confirm as anna
	confirmReq := httptest.NewRequest(http.MethodPost, "/api/pending-action/confirm", strings.NewReader(`{"pending_id":"`+createBody.PendingID+`"}`))
	confirmReq.Header.Set("Content-Type", "application/json")
	confirmReq.AddCookie(cookie2)
	confirmResp := httptest.NewRecorder()
	router.ServeHTTP(confirmResp, confirmReq)

	if confirmResp.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", confirmResp.Code, http.StatusForbidden)
	}
}

func TestCancelPendingAction(t *testing.T) {
	router := newRouter()
	cookie := login(t, router, "intern_ivan", domain.RoleIntern)

	// Create pending action
	createReq := httptest.NewRequest(http.MethodPost, "/api/pending-action", strings.NewReader(`{"action":"create_access_ticket","payload":{"system":"confluence"}}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(cookie)
	createResp := httptest.NewRecorder()
	router.ServeHTTP(createResp, createReq)

	var createBody struct {
		PendingID string `json:"pending_id"`
	}
	if err := json.Unmarshal(createResp.Body.Bytes(), &createBody); err != nil {
		t.Fatal(err)
	}

	// Cancel it
	cancelReq := httptest.NewRequest(http.MethodPost, "/api/pending-action/cancel", strings.NewReader(`{"pending_id":"`+createBody.PendingID+`"}`))
	cancelReq.Header.Set("Content-Type", "application/json")
	cancelReq.AddCookie(cookie)
	cancelResp := httptest.NewRecorder()
	router.ServeHTTP(cancelResp, cancelReq)

	if cancelResp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", cancelResp.Code, http.StatusNoContent)
	}

	// Try to confirm cancelled action
	confirmReq := httptest.NewRequest(http.MethodPost, "/api/pending-action/confirm", strings.NewReader(`{"pending_id":"`+createBody.PendingID+`"}`))
	confirmReq.Header.Set("Content-Type", "application/json")
	confirmReq.AddCookie(cookie)
	confirmResp := httptest.NewRecorder()
	router.ServeHTTP(confirmResp, confirmReq)

	if confirmResp.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", confirmResp.Code, http.StatusConflict)
	}
}

func TestChatProxyReplacesForgedIdentityHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-User-ID") != "intern_ivan" || request.Header.Get("X-User-Role") != "intern" {
			t.Errorf("identity headers = %q/%q", request.Header.Get("X-User-ID"), request.Header.Get("X-User-Role"))
		}
		payload := "intern_ivan|intern|2026-11-11T09:00:00Z"
		signature := hmac.New(sha256.New, []byte("request-secret"))
		_, _ = signature.Write([]byte(payload))
		expectedContext := payload + "." + hex.EncodeToString(signature.Sum(nil))
		if request.Header.Get("X-Request-Context") != expectedContext {
			t.Errorf("request context = %q, want %q", request.Header.Get("X-Request-Context"), expectedContext)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"reply":"ok"}`))
	}))
	defer upstream.Close()

	router := newRouterWith(func(deps *api.Dependencies) {
		deps.AIBaseURL = upstream.URL
		deps.HTTPClient = upstream.Client()
		deps.RequestContextSecret = "request-secret"
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
