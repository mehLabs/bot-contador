import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { schemaSql } from './schema.js';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(schemaSql);
  runMigrations(db);
  return db;
}

export function resetDatabase(db: Db): void {
  db.exec(`
    DELETE FROM llm_calls;
    DELETE FROM pending_confirmations;
    DELETE FROM goals;
    DELETE FROM incomes;
    DELETE FROM conversation_state;
    DELETE FROM expense_events;
    DELETE FROM expenses;
    DELETE FROM fixed_expenses;
    DELETE FROM budget_categories;
    DELETE FROM budget_periods;
    DELETE FROM people;
    DELETE FROM whatsapp_contacts;
    DELETE FROM settings;
    VACUUM;
  `);
}

function runMigrations(db: Db): void {
  const expenseColumns = db.prepare('PRAGMA table_info(expenses)').all() as Array<{ name: string }>;
  if (!expenseColumns.some((column) => column.name === 'expense_type')) {
    db.exec("ALTER TABLE expenses ADD COLUMN expense_type TEXT NOT NULL DEFAULT 'regular'");
  }
}
