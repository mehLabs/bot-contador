import { Db } from './database.js';
import { currentPeriod, nextPeriod } from '../utils/format.js';

export type BudgetCategoryInput = {
  name: string;
  limit: number;
  kind: 'shared' | 'personal';
  personName?: string | null;
};

export type FixedExpenseInput = {
  name: string;
  amount: number;
  source?: 'manual' | 'credit_card';
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

export type FixedExpenseSummary = {
  id: number;
  name: string;
  amount: number;
  source: 'manual' | 'credit_card';
};

export type IncomeSummary = {
  id: number;
  amount: number;
  category: string | null;
  description: string;
  incomeDate: string;
};

export type GoalSummary = {
  id: number;
  title: string;
  horizon: 'short' | 'medium' | 'long';
  status: 'active' | 'done' | 'cancelled';
  targetAmount: number | null;
  targetDate: string | null;
  notes: string | null;
};

export type AdviceExpense = {
  publicId: string;
  amount: number;
  category: string | null;
  expenseType: string;
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

  upsertBudget(period: string, total: number, categories: BudgetCategoryInput[], fixedExpenses: FixedExpenseInput[] = []): void {
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
      for (const fixed of fixedExpenses) {
        this.upsertFixedExpenseByPeriodId(periodId, fixed.name, fixed.amount, fixed.source ?? 'manual');
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

  ensureCategory(periodId: number, name: string, limit: number, kind: 'shared' | 'personal' = 'shared', personName?: string | null): number {
    const existing = this.findCategory(periodId, name, personName ? this.ensurePerson(personName) : null);
    if (existing) return existing.id;
    const personId = kind === 'personal' && personName ? this.ensurePerson(personName) : null;
    return Number(
      this.db
        .prepare('INSERT INTO budget_categories(period_id, name, limit_cents, kind, person_id) VALUES(?, ?, ?, ?, ?)')
        .run(periodId, name, toCents(limit), kind, personId).lastInsertRowid
    );
  }

  updateBudgetTotal(period: string, total: number): void {
    this.db.prepare('UPDATE budget_periods SET total_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE period = ?').run(toCents(total), period);
  }

  addToBudgetTotal(periodId: number, amount: number): void {
    this.db.prepare('UPDATE budget_periods SET total_cents = total_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(toCents(amount), periodId);
  }

  addToCategoryLimit(categoryId: number, amount: number): void {
    this.db.prepare('UPDATE budget_categories SET limit_cents = limit_cents + ? WHERE id = ?').run(toCents(amount), categoryId);
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

  createAdjustmentExpense(input: {
    amount: number;
    description: string;
    senderJid: string;
    groupJid: string;
    messageId: string;
    date?: string | null;
  }): { id: number; publicId: string } {
    const period = this.activePeriod();
    if (!period) throw new Error(`No hay presupuesto configurado para ${currentPeriod()}.`);
    const publicId = `A${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO expenses(public_id, period_id, category_id, person_id, amount_cents, currency, description, expense_date, sender_jid, source_message_id, source_group_jid, receipt_path, expense_type)
           VALUES(?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(
          publicId,
          period.id,
          toCents(input.amount),
          period.currency,
          input.description,
          input.date ?? new Date().toISOString().slice(0, 10),
          input.senderJid,
          input.messageId,
          input.groupJid,
          'adjustment'
        ).lastInsertRowid
    );
    this.addExpenseEvent(id, 'adjustment_created', input);
    return { id, publicId };
  }

  registerIncome(input: {
    amount: number;
    description: string;
    category?: string | null;
    senderJid: string;
    groupJid: string;
    messageId: string;
    date?: string | null;
  }): { id: number; category: string } {
    const period = this.activePeriod();
    if (!period) throw new Error(`No hay presupuesto configurado para ${currentPeriod()}.`);
    const categoryName = input.category?.trim() || 'Sin asignar';
    const categoryId = this.ensureCategory(period.id, categoryName, 0);
    const tx = this.db.transaction(() => {
      this.addToBudgetTotal(period.id, input.amount);
      this.addToCategoryLimit(categoryId, input.amount);
      return Number(
        this.db
          .prepare(
            `INSERT INTO incomes(period_id, category_id, amount_cents, currency, description, income_date, sender_jid, source_message_id, source_group_jid)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            period.id,
            categoryId,
            toCents(input.amount),
            period.currency,
            input.description,
            input.date ?? new Date().toISOString().slice(0, 10),
            input.senderJid,
            input.messageId,
            input.groupJid
          ).lastInsertRowid
      );
    });
    return { id: tx(), category: categoryName };
  }

  addCreditCardFixedExpense(cardName: string, amount: number, date = new Date()): { period: string; name: string; amount: number } {
    const period = this.ensureBudgetPeriod(nextPeriod(date), this.currency);
    const name = `Tarjeta ${cardName.trim()}`;
    const existing = this.db
      .prepare('SELECT id, amount_cents FROM fixed_expenses WHERE period_id = ? AND lower(name) = lower(?) AND source = ?')
      .get(period.id, name, 'credit_card') as { id: number; amount_cents: number } | undefined;
    if (existing) {
      this.db
        .prepare('UPDATE fixed_expenses SET amount_cents = amount_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(toCents(amount), existing.id);
      return { period: period.period, name, amount: fromCents(existing.amount_cents + toCents(amount)) };
    }
    this.upsertFixedExpenseByPeriodId(period.id, name, amount, 'credit_card');
    return { period: period.period, name, amount };
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
        `SELECT e.public_id, e.amount_cents, COALESCE(c.name, e.expense_type) category, e.description, e.status, e.created_at
         FROM expenses e LEFT JOIN budget_categories c ON c.id = e.category_id
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
        `SELECT e.public_id, e.amount_cents, c.name category, e.expense_type, e.description, e.status, e.expense_date, e.created_at
         FROM expenses e LEFT JOIN budget_categories c ON c.id = e.category_id
         ORDER BY e.created_at DESC LIMIT ?`
      )
      .all(limit)
      .map((row: any) => ({
        publicId: row.public_id,
        amount: fromCents(row.amount_cents),
        category: row.category ?? null,
        expenseType: row.expense_type,
        description: row.description,
        status: row.status,
        expenseDate: row.expense_date,
        createdAt: row.created_at
      }));
  }

  budgetSummary(date = new Date()): { period: string; total: number; spent: number; fixedSpent: number; variableSpent: number; remaining: number; categories: BudgetSummaryCategory[]; fixedExpenses: FixedExpenseSummary[]; incomes: IncomeSummary[]; adjustments: AdviceExpense[] } | undefined {
    const period = this.activePeriod(date);
    if (!period) return undefined;
    const spentRow = this.db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) spent FROM expenses WHERE period_id = ? AND status = ?')
      .get(period.id, 'active') as { spent: number };
    const fixedRow = this.db.prepare('SELECT COALESCE(SUM(amount_cents), 0) spent FROM fixed_expenses WHERE period_id = ?').get(period.id) as { spent: number };
    const categories = this.db
      .prepare(
        `SELECT c.id, c.name, c.kind, p.name person_name, c.limit_cents,
                COALESCE(SUM(CASE WHEN e.status = 'active' THEN e.amount_cents ELSE 0 END), 0) spent_cents
         FROM budget_categories c
         LEFT JOIN people p ON p.id = c.person_id
         LEFT JOIN expenses e ON e.category_id = c.id AND e.expense_type = 'regular'
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
    const fixedSpent = fromCents(fixedRow.spent);
    const fixedExpenses = this.fixedExpensesForPeriod(period.id);
    const incomes = this.incomesForPeriod(period.id);
    const adjustments = this.adjustmentsForPeriod(period.id);
    return { period: period.period, total: period.total, spent: spent + fixedSpent, fixedSpent, variableSpent: spent, remaining: period.total - spent - fixedSpent, categories, fixedExpenses, incomes, adjustments };
  }

  financialContextForCurrentPeriod(date = new Date()):
    | {
        period: string;
        total: number;
        spent: number;
        fixedSpent: number;
        variableSpent: number;
        remaining: number;
        categories: BudgetSummaryCategory[];
        fixedExpenses: FixedExpenseSummary[];
        incomes: IncomeSummary[];
        adjustments: AdviceExpense[];
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

  previousBudget(period: string): { period: string; total: number; categories: BudgetCategoryInput[]; fixedExpenses: FixedExpenseInput[] } | undefined {
    const row = this.db
      .prepare('SELECT id, period, total_cents FROM budget_periods WHERE period < ? ORDER BY period DESC LIMIT 1')
      .get(period) as { id: number; period: string; total_cents: number } | undefined;
    if (!row) return undefined;
    const categories = this.db
      .prepare(
        `SELECT c.name, c.limit_cents, c.kind, p.name person_name
         FROM budget_categories c LEFT JOIN people p ON p.id = c.person_id
         WHERE c.period_id = ? ORDER BY c.name`
      )
      .all(row.id)
      .map((item: any) => ({ name: item.name, limit: fromCents(item.limit_cents), kind: item.kind, personName: item.person_name ?? null }));
    return { period: row.period, total: fromCents(row.total_cents), categories, fixedExpenses: this.fixedExpensesForPeriod(row.id).map((item) => ({ name: item.name, amount: item.amount, source: item.source })) };
  }

  savePendingConfirmation(input: { groupJid: string; senderJid?: string | null; type: string; payload: unknown; ttlMinutes?: number }): void {
    const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 60) * 60 * 1000).toISOString();
    this.db
      .prepare('INSERT INTO pending_confirmations(group_jid, sender_jid, confirmation_type, payload_json, expires_at) VALUES(?, ?, ?, ?, ?)')
      .run(input.groupJid, input.senderJid ?? null, input.type, JSON.stringify(input.payload), expiresAt);
  }

  consumePendingConfirmation(groupJid: string, senderJid?: string | null): { id: number; type: string; payload: any } | undefined {
    const row = this.db
      .prepare(
        `SELECT id, confirmation_type, payload_json FROM pending_confirmations
         WHERE group_jid = ? AND (sender_jid IS NULL OR sender_jid = ?) AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(groupJid, senderJid ?? null, new Date().toISOString()) as { id: number; confirmation_type: string; payload_json: string } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM pending_confirmations WHERE id = ?').run(row.id);
    return { id: row.id, type: row.confirmation_type, payload: JSON.parse(row.payload_json) };
  }

  createGoal(input: { title: string; horizon: 'short' | 'medium' | 'long'; amount?: number | null; targetDate?: string | null; notes?: string | null; status?: 'active' | 'done' | 'cancelled' | null }): number {
    return Number(
      this.db
        .prepare('INSERT INTO goals(title, horizon, status, target_amount_cents, target_date, notes) VALUES(?, ?, ?, ?, ?, ?)')
        .run(input.title, input.horizon, input.status ?? 'active', input.amount == null ? null : toCents(input.amount), input.targetDate ?? null, input.notes ?? null).lastInsertRowid
    );
  }

  updateGoal(input: { title: string; horizon?: 'short' | 'medium' | 'long' | null; amount?: number | null; targetDate?: string | null; notes?: string | null; status?: 'active' | 'done' | 'cancelled' | null }): boolean {
    const existing = this.findGoalByTitle(input.title);
    if (!existing) return false;
    this.db
      .prepare(
        `UPDATE goals
         SET horizon = COALESCE(?, horizon),
             status = COALESCE(?, status),
             target_amount_cents = COALESCE(?, target_amount_cents),
             target_date = COALESCE(?, target_date),
             notes = COALESCE(?, notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(input.horizon ?? null, input.status ?? null, input.amount == null ? null : toCents(input.amount), input.targetDate ?? null, input.notes ?? null, existing.id);
    return true;
  }

  deleteGoal(title: string): boolean {
    const result = this.db.prepare('UPDATE goals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE lower(title) = lower(?) AND status != ?').run('cancelled', title, 'cancelled');
    return result.changes > 0;
  }

  goals(status: 'active' | 'all' = 'active'): GoalSummary[] {
    const sql =
      status === 'active'
        ? 'SELECT * FROM goals WHERE status = ? ORDER BY horizon, created_at'
        : 'SELECT * FROM goals ORDER BY status, horizon, created_at';
    const rows = status === 'active' ? this.db.prepare(sql).all('active') : this.db.prepare(sql).all();
    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      horizon: row.horizon,
      status: row.status,
      targetAmount: row.target_amount_cents == null ? null : fromCents(row.target_amount_cents),
      targetDate: row.target_date ?? null,
      notes: row.notes ?? null
    }));
  }

  private addExpenseEvent(expenseId: number, eventType: string, payload: unknown): void {
    this.db.prepare('INSERT INTO expense_events(expense_id, event_type, payload_json) VALUES(?, ?, ?)').run(expenseId, eventType, JSON.stringify(payload));
  }

  private ensureBudgetPeriod(period: string, currency: string): { id: number; period: string } {
    const existing = this.db.prepare('SELECT id, period FROM budget_periods WHERE period = ?').get(period) as { id: number; period: string } | undefined;
    if (existing) return existing;
    const id = Number(this.db.prepare('INSERT INTO budget_periods(period, total_cents, currency) VALUES(?, 0, ?)').run(period, currency).lastInsertRowid);
    return { id, period };
  }

  private upsertFixedExpenseByPeriodId(periodId: number, name: string, amount: number, source: 'manual' | 'credit_card'): void {
    this.db
      .prepare(
        `INSERT INTO fixed_expenses(period_id, name, amount_cents, source)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(period_id, name, source) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = CURRENT_TIMESTAMP`
      )
      .run(periodId, name, toCents(amount), source);
  }

  private fixedExpensesForPeriod(periodId: number): FixedExpenseSummary[] {
    return this.db
      .prepare('SELECT id, name, amount_cents, source FROM fixed_expenses WHERE period_id = ? ORDER BY name')
      .all(periodId)
      .map((row: any) => ({ id: row.id, name: row.name, amount: fromCents(row.amount_cents), source: row.source }));
  }

  private incomesForPeriod(periodId: number): IncomeSummary[] {
    return this.db
      .prepare(
        `SELECT i.id, i.amount_cents, c.name category, i.description, i.income_date
         FROM incomes i LEFT JOIN budget_categories c ON c.id = i.category_id
         WHERE i.period_id = ? ORDER BY i.created_at DESC`
      )
      .all(periodId)
      .map((row: any) => ({ id: row.id, amount: fromCents(row.amount_cents), category: row.category ?? null, description: row.description, incomeDate: row.income_date }));
  }

  private adjustmentsForPeriod(periodId: number): AdviceExpense[] {
    return this.db
      .prepare(
        `SELECT public_id, amount_cents, expense_type, description, status, expense_date, created_at
         FROM expenses WHERE period_id = ? AND expense_type = 'adjustment' ORDER BY created_at DESC`
      )
      .all(periodId)
      .map((row: any) => ({
        publicId: row.public_id,
        amount: fromCents(row.amount_cents),
        category: null,
        expenseType: row.expense_type,
        description: row.description,
        status: row.status,
        expenseDate: row.expense_date,
        createdAt: row.created_at
      }));
  }

  private findGoalByTitle(title: string): { id: number } | undefined {
    return this.db.prepare('SELECT id FROM goals WHERE lower(title) = lower(?) AND status != ? ORDER BY created_at DESC LIMIT 1').get(title, 'cancelled') as
      | { id: number }
      | undefined;
  }
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(value: number): number {
  return Math.round(value) / 100;
}
