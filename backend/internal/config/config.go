package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address           string
	PostgresURL       string
	RedisAddress      string
	RedisPassword     string
	RedisDatabase     int
	TasksPath         string
	MentorsPath       string
	AIBaseURL         string
	InternalToken     string
	AllowedOrigins    []string
	SessionTTL        time.Duration
	BriefingTTL       time.Duration
	ShutdownTimeout   time.Duration
	DependencyTimeout time.Duration
}

func Load() Config {
	return Config{
		Address:           env("BACKEND_ADDRESS", ":8080"),
		PostgresURL:       env("POSTGRES_URL", "postgres://avito:avito@localhost:5432/avito_buddy?sslmode=disable"),
		RedisAddress:      env("REDIS_ADDRESS", "localhost:6379"),
		RedisPassword:     os.Getenv("REDIS_PASSWORD"),
		RedisDatabase:     envInt("REDIS_DATABASE", 0),
		TasksPath:         env("MOCK_JIRA_PATH", "../data/mock_jira.json"),
		MentorsPath:       env("MOCK_MENTOR_PATH", "../data/mock_mentor.json"),
		AIBaseURL:         env("AI_BASE_URL", "http://localhost:8000"),
		InternalToken:     os.Getenv("INTERNAL_TOKEN"),
		AllowedOrigins:    splitCSV(env("CORS_ALLOWED_ORIGINS", "http://localhost:5173")),
		SessionTTL:        envDuration("SESSION_TTL", 24*time.Hour),
		BriefingTTL:       envDuration("BRIEFING_TTL", 48*time.Hour),
		ShutdownTimeout:   envDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
		DependencyTimeout: envDuration("DEPENDENCY_TIMEOUT", 5*time.Second),
	}
}

func env(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(name))
	if err != nil {
		return fallback
	}
	return value
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(os.Getenv(name))
	if err != nil {
		return fallback
	}
	return value
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
