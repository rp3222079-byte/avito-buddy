package storage_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/storage"
)

func TestRedisStorePersistsSessionsAndClaimsBriefingAtomically(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	store := storage.NewRedisStore(client)
	ctx := context.Background()

	id, err := store.Create(ctx, domain.Session{UserID: "intern_ivan", Role: domain.RoleIntern}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if session.UserID != "intern_ivan" {
		t.Fatalf("session = %#v", session)
	}

	first, err := store.Claim(ctx, "intern_ivan", "2026-11-11", 48*time.Hour)
	if err != nil || !first {
		t.Fatalf("first claim = %v, err=%v", first, err)
	}
	second, err := store.Claim(ctx, "intern_ivan", "2026-11-11", 48*time.Hour)
	if err != nil || second {
		t.Fatalf("second claim = %v, err=%v", second, err)
	}
	// No force parameter anymore - just test that it works
	third, err := store.Claim(ctx, "intern_ivan", "2026-11-12", 48*time.Hour)
	if err != nil || !third {
		t.Fatalf("third claim = %v, err=%v", third, err)
	}
}

func TestRedisPendingActionClaimIsAtomicAndPersistsExpiryMetadata(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	store := storage.NewRedisStore(client)
	ctx := context.Background()
	createdAt := time.Now().UTC().Truncate(time.Second)
	action := &domain.PendingAction{
		PendingID: "pending-concurrent",
		Action:    "notify_mentor",
		Status:    "pending",
		ExpiresIn: 60,
		Payload:   map[string]any{"message": "Нужна помощь"},
		UserID:    "intern_ivan",
		CreatedAt: createdAt,
	}
	if err := store.CreatePendingAction(ctx, action); err != nil {
		t.Fatal(err)
	}

	loaded, err := store.GetPendingAction(ctx, action.PendingID)
	if err != nil {
		t.Fatalf("load pending action: %v", err)
	}
	if !loaded.CreatedAt.Equal(createdAt) {
		t.Fatalf("created_at = %v, want %v", loaded.CreatedAt, createdAt)
	}

	var claimed atomic.Int32
	var conflicts atomic.Int32
	var unexpected atomic.Int32
	unexpectedErrors := make(chan error, 24)
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.ClaimPendingAction(ctx, action.PendingID, "intern_ivan")
			switch {
			case err == nil:
				claimed.Add(1)
			case errors.Is(err, domain.ErrConflict):
				conflicts.Add(1)
			default:
				unexpected.Add(1)
				unexpectedErrors <- err
			}
		}()
	}
	wg.Wait()
	if claimed.Load() != 1 || conflicts.Load() != 23 || unexpected.Load() != 0 {
		var firstError error
		select {
		case firstError = <-unexpectedErrors:
		default:
		}
		t.Fatalf("claims=%d conflicts=%d unexpected=%d first_error=%v, want 1/23/0", claimed.Load(), conflicts.Load(), unexpected.Load(), firstError)
	}
	loaded, err = store.GetPendingAction(ctx, action.PendingID)
	if err != nil || loaded.Status != "processing" {
		t.Fatalf("pending action = %#v, err=%v; want processing", loaded, err)
	}
}
