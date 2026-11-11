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
	client *redis.Client
}

func NewRedisStore(client *redis.Client) *RedisStore {
	return &RedisStore{client: client}
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

func (s *RedisStore) Claim(ctx context.Context, userID string, date string, ttl time.Duration, force bool) (bool, error) {
	key := briefingKey(userID, date)
	if force {
		return true, s.client.Set(ctx, key, "sent", ttl).Err()
	}
	return s.client.SetNX(ctx, key, "sent", ttl).Result()
}

func briefingKey(userID string, date string) string {
	return "briefing:" + userID + ":" + date
}
