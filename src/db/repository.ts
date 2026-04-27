import { Db } from './database.js';
import { currentPeriod } from '../utils/format.js';

export type BudgetCategoryInput = {
  name: string;
  limit: number;
  kind: 'shared' | 'personal';
  personName?: string | null;
};

export type BudgetSummaryCategory = {
  id: number;
  name: string;
  kind: string;
  personName: string | null;
  limit: number;
  spent: number;
  remaining: number;
};

export type AdviceExpense = {
  publicId: string;
  amount: number;
  category: string;
  description: string;
  status: string;
  expenseDate: string;
  createdAt: string;
};

export type CategoryTrend = {
  period: string;
  category: string;
  spent: number;
  budgetLimit: number;
  remaining: number;
};

export class Repository {
  constructor(private readonly db: Db, private readonly currency: string) {}

  rawDb(): Db {
    return this.db;
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  upsertContact(jid: string, displayName?: string): void {
    const phone = jid.split('@')[0]?.split(':')[0] ?? jid;
    this.db
      .prepare(
        `INSERT INTO whatsapp_contacts(jid, phone, display_name, updated_at)
         VALUES(?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(jid) DO UPDATE SET phone = excluded.phone, display_name = COALESCE(excluded.display_name, whatsapp_contacts.display_name), updated_at = CURRENT_TIMESTAMP`
      )
      .run(jid, phone, displayName ?? null);
  }

  ensurePerson(name: string, jid?: string | null): number {
    const existing = this.db.prepare('SELECT id FROM people WHERE lower(name) = lower(?)').get(name) as { id: number } | undefined;
    if (existing) {
      if (jid) this.db.prepare('UPDATE people SET contact_jid = COALESCE(contact_jid, ?) WHERE id = ?').run(jid, existing.id);
      return existing.id;
    }
    return Number(this.db.prepare('INSERT INTO people(name, contact_jid) VALUES(?, ?)').run(name, jid ?? null).lastInsertRowid);
  }

  identifyPerson(name: string, jid: string): void {
    const personId = this.ensurePerson(name, jid);
    this.db.prepare('UPDATE people SET contact_jid = ? WHERE id = ?').run(jid, personId);
    this.db.prepare('UPDATE whatsapp_contacts SET person_id = ? WHERE jid = ?').run(personId, jid);
  }

  personForSender(jid: string, fallbackName?: string): number {
    const contact = this.db.prepare('SELECT person_id FROM whatsapp_contacts WHERE jid = ?').get(jid) as { person_id: number | null } | undefined;
    if (contact?.person_id) return contact.person_id;
    return this.ensurePerson(fallbackName?.trim() || jid.split('@')[0] || 'Persona', jid);
  }

  upsertBudget(period: string, total: number, categories: BudgetCategoryInput[]): void {
    const tx = this.db.transaction(() => {
      const totalCents = toCents(total);
      const row = this.db.prepare('SELECT id FROM budget_periods WHERE period = ?').get(period) as { id: number } | undefined;
      const periodId =
        row?.id ??
        Number(
          this.db
            .prepare('INSERT INTO budget_periods(period, total_cents, currency) VALUES(?, ?, ?)')
            .run(period, totalCents, this.currency).lastInsertRowid
        );
      if (row) {
        this.db.prepare('UPDATE budget_periods SET total_cents = ?, currency = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(totalCents, this.currency, periodId);
      }
      for (const category of categories) {
        const personId = category.kind === 'personal' && category.personName ? this.ensurePerson(category.personName) : null;
        this.db
          .prepare(
            `INSERT INTO budget_categories(period_id, name, limit_cents, kind, person_id)
             VALUES(?, ?, ?, ?, ?)
             ON CONFLICT(period_id, name, person_id) DO UPDATE SET limit_cents = excluded.limit_cents, kind = excluded.kind`
          )
          .run(periodId, category.name, toCents(category.limit), category.kind, personId);
      }
    });
    tx();
  }

  activePeriod(date = new Date()): { id: number; period: string; total: number; currency: string } | undefined {
    const period = currentPeriod(date);
    const row = this.db.prepare('SELECT id, period, total_cents, currency FROM budget_periods WHERE period = ?').get(period) as
      | { id: number; period: string; total_cents: number; currency: string }
      | undefined;
    return row ? { id: row.id, period: row.period, total: fromCents(row.total_cents), currency: row.currency } : undefined;
  }

  findCategory(periodId: number, name: string, personId?: number | null): { id: number; kind: string; name: string } | undefined {
    const rows = this.db
      .prepare('SELECT id, kind, name, person_id FROM budget_categories WHERE period_id = ? AND lower(name) = lower(?)')
      .all(periodId, name) as Array<{ id: number; kind: string; name: string; person_id: number | null }>;
    if (rows.length === 0) return undefined;
    return rows.find((row) => row.person_id === personId) ?? rows.find((row) => row.person_id == null) ?? rows[0];
  }

  createExpense(input: {
    amount: number;
    category: string;
    description: string;
    personId: number;
    senderJid: string;
    groupJid: string;
    messageId: string;
    receiptPath?: string;
    date?: string | null;
  }): { id: number; publicId: string } {
    const period = this.activePeriod();
    if (!period) throw new Error(`No hay presupuesto configurado para ${currentPeriod()}.`);
    const category = this.findCategory(period.id, input.category, input.personId);
    if (!category) throw new Error(`No encuentro la categoría "${input.category}" en el presupuesto actual.`);
    const publicId = `G${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO expenses(public_id, period_id, category_id, person_id, amount_cents, currency, description, expense_date, sender_jid, source_message_id, source_group_jid, receipt_path)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          publicId,
          period.id,
          category.id,
          input.personId,
          toCents(input.amount),
          period.currency,
          input.description,
          input.date ?? new Date().toISOString().slice(0, 10),
          input.senderJid,
          input.messageId,
          input.groupJid,
          input.receiptPath ?? null
        ).lastInsertRowid
    );
    this.addExpenseEvent(id, 'created', input);
    return { id, publicId };
  }

  cancelExpense(ref: string | null, senderJid: string): { publicId: string; amount: number; description: string } | undefined {
    const row = ref
      ? (this.db
          .prepare(
            `SELECT id, public_id, amount_cents, description FROM expenses
             WHERE status = 'active' AND (public_id = ? OR description LIKE ?)
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(ref, `%${ref}%`) as { id: number; public_id: string; amount_cents: number; description: string } | undefined)
      : (this.db
          .prepare('SELECT id, public_id, amount_cents, description FROM expenses WHERE status = ? AND sender_jid = ? ORDER BY created_at DESC LIMIT 1')
          .get('active', senderJid) as { id: number; public_id: string; amount_cents: number; description: string } | undefined);
    if (!row) return undefined;
    this.db.prepare('UPDATE expenses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('cancelled', row.id);
    this.addExpenseEvent(row.id, 'cancelled', { ref, senderJid });
    return { publicId: row.public_id, amount: fromCents(row.amount_cents), description: row.description };
  }

  recentExpenses(limit = 8): Array<{ publicId: string; amount: number; category: string; description: string; status: string; createdAt: string }> {
    return this.db
      .prepare(
        `SELECT e.public_id, e.amount_cents, c.name category, e.description, e.status, e.created_at
         FROM expenses e JOIN budget_categories c ON c.id = e.category_id
         ORDER BY e.created_at DESC LIMIT ?`
      )
      .all(limit)
      .map((row: any) => ({
        publicId: row.public_id,
        amount: fromCents(row.amount_cents),
        category: row.category,
        description: row.description,
        status: row.status,
        createdAt: row.created_at
      }));
  }

  recentExpensesForAdvice(limit = 12): AdviceExpense[] {
    return this.db
      .prepare(
        `SELECT e.public_id, e.amount_cents, c.name category, e.description, e.status, e.expense_date, e.created_at
         FROM expenses e JOIN budget_categories c ON c.id = e.category_id
         ORDER BY e.created_at DESC LIMIT ?`
      )
      .all(limit)
      .map((row: any) => ({
        publicId: row.public_id,
        amount: fromCents(row.amount_cents),
        category: row.category,
        description: row.description,
        status: row.status,
        expenseDate: row.expense_date,
        createdAt: row.created_at
      }));
  }

  budgetSummary(date = new Date()): { period: string; total: number; spent: number; remaining: number; categories: BudgetSummaryCategory[] } | undefined {
    const period = this.activePeriod(date);
    if (!period) return undefined;
    const spentRow = this.db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) spent FROM expenses WHERE period_id = ? AND status = ?')
      .get(period.id, 'active') as { spent: number };
    const categories = this.db
      .prepare(
        `SELECT c.id, c.name, c.kind, p.name person_name, c.limit_cents,
                COALESCE(SUM(CASE WHEN e.status = 'active' THEN e.amount_cents ELSE 0 END), 0) spent_cents
         FROM budget_categories c
         LEFT JOIN people p ON p.id = c.person_id
         LEFT JOIN expenses e ON e.category_id = c.id
         WHERE c.period_id = ?
         GROUP BY c.id
         ORDER BY c.name`
      )
      .all(period.id)
      .map((row: any) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        personName: row.person_name ?? null,
        limit: fromCents(row.limit_cents),
        spent: fromCents(row.spent_cents),
        remaining: fromCents(row.limit_cents - row.spent_cents)
      }));
    const spent = fromCents(spentRow.spent);
    return { period: period.period, total: period.total, spent, remaining: period.total - spent, categories };
  }

  financialContextForCurrentPeriod(date = new Date()):
    | {
        period: string;
        total: number;
        spent: number;
        remaining: number;
        categories: BudgetSummaryCategory[];
      }
    | undefined {
    return this.budgetSummary(date);
  }

  categoryTrends(periods = 3): CategoryTrend[] {
    return this.db
      .prepare(
        `SELECT bp.period, c.name category, c.limit_cents,
                COALESCE(SUM(CASE WHEN e.status = 'active' THEN e.amount_cents ELSE 0 END), 0) spent_cents
         FROM budget_periods bp
         JOIN budget_categories c ON c.period_id = bp.id
         LEFT JOIN expenses e ON e.category_id = c.id
         WHERE bp.period IN (
           SELECT period FROM budget_periods ORDER BY period DESC LIMIT ?
         )
         GROUP BY bp.period, c.id
         ORDER BY bp.period DESC, c.name`
      )
      .all(periods)
      .map((row: any) => {
        const budgetLimit = fromCents(row.limit_cents);
        const spent = fromCents(row.spent_cents);
        return {
          period: row.period,
          category: row.category,
          spent,
          budgetLimit,
          remaining: budgetLimit - spent
        };
      });
  }

  saveLlmCall(input: { messageId: string; intent?: string; confidence?: number; rawJson?: string; error?: string; promptTokens?: number; outputTokens?: number }): void {
    this.db
      .prepare('INSERT INTO llm_calls(message_id, intent, confidence, prompt_tokens, output_tokens, raw_json, error) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(input.messageId, input.intent ?? null, input.confidence ?? null, input.promptTokens ?? null, input.outputTokens ?? null, input.rawJson ?? null, input.error ?? null);
  }

  private addExpenseEvent(expenseId: number, eventType: string, payload: unknown): void {
    this.db.prepare('INSERT INTO expense_events(expense_id, event_type, payload_json) VALUES(?, ?, ?)').run(expenseId, eventType, JSON.stringify(payload));
  }
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(value: number): number {
  return Math.round(value) / 100;
}
