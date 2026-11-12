CREATE TABLE IF NOT EXISTS pending_actions (
    pending_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pending_actions_user_id_idx ON pending_actions (user_id);
CREATE INDEX IF NOT EXISTS pending_actions_expires_at_idx ON pending_actions (expires_at);