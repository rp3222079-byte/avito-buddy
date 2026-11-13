package domain

import (
	"errors"
	"time"
)

var ErrNotFound = errors.New("not found")

type Role string

const (
	RoleIntern Role = "intern"
	RoleMentor Role = "mentor"
)

type Session struct {
	UserID    string    `json:"user_id"`
	Role      Role      `json:"role"`
	MentorID  string    `json:"mentor_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Task struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	Description string `json:"description,omitempty"`
	Assignee    string `json:"-"`
	Type        string `json:"type,omitempty"`
	CreatedAt   string `json:"created_at,omitempty"`
}

type Intern struct {
	InternID        string   `json:"intern_id"`
	Name            string   `json:"name"`
	Team            string   `json:"team,omitempty"`
	ProgressPercent int      `json:"progress_percent"`
	Status          string   `json:"status"`
	LastActive      string   `json:"last_active,omitempty"`
	Blockers        []string `json:"blockers"`
}

type Ticket struct {
	RequestID   string `json:"request_id"`
	UserID      string `json:"-"`
	System      string `json:"system"`
	AccessLevel string `json:"access_level,omitempty"`
	Reason      string `json:"reason,omitempty"`
	Status      string `json:"status"`
	SLAHours    int    `json:"sla_hours"`
	Existing    bool   `json:"existing"`
}

type Notification struct {
	Status     string `json:"status"`
	MentorName string `json:"mentor_name"`
}

type BriefingClaim struct {
	ShouldSend bool   `json:"should_send"`
	Date       string `json:"date"`
}

type PendingAction struct {
	PendingID   string                 `json:"pending_id"`
	Action      string                 `json:"action"`
	Status      string                 `json:"status"`
	ExpiresIn   int                    `json:"expires_in_seconds"`
	Payload     map[string]any         `json:"payload"`
	UserID      string                 `json:"-"`
	CreatedAt   time.Time              `json:"-"`
}

type PendingActionRequest struct {
	Action  string         `json:"action" binding:"required"`
	Payload map[string]any `json:"payload" binding:"required"`
}

type ConfirmActionRequest struct {
	PendingID string `json:"pending_id" binding:"required"`
}
