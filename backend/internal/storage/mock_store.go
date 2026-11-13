package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

type MockStore struct {
	tasks          []domain.Task
	mentorID       string
	mentorName     string
	interns        []domain.Intern
	pendingActions map[string]*domain.PendingAction
	mu             sync.RWMutex
	notifications  map[string]domain.Notification
}

func NewMockStore(tasksPath string, mentorsPath string) (*MockStore, error) {
	var taskData struct {
		Tasks []struct {
			ID          string `json:"id"`
			Title       string `json:"title"`
			Status      string `json:"status"`
			Priority    string `json:"priority"`
			Description string `json:"description"`
			Assignee    string `json:"assignee"`
			Type        string `json:"type"`
			CreatedAt   string `json:"created_at"`
		} `json:"tasks"`
	}
	if err := decodeJSONFile(tasksPath, &taskData); err != nil {
		return nil, fmt.Errorf("load tasks: %w", err)
	}
	var mentorData struct {
		MentorID   string          `json:"mentor_id"`
		MentorName string          `json:"mentor_name"`
		Interns    []domain.Intern `json:"interns"`
	}
	if err := decodeJSONFile(mentorsPath, &mentorData); err != nil {
		return nil, fmt.Errorf("load mentors: %w", err)
	}
	tasks := make([]domain.Task, 0, len(taskData.Tasks))
	for _, task := range taskData.Tasks {
		tasks = append(tasks, domain.Task{
			ID: task.ID, Title: task.Title, Status: task.Status, Priority: task.Priority,
			Description: task.Description, Assignee: task.Assignee, Type: task.Type, CreatedAt: task.CreatedAt,
		})
	}
	return &MockStore{
		tasks:          tasks,
		mentorID:       mentorData.MentorID,
		mentorName:     mentorData.MentorName,
		interns:        mentorData.Interns,
		pendingActions: make(map[string]*domain.PendingAction),
		notifications:  make(map[string]domain.Notification),
	}, nil
}

func (s *MockStore) ForUser(_ context.Context, userID string) ([]domain.Task, error) {
	result := make([]domain.Task, 0)
	for _, task := range s.tasks {
		if task.Assignee == userID {
			result = append(result, task)
		}
	}
	return result, nil
}

func (s *MockStore) ForMentor(_ context.Context, mentorID string) ([]domain.Intern, error) {
	if mentorID != s.mentorID {
		return []domain.Intern{}, nil
	}
	return append([]domain.Intern(nil), s.interns...), nil
}

func (s *MockStore) Notify(_ context.Context, userID string, message string, idempotencyKey string) (domain.Notification, error) {
	if idempotencyKey != "" {
		key := "notify:" + idempotencyKey
		s.mu.RLock()
		if notif, ok := s.notifications[key]; ok {
			s.mu.RUnlock()
			return notif, nil
		}
		s.mu.RUnlock()

		s.mu.Lock()
		defer s.mu.Unlock()
		if notif, ok := s.notifications[key]; ok {
			return notif, nil
		}
		notification := domain.Notification{Status: "sent", MentorName: "Алексей Смит"}
		s.notifications[key] = notification
		return notification, nil
	}

	for _, intern := range s.interns {
		if intern.InternID == userID {
			return domain.Notification{Status: "sent", MentorName: s.mentorName}, nil
		}
	}
	return domain.Notification{}, domain.ErrNotFound
}

func (s *MockStore) AllowedIdentities() map[string]domain.Role {
	result := map[string]domain.Role{s.mentorID: domain.RoleMentor}
	for _, intern := range s.interns {
		result[intern.InternID] = domain.RoleIntern
	}
	return result
}

func (s *MockStore) CreatePendingAction(ctx context.Context, action *domain.PendingAction) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pendingActions[action.PendingID] = action
	return nil
}

func (s *MockStore) GetPendingAction(ctx context.Context, pendingID string) (*domain.PendingAction, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	action, ok := s.pendingActions[pendingID]
	if !ok {
		return nil, domain.ErrNotFound
	}
	// Check expiration
	if time.Since(action.CreatedAt) > time.Duration(action.ExpiresIn)*time.Second {
		return nil, domain.ErrNotFound
	}
	return action, nil
}

func (s *MockStore) UpdatePendingActionStatus(ctx context.Context, pendingID, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if action, ok := s.pendingActions[pendingID]; ok {
		action.Status = status
	}
	return nil
}

func (s *MockStore) DeletePendingAction(ctx context.Context, pendingID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.pendingActions, pendingID)
	return nil
}

func (s *MockStore) Status(_ context.Context, userID string, date string) (bool, error) {
	return false, nil
}

func (s *MockStore) Claim(_ context.Context, userID string, date string, ttl time.Duration) (bool, error) {
	return true, nil
}

func decodeJSONFile(path string, target any) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(content, target); err != nil {
		return err
	}
	return nil
}

func generateMockPendingID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	return "p_" + hex.EncodeToString(bytes)
}
