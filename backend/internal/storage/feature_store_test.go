package storage_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/rp3222079-byte/avito-buddy/backend/internal/domain"
	"github.com/rp3222079-byte/avito-buddy/backend/internal/storage"
)

func TestFeatureStoreReturnsMVPDataAndCalculatesDurations(t *testing.T) {
	directory := t.TempDir()
	tasksPath := writeFixture(t, directory, "tasks.json", `{
  "tasks": [{"id":"AVT-1","transitions":[
    {"stage":"NOT_STARTED","entered_at":"2026-11-03T08:00:00Z"},
    {"stage":"IN_PROGRESS","entered_at":"2026-11-03T10:00:00Z"},
    {"stage":"ALMOST_DONE","entered_at":"2026-11-03T12:30:00Z"}
  ]}]
}`)
	scoreboardPath := writeFixture(t, directory, "scoreboard.json", `{
  "week":"2026-W46",
  "entries":[{"intern_id":"intern_ivan","name":"Иван","points":135,"place":1,"is_top5":true}]
}`)
	flagsPath := writeFixture(t, directory, "flags.json", `{
  "flags":[{"id":"f-1","intern_id":"intern_ivan","task_id":"AVT-1","stage":"IN_PROGRESS","type":"STUCK","severity":"high","reason":"Просрочено","created_at":"2026-11-03T10:00:00Z","resolved_at":null,"resolved_by":null}]
}`)
	metricsPath := writeFixture(t, directory, "metrics.json", `{
  "intern_id":"intern_ivan",
  "stages":[{"stage":"IN_PROGRESS","avg_hours":2.5,"baseline_hours":2,"deviation_percent":25}]
}`)

	store, err := storage.NewFeatureStore(tasksPath, scoreboardPath, flagsPath, metricsPath)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	updated, err := store.SyncJira(ctx)
	if err != nil || updated != 4 {
		t.Fatalf("updated = %d, err = %v", updated, err)
	}
	scoreboard, err := store.Scoreboard(ctx)
	if err != nil || scoreboard.Week != "2026-W46" || !scoreboard.Entries[0].IsTop5 {
		t.Fatalf("scoreboard = %#v, err = %v", scoreboard, err)
	}
	flags, err := store.Flags(ctx, "mentor_smith")
	if err != nil || len(flags) != 1 || flags[0].ID != "f-1" {
		t.Fatalf("flags = %#v, err = %v", flags, err)
	}
	metrics, err := store.Metrics(ctx, "ignored")
	if err != nil || metrics.InternID != "intern_ivan" || len(metrics.Stages) != 1 {
		t.Fatalf("metrics = %#v, err = %v", metrics, err)
	}
	stages, err := store.TaskStages(ctx, "AVT-1")
	if err != nil {
		t.Fatal(err)
	}
	if stages.CurrentStage != "ALMOST_DONE" || *stages.Durations["NOT_STARTED"] != 7200 || *stages.Durations["IN_PROGRESS"] != 9000 || stages.Durations["ALMOST_DONE"] != nil {
		t.Fatalf("stages = %#v", stages)
	}
	if _, err := store.TaskStages(ctx, "AVT-404"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("missing task error = %v", err)
	}
}

func TestFeatureStoreRejectsInvalidTransitionTimestamp(t *testing.T) {
	directory := t.TempDir()
	tasksPath := writeFixture(t, directory, "tasks.json", `{"tasks":[{"id":"AVT-1","transitions":[{"stage":"IN_PROGRESS","entered_at":"bad"}]}]}`)
	scoreboardPath := writeFixture(t, directory, "scoreboard.json", `{"week":"2026-W46","entries":[]}`)
	flagsPath := writeFixture(t, directory, "flags.json", `{"flags":[]}`)
	metricsPath := writeFixture(t, directory, "metrics.json", `{"intern_id":"intern_ivan","stages":[]}`)

	if _, err := storage.NewFeatureStore(tasksPath, scoreboardPath, flagsPath, metricsPath); err == nil {
		t.Fatal("expected invalid timestamp error")
	}
}

func writeFixture(t *testing.T, directory, name, content string) string {
	t.Helper()
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
