package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

const sessionCookieName = "avito_buddy_session"

type SessionStore interface {
	Create(context.Context, domain.Session, time.Duration) (string, error)
	Get(context.Context, string) (domain.Session, error)
	Delete(context.Context, string) error
}

type TaskStore interface {
	ForUser(context.Context, string) ([]domain.Task, error)
}

type MentorStore interface {
	ForMentor(context.Context, string) ([]domain.Intern, error)
}

type TicketStore interface {
	CreateOrGet(context.Context, string, string) (domain.Ticket, bool, error)
}

type Notifier interface {
	Notify(context.Context, string, string, string) (domain.Notification, error)
}

type BriefingStore interface {
	Status(context.Context, string, string) (bool, error)
	Claim(context.Context, string, string, time.Duration) (bool, error)
}

type PendingActionStore interface {
	CreatePendingAction(context.Context, *domain.PendingAction) error
	GetPendingAction(context.Context, string) (*domain.PendingAction, error)
	ClaimPendingAction(context.Context, string, string) (*domain.PendingAction, error)
	TransitionPendingActionStatus(context.Context, string, string, string, string) error
	DeletePendingAction(context.Context, string) error
}

type FeatureStore interface {
	SyncJira(context.Context) (int, error)
	Scoreboard(context.Context) (domain.Scoreboard, error)
	TaskStages(context.Context, string) (domain.TaskStages, error)
	Metrics(context.Context, string) (domain.InternMetrics, error)
	Flags(context.Context, string) ([]domain.Flag, error)
}

type Dependencies struct {
	Sessions             SessionStore
	Tasks                TaskStore
	Mentors              MentorStore
	Tickets              TicketStore
	Notifier             Notifier
	Briefings            BriefingStore
	PendingActions       PendingActionStore
	Features             FeatureStore
	SessionTTL           time.Duration
	BriefingTTL          time.Duration
	PendingActionTTL     time.Duration
	Now                  func() time.Time
	AIBaseURL            string
	HTTPClient           *http.Client
	InternalToken        string
	AllowedOrigins       []string
	AllowedIdentities    map[string]domain.Role
	RequestContextSecret string
	DemoMode             bool
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func NewRouter(deps Dependencies) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(cors(deps.AllowedOrigins))
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.POST("/api/session", createSession(deps))
	router.POST("/sync/jira", syncJira(deps.Features))
	router.GET("/scoreboard", getScoreboard(deps.Features))
	router.GET("/tasks/:id/stages", getTaskStages(deps.Features))
	router.GET("/interns/:id/metrics", getInternMetrics(deps.Features))
	router.GET("/flags", getFlags(deps.Features))
	router.PATCH("/flags/:id/resolve", resolveFlag())
	authorized := router.Group("/api", authenticate(deps))
	authorized.DELETE("/session", deleteSession(deps.Sessions))
	authorized.GET("/jira/tasks", getTasks(deps.Tasks))
	authorized.POST("/jira/ticket", requireRole(domain.RoleIntern), createTicket(deps.Tickets))
	authorized.POST("/notify-mentor", requireRole(domain.RoleIntern), notifyMentor(deps.Notifier))
	authorized.GET("/briefing/status", requireRole(domain.RoleIntern), briefingStatus(deps))
	authorized.POST("/briefing/claim", requireRole(domain.RoleIntern), claimBriefing(deps))
	authorized.POST("/pending-action", requireRole(domain.RoleIntern), createPendingAction(deps))
	authorized.POST("/pending-action/confirm", requireRole(domain.RoleIntern), confirmPendingAction(deps))
	authorized.POST("/pending-action/cancel", requireRole(domain.RoleIntern), cancelPendingAction(deps))
	authorized.POST("/chat", proxyAI(deps, "/api/chat"))
	authorized.POST("/chat/stream", proxyAI(deps, "/api/chat/stream"))
	mentor := authorized.Group("/mentor", requireRole(domain.RoleMentor))
	mentor.GET("/interns", getInterns(deps.Mentors, deps.Features))
	return router
}

func cors(allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[strings.TrimSpace(origin)] = struct{}{}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if _, ok := allowed[origin]; ok && origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Accept, Idempotency-Key")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			c.Header("Vary", "Origin")
		}
		if c.Request.Method == http.MethodOptions {
			c.Status(http.StatusNoContent)
			c.Abort()
			return
		}
		c.Next()
	}
}

func createSession(deps Dependencies) gin.HandlerFunc {
	type request struct {
		UserID string      `json:"user_id" binding:"required"`
		Role   domain.Role `json:"role" binding:"required"`
	}
	return func(c *gin.Context) {
		if !deps.DemoMode {
			respondError(c, http.StatusServiceUnavailable, "demo_mode_disabled", "Демо-авторизация отключена")
			return
		}
		var input request
		if err := c.ShouldBindJSON(&input); err != nil {
			respondError(c, http.StatusBadRequest, "invalid_request", "Некорректные данные сессии")
			return
		}
		role, ok := deps.AllowedIdentities[input.UserID]
		if !ok || role != input.Role {
			respondError(c, http.StatusUnauthorized, "unknown_identity", "Неизвестный пользователь или роль")
			return
		}
		session := domain.Session{UserID: input.UserID, Role: input.Role, CreatedAt: time.Now().UTC()}
		id, err := deps.Sessions.Create(c.Request.Context(), session, deps.SessionTTL)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "session_unavailable", "Сервис сессий временно недоступен")
			return
		}
		http.SetCookie(c.Writer, &http.Cookie{
			Name: sessionCookieName, Value: id, Path: "/", MaxAge: int(deps.SessionTTL.Seconds()),
			HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
		c.JSON(http.StatusCreated, gin.H{"user_id": session.UserID, "role": session.Role})
	}
}

func authenticate(deps Dependencies) gin.HandlerFunc {
	return func(c *gin.Context) {
		if session, ok := internalSession(c, deps); ok {
			c.Set("session", session)
			c.Next()
			return
		}
		cookie, err := c.Cookie(sessionCookieName)
		if err != nil {
			respondError(c, http.StatusUnauthorized, "unauthorized", "Требуется активная сессия")
			c.Abort()
			return
		}
		session, err := deps.Sessions.Get(c.Request.Context(), cookie)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, domain.ErrNotFound) {
				status = http.StatusUnauthorized
			}
			respondError(c, status, "unauthorized", "Сессия недействительна")
			c.Abort()
			return
		}
		c.Set("session", session)
		c.Next()
	}
}

func internalSession(c *gin.Context, deps Dependencies) (domain.Session, bool) {
	providedToken := c.GetHeader("X-Internal-Token")
	if deps.InternalToken == "" || len(providedToken) != len(deps.InternalToken) ||
		subtle.ConstantTimeCompare([]byte(providedToken), []byte(deps.InternalToken)) != 1 {
		return domain.Session{}, false
	}
	userID := c.GetHeader("X-User-ID")
	role := domain.Role(c.GetHeader("X-User-Role"))
	knownRole, ok := deps.AllowedIdentities[userID]
	if !ok || knownRole != role {
		return domain.Session{}, false
	}
	return domain.Session{UserID: userID, Role: role}, true
}

func deleteSession(store SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie(sessionCookieName)
		if err != nil {
			respondError(c, http.StatusBadRequest, "cookie_required", "Внутреннюю сессию нельзя удалить через браузерный endpoint")
			return
		}
		if err := store.Delete(c.Request.Context(), cookie); err != nil {
			respondError(c, http.StatusServiceUnavailable, "session_unavailable", "Не удалось удалить сессию")
			return
		}
		http.SetCookie(c.Writer, &http.Cookie{
			Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1,
			HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
		c.Status(http.StatusNoContent)
	}
}

func getTasks(store TaskStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		session := c.MustGet("session").(domain.Session)
		tasks, err := store.ForUser(c.Request.Context(), session.UserID)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "tasks_unavailable", "Не удалось получить задачи")
			return
		}
		c.JSON(http.StatusOK, gin.H{"tasks": tasks})
	}
}

func requireRole(role domain.Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		session := c.MustGet("session").(domain.Session)
		if session.Role != role {
			respondError(c, http.StatusForbidden, "forbidden", "Доступ запрещён")
			c.Abort()
			return
		}
		c.Next()
	}
}

func getInterns(store MentorStore, features FeatureStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		session := c.MustGet("session").(domain.Session)
		interns, err := store.ForMentor(c.Request.Context(), session.UserID)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "interns_unavailable", "Не удалось получить список стажёров")
			return
		}
		if interns == nil {
			interns = make([]domain.Intern, 0)
		}
		if features != nil {
			flags, err := features.Flags(c.Request.Context(), session.UserID)
			if err != nil {
				respondError(c, http.StatusServiceUnavailable, "flags_unavailable", "Не удалось получить флаги стажёров")
				return
			}
			interns = enrichInterns(interns, flags)
		}
		c.JSON(http.StatusOK, gin.H{"interns": interns})
	}
}

func createTicket(store TicketStore) gin.HandlerFunc {
	type request struct {
		System string `json:"system" binding:"required"`
	}
	allowed := map[string]bool{"confluence": true, "jira": true, "figma": true, "github": true}
	return func(c *gin.Context) {
		var input request
		if err := c.ShouldBindJSON(&input); err != nil {
			respondError(c, http.StatusBadRequest, "invalid_request", "Укажите систему для выдачи доступа")
			return
		}
		system := strings.ToLower(strings.TrimSpace(input.System))
		if !allowed[system] {
			respondError(c, http.StatusUnprocessableEntity, "unsupported_system", "Эта система не поддерживается")
			return
		}
		session := c.MustGet("session").(domain.Session)
		ticket, created, err := store.CreateOrGet(c.Request.Context(), session.UserID, system)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "ticket_unavailable", "Не удалось создать заявку. Напишите в IT-поддержку")
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		c.JSON(status, ticket)
	}
}

func notifyMentor(notifier Notifier) gin.HandlerFunc {
	type request struct {
		Message        string `json:"message" binding:"required,max=1000"`
		IdempotencyKey string `json:"idempotency_key,omitempty"`
	}
	return func(c *gin.Context) {
		var input request
		if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Message) == "" {
			respondError(c, http.StatusBadRequest, "invalid_request", "Укажите текст уведомления")
			return
		}
		session := c.MustGet("session").(domain.Session)
		idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if idempotencyKey == "" {
			idempotencyKey = strings.TrimSpace(input.IdempotencyKey)
		}
		notification, err := notifier.Notify(c.Request.Context(), session.UserID, strings.TrimSpace(input.Message), idempotencyKey)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "notification_unavailable", "Не удалось отправить уведомление наставнику")
			return
		}
		c.JSON(http.StatusOK, notification)
	}
}

func briefingStatus(deps Dependencies) gin.HandlerFunc {
	return func(c *gin.Context) {
		session := c.MustGet("session").(domain.Session)
		date := deps.Now().Format(time.DateOnly)
		sent, err := deps.Briefings.Status(c.Request.Context(), session.UserID, date)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "briefing_unavailable", "Не удалось проверить статус брифинга")
			return
		}
		c.JSON(http.StatusOK, gin.H{"sent": sent, "date": date})
	}
}

func claimBriefing(deps Dependencies) gin.HandlerFunc {
	return func(c *gin.Context) {
		session := c.MustGet("session").(domain.Session)
		date := deps.Now().Format(time.DateOnly)
		ttl := deps.BriefingTTL
		if ttl == 0 {
			ttl = 48 * time.Hour
		}
		shouldSend, err := deps.Briefings.Claim(c.Request.Context(), session.UserID, date, ttl)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "briefing_unavailable", "Не удалось зарегистрировать брифинг")
			return
		}
		c.JSON(http.StatusOK, domain.BriefingClaim{ShouldSend: shouldSend, Date: date})
	}
}

func createPendingAction(deps Dependencies) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input domain.PendingActionRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			respondError(c, http.StatusBadRequest, "invalid_request", "Некорректные данные действия")
			return
		}
		allowedActions := map[string]bool{"create_access_ticket": true, "notify_mentor": true}
		if !allowedActions[input.Action] {
			respondError(c, http.StatusUnprocessableEntity, "unsupported_action", "Это действие не поддерживается")
			return
		}
		session := c.MustGet("session").(domain.Session)

		pendingID := generatePendingID()
		now := deps.Now()
		expiresIn := int(deps.PendingActionTTL.Seconds())
		if expiresIn == 0 {
			expiresIn = 600 // 10 minutes default
		}

		action := &domain.PendingAction{
			PendingID: pendingID,
			Action:    input.Action,
			Status:    "pending",
			ExpiresIn: expiresIn,
			Payload:   input.Payload,
			UserID:    session.UserID,
			CreatedAt: now,
		}

		if err := deps.PendingActions.CreatePendingAction(c.Request.Context(), action); err != nil {
			respondError(c, http.StatusServiceUnavailable, "pending_action_unavailable", "Не удалось создать черновик действия")
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"pending_id":         pendingID,
			"action":             input.Action,
			"status":             "pending",
			"expires_in_seconds": expiresIn,
			"payload":            input.Payload,
		})
	}
}

func confirmPendingAction(deps Dependencies) gin.HandlerFunc {
	type request struct {
		PendingID string `json:"pending_id" binding:"required"`
	}
	return func(c *gin.Context) {
		var input request
		if err := c.ShouldBindJSON(&input); err != nil {
			respondError(c, http.StatusBadRequest, "invalid_request", "Укажите pending_id")
			return
		}
		session := c.MustGet("session").(domain.Session)

		action, err := deps.PendingActions.GetPendingAction(c.Request.Context(), input.PendingID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				respondError(c, http.StatusNotFound, "pending_action_not_found", "Черновик не найден или истёк")
				return
			}
			respondError(c, http.StatusServiceUnavailable, "pending_action_unavailable", "Не удалось получить черновик")
			return
		}

		if action.UserID != session.UserID {
			respondError(c, http.StatusForbidden, "forbidden", "Черновик принадлежит другому пользователю")
			return
		}

		if action.Status != "pending" {
			respondError(c, http.StatusConflict, "pending_action_invalid", "Черновик уже обработан или отменён")
			return
		}
		// Validate before claiming so malformed payloads do not remain stuck in processing.
		switch action.Action {
		case "create_access_ticket":
			if system, _ := action.Payload["system"].(string); system == "" {
				respondError(c, http.StatusBadRequest, "invalid_payload", "Отсутствует система в payload")
				return
			}
		case "notify_mentor":
			if message, _ := action.Payload["message"].(string); message == "" {
				respondError(c, http.StatusBadRequest, "invalid_payload", "Отсутствует сообщение в payload")
				return
			}
		default:
			respondError(c, http.StatusUnprocessableEntity, "unsupported_action", "Неизвестное действие")
			return
		}

		if deps.Now().Sub(action.CreatedAt) > time.Duration(action.ExpiresIn)*time.Second {
			respondError(c, http.StatusGone, "pending_action_expired", "Срок действия черновика истёк")
			return
		}

		// Claim the action atomically before performing any external side effect.
		action, err = deps.PendingActions.ClaimPendingAction(c.Request.Context(), input.PendingID, session.UserID)
		if err != nil {
			handlePendingActionTransitionError(c, err, "Не удалось захватить черновик")
			return
		}

		// Execute the action
		var result any
		status := http.StatusOK
		switch action.Action {
		case "create_access_ticket":
			system, _ := action.Payload["system"].(string)
			if system == "" {
				respondError(c, http.StatusBadRequest, "invalid_payload", "Отсутствует система в payload")
				return
			}
			ticket, created, err := deps.Tickets.CreateOrGet(c.Request.Context(), session.UserID, system)
			if err != nil {
				respondError(c, http.StatusServiceUnavailable, "ticket_unavailable", "Не удалось создать заявку")
				return
			}
			ticket.Existing = !created
			if created {
				status = http.StatusCreated
			}
			result = ticket
		case "notify_mentor":
			message, _ := action.Payload["message"].(string)
			if message == "" {
				respondError(c, http.StatusBadRequest, "invalid_payload", "Отсутствует сообщение в payload")
				return
			}
			// A stable key prevents duplicate delivery if status persistence fails and
			// the same operation is retried by an idempotent notification provider.
			notification, err := deps.Notifier.Notify(c.Request.Context(), session.UserID, message, input.PendingID)
			if err != nil {
				respondError(c, http.StatusServiceUnavailable, "notification_unavailable", "Не удалось отправить уведомление")
				return
			}
			result = notification
			status = http.StatusOK
		default:
			respondError(c, http.StatusUnprocessableEntity, "unsupported_action", "Неизвестное действие")
			return
		}

		if err := deps.PendingActions.TransitionPendingActionStatus(c.Request.Context(), input.PendingID, session.UserID, "processing", "confirmed"); err != nil {
			handlePendingActionTransitionError(c, err, "Не удалось сохранить результат действия")
			return
		}

		c.JSON(status, result)
	}
}

func cancelPendingAction(deps Dependencies) gin.HandlerFunc {
	type request struct {
		PendingID string `json:"pending_id" binding:"required"`
	}
	return func(c *gin.Context) {
		var input request
		if err := c.ShouldBindJSON(&input); err != nil {
			respondError(c, http.StatusBadRequest, "invalid_request", "Укажите pending_id")
			return
		}
		session := c.MustGet("session").(domain.Session)

		action, err := deps.PendingActions.GetPendingAction(c.Request.Context(), input.PendingID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				respondError(c, http.StatusNotFound, "pending_action_not_found", "Черновик не найден или истёк")
				return
			}
			respondError(c, http.StatusServiceUnavailable, "pending_action_unavailable", "Не удалось получить черновик")
			return
		}

		if action.UserID != session.UserID {
			respondError(c, http.StatusForbidden, "forbidden", "Черновик принадлежит другому пользователю")
			return
		}

		if err := deps.PendingActions.TransitionPendingActionStatus(c.Request.Context(), input.PendingID, session.UserID, "pending", "cancelled"); err != nil {
			handlePendingActionTransitionError(c, err, "Не удалось отменить черновик")
			return
		}

		c.Status(http.StatusNoContent)
	}
}

func handlePendingActionTransitionError(c *gin.Context, err error, message string) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		respondError(c, http.StatusNotFound, "pending_action_not_found", "Черновик не найден или истёк")
	case errors.Is(err, domain.ErrForbidden):
		respondError(c, http.StatusForbidden, "forbidden", "Черновик принадлежит другому пользователю")
	case errors.Is(err, domain.ErrConflict):
		respondError(c, http.StatusConflict, "pending_action_invalid", "Черновик уже обрабатывается или обработан")
	default:
		respondError(c, http.StatusServiceUnavailable, "pending_action_unavailable", message)
	}
}

func generatePendingID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	return "p_" + hex.EncodeToString(bytes)
}

func proxyAI(deps Dependencies, path string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if deps.AIBaseURL == "" {
			respondError(c, http.StatusServiceUnavailable, "ai_unavailable", "Сервис временно недоступен. Попробуйте позже")
			return
		}
		request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, strings.TrimRight(deps.AIBaseURL, "/")+path, c.Request.Body)
		if err != nil {
			respondError(c, http.StatusInternalServerError, "proxy_error", "Не удалось подготовить запрос")
			return
		}
		request.Header.Set("Content-Type", c.GetHeader("Content-Type"))
		request.Header.Set("Accept", c.GetHeader("Accept"))
		session := c.MustGet("session").(domain.Session)
		request.Header.Set("X-User-ID", session.UserID)
		request.Header.Set("X-User-Role", string(session.Role))
		if deps.InternalToken != "" {
			request.Header.Set("X-Internal-Token", deps.InternalToken)
		}
		if deps.RequestContextSecret != "" {
			now := time.Now
			if deps.Now != nil {
				now = deps.Now
			}
			ctxPayload := session.UserID + "|" + string(session.Role) + "|" + now().UTC().Format(time.RFC3339)
			h := hmac.New(sha256.New, []byte(deps.RequestContextSecret))
			h.Write([]byte(ctxPayload))
			signature := hex.EncodeToString(h.Sum(nil))
			request.Header.Set("X-Request-Context", ctxPayload+"."+signature)
		}
		client := deps.HTTPClient
		if client == nil {
			client = http.DefaultClient
		}
		response, err := client.Do(request)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "ai_unavailable", "Сервис временно недоступен. Попробуйте позже")
			return
		}
		defer response.Body.Close()
		for _, header := range []string{"Content-Type", "Cache-Control"} {
			if value := response.Header.Get(header); value != "" {
				c.Header(header, value)
			}
		}
		c.Status(response.StatusCode)
		writer := io.Writer(c.Writer)
		if strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
			writer = flushingWriter{writer: c.Writer}
		}
		_, _ = io.Copy(writer, response.Body)
	}
}

type flushingWriter struct {
	writer gin.ResponseWriter
}

func (w flushingWriter) Write(data []byte) (int, error) {
	n, err := w.writer.Write(data)
	w.writer.Flush()
	return n, err
}

func respondError(c *gin.Context, status int, code string, message string) {
	c.JSON(status, errorEnvelope{Error: errorBody{Code: code, Message: message}})
}
