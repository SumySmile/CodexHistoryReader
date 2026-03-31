import Database from 'better-sqlite3';

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      project_path TEXT,
      summary TEXT,
      first_prompt TEXT,
      message_count INTEGER DEFAULT 0,
      git_branch TEXT,
      model TEXT,
      created_at TEXT,
      modified_at TEXT,
      file_path TEXT NOT NULL,
      file_mtime REAL,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      is_favorite INTEGER DEFAULT 0,
      indexed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_slug);
    CREATE INDEX IF NOT EXISTS idx_sessions_modified ON sessions(modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_favorite ON sessions(is_favorite);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS session_tags (
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (session_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON session_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_session_tags_session ON session_tags(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model);
    CREATE INDEX IF NOT EXISTS idx_sessions_tokens ON sessions(total_input_tokens);
  `);

  const sessionCols = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  const hasCustomTitle = sessionCols.some(c => c.name === 'custom_title');
  if (!hasCustomTitle) {
    db.exec(`ALTER TABLE sessions ADD COLUMN custom_title TEXT;`);
  }
  const hasParentSessionId = sessionCols.some(c => c.name === 'parent_session_id');
  if (!hasParentSessionId) {
    db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;`);
  }
  const hasIsSubagent = sessionCols.some(c => c.name === 'is_subagent');
  if (!hasIsSubagent) {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_subagent INTEGER DEFAULT 0;`);
  }
  const hasCodexLineageChecked = sessionCols.some(c => c.name === 'codex_lineage_checked');
  if (!hasCodexLineageChecked) {
    db.exec(`ALTER TABLE sessions ADD COLUMN codex_lineage_checked INTEGER DEFAULT 0;`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_parent_session ON sessions(parent_session_id);
  `);

  // FTS5 table - create separately as it doesn't support IF NOT EXISTS well
  try {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        session_id UNINDEXED,
        message_uuid UNINDEXED,
        role,
        content,
        timestamp UNINDEXED,
        tokenize='porter unicode61'
      );
    `);
  } catch {
    // Table already exists
  }
}
