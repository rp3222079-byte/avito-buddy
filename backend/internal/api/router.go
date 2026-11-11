package api

import (
	"context"
	"crypto/subtle"
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
	Notify(context.Context, string, string) (domain.Notification, error)
}

type BriefingStore interface {
	Status(context.Context, string, string) (bool, error)
	Claim(context.Context, string, string, time.Duration, bool) (bool, error)
}

type Dependencies struct {
	Sessions          SessionStore
	Tasks             TaskStore
	Mentors           MentorStore
	Tickets           TicketStore
	Notifier          Notifier
	Briefings         BriefingStore
	SessionTTL        time.Duration
	BriefingTTL       time.Duration
	Now               func() time.Time
	AIBaseURL         string
	HTTPClient        *http.Client
	InternalToken     string
	AllowedOrigins    []string
	AllowedIdentities map[string]domain.Role
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
	authorized := router.Group("/api", authenticate(deps))
	authorized.DELETE("/session", deleteSession(deps.Sessions))
	authorized.GET("/jira/tasks", getTasks(deps.Tasks))
	authorized.POST("/jira/ticket", createTicket(deps.Tickets))
	authorized.POST("/notify-mentor", requireRole(domain.RoleIntern), notifyMentor(deps.Notifier))
	authorized.GET("/briefing/status", requireRole(domain.RoleIntern), briefingStatus(deps))
	authorized.POST("/briefing/claim", requireRole(domain.RoleIntern), claimBriefing(deps))
	authorized.POST("/chat", proxyAI(deps, "/api/chat"))
	authorized.POST("/chat/stream", proxyAI(deps, "/api/chat/stream"))
	mentor := authorized.Group("/mentor", requireRole(domain.RoleMentor))
	mentor.GET("/interns", getInterns(deps.Mentors))
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
			c.Header("Access-Control-Allow-Headers", "Content-Type, Accept")
			c.Header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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

func getInterns(store MentorStore) gin.HandlerFunc {
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
		Message string `json:"message" binding:"required,max=1000"`
	}
	return func(c *gin.Context) {
		var input request
		if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Message) == "" {
			respondError(c, http.StatusBadRequest, "invalid_request", "Укажите текст уведомления")
			return
		}
		session := c.MustGet("session").(domain.Session)
		notification, err := notifier.Notify(c.Request.Context(), session.UserID, strings.TrimSpace(input.Message))
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
	type request struct {
		Force bool `json:"force"`
	}
	return func(c *gin.Context) {
		var input request
		if err := c.ShouldBindJSON(&input); err != nil {
			respondError(c, http.StatusBadRequest, "invalid_request", "Некорректные параметры брифинга")
			return
		}
		session := c.MustGet("session").(domain.Session)
		date := deps.Now().Format(time.DateOnly)
		ttl := deps.BriefingTTL
		if ttl == 0 {
			ttl = 48 * time.Hour
		}
		shouldSend, err := deps.Briefings.Claim(c.Request.Context(), session.UserID, date, ttl, input.Force)
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "briefing_unavailable", "Не удалось зарегистрировать брифинг")
			return
		}
		c.JSON(http.StatusOK, domain.BriefingClaim{ShouldSend: shouldSend, Date: date})
	}
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
