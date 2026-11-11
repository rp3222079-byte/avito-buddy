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
	TicketID string `json:"ticket_id"`
	UserID   string `json:"-"`
	System   string `json:"-"`
	Status   string `json:"status"`
	SLAHours int    `json:"sla_hours"`
}

type Notification struct {
	Status     string `json:"status"`
	MentorName string `json:"mentor_name"`
}

type BriefingClaim struct {
	ShouldSend bool   `json:"should_send"`
	Date       string `json:"date"`
}
