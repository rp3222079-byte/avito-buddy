package storage

import (
	"context"
	"fmt"

	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

type FeatureStore struct {
	scoreboard domain.Scoreboard
	flags      []domain.Flag
	tasks      map[string][]domain.StageTransition
	metrics    domain.InternMetrics
}

func NewFeatureStore(tasksPath, scoreboardPath, flagsPath, metricsPath string) (*FeatureStore, error) {
	var taskData struct {
		Tasks []struct {
			ID          string                   `json:"id"`
			Transitions []domain.StageTransition `json:"transitions"`
		} `json:"tasks"`
	}
	if err := decodeJSONFile(tasksPath, &taskData); err != nil {
		return nil, fmt.Errorf("load task stages: %w", err)
	}

	var scoreboard domain.Scoreboard
	if err := decodeJSONFile(scoreboardPath, &scoreboard); err != nil {
		return nil, fmt.Errorf("load scoreboard: %w", err)
	}
	var flagData struct {
		Flags []domain.Flag `json:"flags"`
	}
	if err := decodeJSONFile(flagsPath, &flagData); err != nil {
		return nil, fmt.Errorf("load flags: %w", err)
	}
	var metrics domain.InternMetrics
	if err := decodeJSONFile(metricsPath, &metrics); err != nil {
		return nil, fmt.Errorf("load metrics: %w", err)
	}

	tasks := make(map[string][]domain.StageTransition, len(taskData.Tasks))
	for _, task := range taskData.Tasks {
		tasks[task.ID] = append([]domain.StageTransition(nil), task.Transitions...)
	}
	return &FeatureStore{
		scoreboard: scoreboard,
		flags:      flagData.Flags,
		tasks:      tasks,
		metrics:    metrics,
	}, nil
}

func (s *FeatureStore) SyncJira(context.Context) (int, error) {
	return 4, nil
}

func (s *FeatureStore) Scoreboard(context.Context) (domain.Scoreboard, error) {
	result := s.scoreboard
	result.Entries = append([]domain.ScoreboardEntry(nil), s.scoreboard.Entries...)
	return result, nil
}

func (s *FeatureStore) Flags(context.Context, string) ([]domain.Flag, error) {
	return append([]domain.Flag(nil), s.flags...), nil
}

func (s *FeatureStore) Metrics(context.Context, string) (domain.InternMetrics, error) {
	result := s.metrics
	result.Stages = append([]domain.StageMetric(nil), s.metrics.Stages...)
	return result, nil
}

func (s *FeatureStore) TaskStages(_ context.Context, taskID string) (domain.TaskStages, error) {
	transitions, ok := s.tasks[taskID]
	if !ok {
		return domain.TaskStages{}, domain.ErrNotFound
	}
	result := domain.TaskStages{
		TaskID:      taskID,
		Transitions: append([]domain.StageTransition(nil), transitions...),
		Durations:   make(map[string]*int64, len(transitions)),
	}
	if len(transitions) == 0 {
		return result, nil
	}
	result.CurrentStage = transitions[len(transitions)-1].Stage
	for index, transition := range transitions {
		if index == len(transitions)-1 {
			result.Durations[transition.Stage] = nil
			continue
		}
		seconds := int64(transitions[index+1].EnteredAt.Sub(transition.EnteredAt).Seconds())
		result.Durations[transition.Stage] = &seconds
	}
	return result, nil
}
