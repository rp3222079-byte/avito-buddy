package storage_test

import (
	"context"
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
