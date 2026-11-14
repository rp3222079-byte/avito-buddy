package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

func syncJira(store FeatureStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		updated, err := store.SyncJira(c.Request.Context())
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "jira_sync_unavailable", "Не удалось обновить данные Jira")
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "success", "updated": updated})
	}
}

func getScoreboard(store FeatureStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		scoreboard, err := store.Scoreboard(c.Request.Context())
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "scoreboard_unavailable", "Не удалось получить рейтинг")
			return
		}
		c.JSON(http.StatusOK, scoreboard)
	}
}

func getTaskStages(store FeatureStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		stages, err := store.TaskStages(c.Request.Context(), c.Param("id"))
		if errors.Is(err, domain.ErrNotFound) {
			respondError(c, http.StatusNotFound, "task_not_found", "Задача не найдена")
			return
		}
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "task_stages_unavailable", "Не удалось получить этапы задачи")
			return
		}
		c.JSON(http.StatusOK, stages)
	}
}

func getInternMetrics(store FeatureStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		metrics, err := store.Metrics(c.Request.Context(), c.Param("id"))
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "metrics_unavailable", "Не удалось получить метрики")
			return
		}
		c.JSON(http.StatusOK, metrics)
	}
}

func getFlags(store FeatureStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		flags, err := store.Flags(c.Request.Context(), c.Query("mentor_id"))
		if err != nil {
			respondError(c, http.StatusServiceUnavailable, "flags_unavailable", "Не удалось получить флаги")
			return
		}
		if flags == nil {
			flags = make([]domain.Flag, 0)
		}
		c.JSON(http.StatusOK, gin.H{"flags": flags})
	}
}

func resolveFlag() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	}
}

func enrichInterns(interns []domain.Intern, flags []domain.Flag) []domain.Intern {
	activeByIntern := make(map[string][]domain.Flag)
	for _, flag := range flags {
		if flag.ResolvedAt == nil {
			activeByIntern[flag.InternID] = append(activeByIntern[flag.InternID], flag)
		}
	}
	result := make([]domain.Intern, 0, len(interns))
	for _, intern := range interns {
		intern.Flags = append([]domain.Flag(nil), activeByIntern[intern.InternID]...)
		if intern.Flags == nil {
			intern.Flags = make([]domain.Flag, 0)
		}
		intern.Stuck = len(intern.Flags) > 0
		intern.Blockers = make([]string, 0, len(intern.Flags))
		hasHigh := false
		hasMedium := false
		for _, flag := range intern.Flags {
			intern.Blockers = append(intern.Blockers, flag.Reason)
			hasHigh = hasHigh || flag.Severity == "high"
			hasMedium = hasMedium || flag.Severity == "medium"
		}
		switch {
		case hasHigh:
			intern.Status = "blocked"
		case hasMedium || intern.ProgressPercent < 30:
			intern.Status = "at_risk"
		default:
			intern.Status = "on_track"
		}
		result = append(result, intern)
	}
	return result
}
