import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { schemaSql } from './schema.js';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(schemaSql);
  return db;
}

export function resetDatabase(db: Db): void {
  db.exec(`
    DELETE FROM llm_calls;
    DELETE FROM conversation_state;
    DELETE FROM expense_events;
    DELETE FROM expenses;
    DELETE FROM budget_categories;
    DELETE FROM budget_periods;
    DELETE FROM people;
    DELETE FROM whatsapp_contacts;
    DELETE FROM settings;
    VACUUM;
  `);
}
