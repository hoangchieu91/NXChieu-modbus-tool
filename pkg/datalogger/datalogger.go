package datalogger

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// DatalogPointConfig defines a register/coil targeted for logging.
type DatalogPointConfig struct {
	SessionID      string  `json:"session_id"` // tab/session origin
	Address        int     `json:"address"`
	DisplayAddress string  `json:"display_address"`
	Alias          string  `json:"alias"`
	Unit           string  `json:"unit"`
	Scaling        float64 `json:"scaling"`
	Format         string  `json:"format"`
	IsCoil         bool    `json:"is_coil"`
}

// DatalogSessionInfo summarizes a past or ongoing logging run.
type DatalogSessionInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	CreatedAt   string `json:"created_at"`
	ClosedAt    string `json:"closed_at"`
	PointCount  int    `json:"point_count"`
	SampleCount int    `json:"sample_count"`
	IntervalSec int    `json:"interval_sec"`
	IsActive    bool   `json:"is_active"`
}

// DatalogRecord represents one logged row.
type DatalogRecord struct {
	Timestamp      string  `json:"timestamp"`
	Address        int     `json:"address"`
	DisplayAddress string  `json:"display_address"`
	Alias          string  `json:"alias"`
	Value          float64 `json:"value"`
	Unit           string  `json:"unit"`
	RawHex         string  `json:"raw_hex"`
}

// DataloggerEngine manages SQLite-backed persistence for overnight test logs.
type DataloggerEngine struct {
	mu           sync.Mutex
	db           *sql.DB
	dbPath       string
	activeID     string
	activeTicker *time.Ticker
	activeStop   chan struct{}
}

// NewDataloggerEngine opens or creates the SQLite database at nxmodbus_datalog.db.
func NewDataloggerEngine(storageDir string) (*DataloggerEngine, error) {
	if storageDir == "" {
		storageDir = "."
	}
	dbPath := filepath.Join(storageDir, "nxmodbus_datalog.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open datalogger db: %w", err)
	}

	// Enable WAL mode for high concurrency & zero lock contention
	_, _ = db.Exec("PRAGMA journal_mode = WAL;")
	_, _ = db.Exec("PRAGMA synchronous = NORMAL;")

	engine := &DataloggerEngine{
		db:     db,
		dbPath: dbPath,
	}

	if err := engine.initSchema(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return engine, nil
}

func (d *DataloggerEngine) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS datalog_sessions (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at DATETIME NOT NULL,
		closed_at DATETIME,
		interval_sec INTEGER NOT NULL,
		point_count INTEGER NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS datalog_points (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		timestamp DATETIME NOT NULL,
		address INTEGER NOT NULL,
		display_address TEXT,
		alias TEXT,
		value REAL NOT NULL,
		unit TEXT,
		raw_hex TEXT,
		FOREIGN KEY (session_id) REFERENCES datalog_sessions(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_datalog_session_time ON datalog_points(session_id, timestamp);
	`
	_, err := d.db.Exec(schema)
	return err
}

// StartSession creates a new named session in SQLite and marks it active.
func (d *DataloggerEngine) StartSession(name string, intervalSec int, pointCount int) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.activeID != "" {
		// Stop previous if active
		_, _ = d.db.Exec("UPDATE datalog_sessions SET is_active = 0, closed_at = datetime('now') WHERE id = ?", d.activeID)
	}

	if intervalSec <= 0 {
		intervalSec = 1
	}
	if name == "" {
		name = fmt.Sprintf("Datalog %s", time.Now().Format("2006-01-02 15:04:05"))
	}

	sessID := fmt.Sprintf("sess_%d", time.Now().UnixNano())
	now := time.Now().UTC().Format(time.RFC3339)

	query := `INSERT INTO datalog_sessions (id, name, created_at, interval_sec, point_count, is_active) VALUES (?, ?, ?, ?, ?, 1)`
	if _, err := d.db.Exec(query, sessID, name, now, intervalSec, pointCount); err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}

	d.activeID = sessID
	return sessID, nil
}

// StopSession closes the active or target session.
func (d *DataloggerEngine) StopSession(sessID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if sessID == "" {
		sessID = d.activeID
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.db.Exec("UPDATE datalog_sessions SET is_active = 0, closed_at = ? WHERE id = ?", now, sessID)
	if sessID == d.activeID {
		d.activeID = ""
	}
	return err
}

// LogSampleBatch writes multiple points atomically to the database.
func (d *DataloggerEngine) LogSampleBatch(sessID string, records []DatalogRecord) error {
	if len(records) == 0 {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	if sessID == "" {
		sessID = d.activeID
	}
	if sessID == "" {
		return nil
	}

	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.Prepare(`INSERT INTO datalog_points (session_id, timestamp, address, display_address, alias, value, unit, raw_hex) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range records {
		ts := r.Timestamp
		if ts == "" {
			ts = time.Now().Format("2006-01-02 15:04:05.000")
		}
		if _, err := stmt.Exec(sessID, ts, r.Address, r.DisplayAddress, r.Alias, r.Value, r.Unit, r.RawHex); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// ListSessions retrieves past sessions with their sample count.
func (d *DataloggerEngine) ListSessions() ([]DatalogSessionInfo, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	query := `
	SELECT s.id, s.name, s.created_at, IFNULL(s.closed_at, ''), s.interval_sec, s.point_count, s.is_active,
	       (SELECT COUNT(*) FROM datalog_points p WHERE p.session_id = s.id) AS samples
	FROM datalog_sessions s
	ORDER BY s.created_at DESC
	LIMIT 100
	`
	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []DatalogSessionInfo
	for rows.Next() {
		var s DatalogSessionInfo
		var isActiveInt int
		if err := rows.Scan(&s.ID, &s.Name, &s.CreatedAt, &s.ClosedAt, &s.IntervalSec, &s.PointCount, &isActiveInt, &s.SampleCount); err != nil {
			continue
		}
		s.IsActive = isActiveInt == 1
		result = append(result, s)
	}

	return result, nil
}

// GetSessionRecords fetches logged records for inspection.
func (d *DataloggerEngine) GetSessionRecords(sessID string, limit, offset int) ([]DatalogRecord, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if limit <= 0 {
		limit = 1000
	}
	if limit > 5000 {
		limit = 5000
	}

	query := `
	SELECT timestamp, address, display_address, alias, value, unit, IFNULL(raw_hex, '')
	FROM datalog_points
	WHERE session_id = ?
	ORDER BY id ASC
	LIMIT ? OFFSET ?
	`
	rows, err := d.db.Query(query, sessID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []DatalogRecord
	for rows.Next() {
		var r DatalogRecord
		if err := rows.Scan(&r.Timestamp, &r.Address, &r.DisplayAddress, &r.Alias, &r.Value, &r.Unit, &r.RawHex); err != nil {
			continue
		}
		records = append(records, r)
	}
	return records, nil
}

// ExportCSV exports an entire session to a clean CSV file.
func (d *DataloggerEngine) ExportCSV(sessID, destPath string) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	f, err := os.Create(destPath)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	// Write UTF-8 BOM for Excel compatibility
	_, _ = f.WriteString("\xEF\xBB\xBF")

	writer := csv.NewWriter(f)
	defer writer.Flush()

	_ = writer.Write([]string{"Timestamp", "Address", "Display Address", "Alias", "Value", "Unit", "Raw Hex"})

	query := `
	SELECT timestamp, address, display_address, alias, value, unit, IFNULL(raw_hex, '')
	FROM datalog_points
	WHERE session_id = ?
	ORDER BY id ASC
	`
	rows, err := d.db.Query(query, sessID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var r DatalogRecord
		if err := rows.Scan(&r.Timestamp, &r.Address, &r.DisplayAddress, &r.Alias, &r.Value, &r.Unit, &r.RawHex); err != nil {
			continue
		}
		_ = writer.Write([]string{
			r.Timestamp,
			fmt.Sprintf("%d", r.Address),
			r.DisplayAddress,
			r.Alias,
			fmt.Sprintf("%f", r.Value),
			r.Unit,
			r.RawHex,
		})
		count++
	}

	return count, nil
}

// DeleteSession wipes a session and all its points.
func (d *DataloggerEngine) DeleteSession(sessID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, _ = d.db.Exec("DELETE FROM datalog_points WHERE session_id = ?", sessID)
	_, err := d.db.Exec("DELETE FROM datalog_sessions WHERE id = ?", sessID)
	return err
}

// Close gracefully closes the SQLite database.
func (d *DataloggerEngine) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}
