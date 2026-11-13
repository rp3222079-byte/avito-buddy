package storage_test

import (
	"context"
	"regexp"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/storage"
)

func TestPostgresTicketStoreReturnsExistingTicketAfterUniqueConflict(t *testing.T) {
	database, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	insert := database.ExpectQuery(regexp.QuoteMeta("INSERT INTO access_tickets"))
	insert.WithArgs("intern_ivan", "confluence")
	insert.WillReturnRows(pgxmock.NewRows([]string{"request_id", "user_id", "system", "access_level", "reason", "status", "sla_hours"}))
	selectExisting := database.ExpectQuery(regexp.QuoteMeta("SELECT 'IT-' || LPAD(id::text, 3, '0')"))
	selectExisting.WithArgs("intern_ivan", "confluence")
	selectExisting.WillReturnRows(pgxmock.NewRows([]string{"request_id", "user_id", "system", "access_level", "reason", "status", "sla_hours"}).AddRow("IT-123", "intern_ivan", "confluence", "read", "", "pending", 2))

	ticket, created, err := storage.NewPostgresTicketStore(database).CreateOrGet(context.Background(), "intern_ivan", "confluence")
	if err != nil {
		t.Fatal(err)
	}
	if created || ticket.RequestID != "IT-123" {
		t.Fatalf("ticket=%#v created=%v", ticket, created)
	}
	if err := database.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
