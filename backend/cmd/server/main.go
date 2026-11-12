package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/api"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/config"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/storage"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg := config.Load()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	dependencyCtx, dependencyCancel := context.WithTimeout(ctx, cfg.DependencyTimeout)
	defer dependencyCancel()

	database, err := pgxpool.New(dependencyCtx, cfg.PostgresURL)
	if err != nil {
		return err
	}
	defer database.Close()
	if err := database.Ping(dependencyCtx); err != nil {
		return err
	}

	redisClient := redis.NewClient(&redis.Options{
		Addr: cfg.RedisAddress, Password: cfg.RedisPassword, DB: cfg.RedisDatabase,
	})
	defer redisClient.Close()
	if err := redisClient.Ping(dependencyCtx).Err(); err != nil {
		return err
	}

	mocks, err := storage.NewMockStore(cfg.TasksPath, cfg.MentorsPath)
	if err != nil {
		return err
	}
	redisStore := storage.NewRedisStore(redisClient).WithNowFunc(time.Now)
	router := api.NewRouter(api.Dependencies{
		Sessions:              redisStore,
		Tasks:                 mocks,
		Mentors:               mocks,
		Tickets:               storage.NewPostgresTicketStore(database),
		Notifier:              mocks,
		Briefings:             redisStore,
		PendingActions:        redisStore,
		SessionTTL:            cfg.SessionTTL,
		BriefingTTL:           cfg.BriefingTTL,
		PendingActionTTL:      cfg.PendingActionTTL,
		Now:                   time.Now,
		AIBaseURL:             cfg.AIBaseURL,
		InternalToken:         cfg.InternalToken,
		AllowedOrigins:        cfg.AllowedOrigins,
		AllowedIdentities:     mocks.AllowedIdentities(),
		RequestContextSecret:  cfg.RequestContextSecret,
		DemoMode:              cfg.DemoMode,
		HTTPClient:            &http.Client{Timeout: 130 * time.Second},
	})
	server := &http.Server{
		Addr: cfg.Address, Handler: router, ReadHeaderTimeout: 5 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("backend listens on %s", cfg.Address)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()
	return server.Shutdown(shutdownCtx)
}
