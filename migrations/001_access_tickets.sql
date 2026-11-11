CREATE TABLE IF NOT EXISTS access_tickets (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    system TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    sla_hours INTEGER NOT NULL DEFAULT 2 CHECK (sla_hours > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT access_tickets_user_system_unique UNIQUE (user_id, system),
    CONSTRAINT access_tickets_system_normalized CHECK (system = LOWER(BTRIM(system)))
);

CREATE INDEX IF NOT EXISTS access_tickets_user_id_idx ON access_tickets (user_id);
