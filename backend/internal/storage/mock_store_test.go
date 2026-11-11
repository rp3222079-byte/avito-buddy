package storage_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/storage"
)

func TestMockStoreFiltersTasksAndResolvesMentor(t *testing.T) {
	directory := t.TempDir()
	tasksPath := filepath.Join(directory, "tasks.json")
	mentorsPath := filepath.Join(directory, "mentors.json")
	if err := os.WriteFile(tasksPath, []byte(`{"tasks":[{"id":"AVT-1","title":"One","status":"To Do","priority":"High","assignee":"intern_ivan"},{"id":"AVT-2","title":"Two","status":"Done","priority":"Low","assignee":"intern_anna"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mentorsPath, []byte(`{"mentor_id":"mentor_smith","mentor_name":"Алексей Смит","interns":[{"intern_id":"intern_ivan","name":"Иван","progress_percent":55,"status":"blocked","blockers":[]}]}`), 0o600); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewMockStore(tasksPath, mentorsPath)
	if err != nil {
		t.Fatal(err)
	}
	tasks, err := store.ForUser(context.Background(), "intern_ivan")
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].ID != "AVT-1" {
		t.Fatalf("tasks = %#v", tasks)
	}
	notification, err := store.Notify(context.Background(), "intern_ivan", "Помогите")
	if err != nil {
		t.Fatal(err)
	}
	if notification.MentorName != "Алексей Смит" {
		t.Fatalf("notification = %#v", notification)
	}
	identities := store.AllowedIdentities()
	if identities["intern_ivan"] != domain.RoleIntern || identities["mentor_smith"] != domain.RoleMentor {
		t.Fatalf("identities = %#v", identities)
	}
}
