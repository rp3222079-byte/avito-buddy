package storage

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
)

type postgresQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PostgresTicketStore struct {
	database postgresQuerier
}

func NewPostgresTicketStore(database postgresQuerier) *PostgresTicketStore {
	return &PostgresTicketStore{database: database}
}

func (s *PostgresTicketStore) CreateOrGet(ctx context.Context, userID string, system string) (domain.Ticket, bool, error) {
	const insert = `INSERT INTO access_tickets (user_id, system)
VALUES ($1, $2)
ON CONFLICT (user_id, system) DO NOTHING
RETURNING 'IT-' || LPAD(id::text, 3, '0'), user_id, system, status, sla_hours`
	ticket, err := scanTicket(s.database.QueryRow(ctx, insert, userID, system))
	if err == nil {
		return ticket, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.Ticket{}, false, err
	}

	const selectExisting = `SELECT 'IT-' || LPAD(id::text, 3, '0'), user_id, system, status, sla_hours
FROM access_tickets
WHERE user_id = $1 AND system = $2`
	ticket, err = scanTicket(s.database.QueryRow(ctx, selectExisting, userID, system))
	if err != nil {
		return domain.Ticket{}, false, err
	}
	return ticket, false, nil
}

func scanTicket(row pgx.Row) (domain.Ticket, error) {
	var ticket domain.Ticket
	err := row.Scan(&ticket.TicketID, &ticket.UserID, &ticket.System, &ticket.Status, &ticket.SLAHours)
	return ticket, err
}
