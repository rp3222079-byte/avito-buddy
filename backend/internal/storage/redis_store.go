package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

type RedisStore struct {
	client  *redis.Client
	nowFunc func() time.Time
}

func NewRedisStore(client *redis.Client) *RedisStore {
	return &RedisStore{client: client, nowFunc: time.Now}
}

func (s *RedisStore) WithNowFunc(f func() time.Time) *RedisStore {
	s.nowFunc = f
	return s
}

func (s *RedisStore) Create(ctx context.Context, session domain.Session, ttl time.Duration) (string, error) {
	idBytes := make([]byte, 32)
	if _, err := rand.Read(idBytes); err != nil {
		return "", err
	}
	id := hex.EncodeToString(idBytes)
	data, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	if err := s.client.Set(ctx, "session:"+id, data, ttl).Err(); err != nil {
		return "", err
	}
	return id, nil
}

func (s *RedisStore) Get(ctx context.Context, id string) (domain.Session, error) {
	data, err := s.client.Get(ctx, "session:"+id).Bytes()
	if errors.Is(err, redis.Nil) {
		return domain.Session{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Session{}, err
	}
	var session domain.Session
	if err := json.Unmarshal(data, &session); err != nil {
		return domain.Session{}, err
	}
	return session, nil
}

func (s *RedisStore) Delete(ctx context.Context, id string) error {
	return s.client.Del(ctx, "session:"+id).Err()
}

func (s *RedisStore) Status(ctx context.Context, userID string, date string) (bool, error) {
	count, err := s.client.Exists(ctx, briefingKey(userID, date)).Result()
	return count > 0, err
}

func (s *RedisStore) Claim(ctx context.Context, userID string, date string, ttl time.Duration) (bool, error) {
	key := briefingKey(userID, date)
	return s.client.SetNX(ctx, key, "sent", ttl).Result()
}

func (s *RedisStore) CreatePendingAction(ctx context.Context, action *domain.PendingAction) error {
	data, err := json.Marshal(action)
	if err != nil {
		return err
	}
	expiresAt := action.CreatedAt.Add(time.Duration(action.ExpiresIn) * time.Second)
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return s.client.Set(ctx, "pending:"+action.PendingID, data, ttl).Err()
}

func (s *RedisStore) GetPendingAction(ctx context.Context, pendingID string) (*domain.PendingAction, error) {
	data, err := s.client.Get(ctx, "pending:"+pendingID).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var action domain.PendingAction
	if err := json.Unmarshal(data, &action); err != nil {
		return nil, err
	}
	// Check expiration using the store's time source
	expiresAt := action.CreatedAt.Add(time.Duration(action.ExpiresIn) * time.Second)
	if s.nowFunc().After(expiresAt) {
		return nil, domain.ErrNotFound
	}
	return &action, nil
}

func (s *RedisStore) UpdatePendingActionStatus(ctx context.Context, pendingID, status string) error {
	action, err := s.GetPendingAction(ctx, pendingID)
	if err != nil {
		return err
	}
	action.Status = status
	return s.CreatePendingAction(ctx, action)
}

func (s *RedisStore) DeletePendingAction(ctx context.Context, pendingID string) error {
	return s.client.Del(ctx, "pending:"+pendingID).Err()
}

func briefingKey(userID string, date string) string {
	return "briefing:" + userID + ":" + date
}
