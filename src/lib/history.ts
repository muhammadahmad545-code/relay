import * as SQLite from 'expo-sqlite';

export interface HistoryEntry {
  id: string;
  direction: 'in' | 'out';
  name: string;
  size: number;
  status: 'done' | 'failed';
  error: string | null;
  savedUri: string | null;
  createdAt: number;
}

interface Row {
  id: string;
  direction: 'in' | 'out';
  name: string;
  size: number;
  status: 'done' | 'failed';
  error: string | null;
  saved_uri: string | null;
  created_at: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const database = await SQLite.openDatabaseAsync('relay.db');
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY NOT NULL,
        direction TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        saved_uri TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_created_at ON history (created_at DESC);
    `);
    return database;
  })();
  // If opening failed, let the next call try again instead of caching the rejection forever.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

const toEntry = (r: Row): HistoryEntry => ({
  id: r.id,
  direction: r.direction,
  name: r.name,
  size: r.size,
  status: r.status,
  error: r.error,
  savedUri: r.saved_uri,
  createdAt: r.created_at,
});

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const database = await db();
  await database.runAsync(
    'INSERT OR REPLACE INTO history (id, direction, name, size, status, error, saved_uri, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [entry.id, entry.direction, entry.name, entry.size, entry.status, entry.error, entry.savedUri, entry.createdAt],
  );
}

export async function listHistory(limit = 200): Promise<HistoryEntry[]> {
  const database = await db();
  const rows = await database.getAllAsync<Row>('SELECT * FROM history ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map(toEntry);
}

/** The file was deleted from the phone: keep the row, forget the file. */
export async function forgetFile(id: string): Promise<void> {
  const database = await db();
  await database.runAsync('UPDATE history SET saved_uri = NULL WHERE id = ?', [id]);
}

export async function clearHistory(): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM history');
}
