package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

type MockStore struct {
	tasks      []domain.Task
	mentorID   string
	mentorName string
	interns    []domain.Intern
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
		tasks: tasks, mentorID: mentorData.MentorID,
		mentorName: mentorData.MentorName, interns: mentorData.Interns,
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

func (s *MockStore) Notify(_ context.Context, userID string, _ string) (domain.Notification, error) {
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
