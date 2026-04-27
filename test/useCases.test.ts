import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schemaSql } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { UseCaseEngine } from '../src/bot/useCases.js';
import { CodexAdviceClient } from '../src/advice/codexAdviceClient.js';
import { FinancialContextBuilder } from '../src/advice/financialContext.js';
import { IncomingMessage, ParsedMessage } from '../src/types.js';

function setup() {
  const db = new Database(':memory:');
  db.exec(schemaSql);
  const repo = new Repository(db, 'ARS');
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-contador-'));
  const engine = new UseCaseEngine(repo, { currency: 'ARS', reportsDir });
  return { db, repo, engine, reportsDir };
}

const baseMessage: IncomingMessage = {
  id: 'm1',
  groupJid: '123@g.us',
  senderJid: '549111@s.whatsapp.net',
  senderName: 'Juan',
  text: 'gasté 50000 en comida',
  timestamp: new Date('2026-04-26T12:00:00Z')
};

function parsed(input: Partial<ParsedMessage> & Pick<ParsedMessage, 'intent'>): ParsedMessage {
  return {
    confidence: 1,
    amount: null,
    category: null,
    description: null,
    personName: null,
    date: null,
    expenseRef: null,
    correction: null,
    creditCard: null,
    income: null,
    goal: null,
    budget: null,
    missingFields: [],
    needsConfirmation: false,
    naturalReplyHint: null,
    ...input
  };
}

describe('UseCaseEngine', () => {
  it('devuelve ayuda determinística sin cliente externo', async () => {
    const { engine } = setup();
    const reply = await engine.handle(baseMessage, parsed({
      intent: 'help',
    }));
    expect(reply?.text).toContain('Registrar gasto');
    expect(reply?.text).toContain('Pedir consejos financieros');
  });

  it('registra un gasto y calcula excedente de categoría', async () => {
    const { repo, engine } = setup();
    repo.upsertBudget('2026-04', 150000, [{ name: 'Comida', limit: 20000, kind: 'shared' }]);
    const expenseParsed: ParsedMessage = parsed({
      intent: 'register_expense',
      confidence: 0.9,
      amount: 50000,
      category: 'Comida',
      description: 'supermercado',
      personName: null,
      date: '2026-04-26',
    });
    const reply = await engine.handle(baseMessage, expenseParsed);
    expect(reply?.text).toContain('Registré');
    expect(reply?.text).toContain('excedido por');
    expect(repo.budgetSummary(new Date('2026-04-26'))?.remaining).toBe(100000);
  });

  it('pide datos faltantes antes de guardar', async () => {
    const { repo, engine } = setup();
    repo.upsertBudget('2026-04', 150000, [{ name: 'Comida', limit: 20000, kind: 'shared' }]);
    const reply = await engine.handle(baseMessage, parsed({
      intent: 'register_expense',
      confidence: 0.9,
      amount: null,
      category: 'Comida',
      description: null,
      personName: null,
      date: null,
      missingFields: ['amount'],
    }));
    expect(reply?.text).toContain('Necesito');
    expect(repo.recentExpenses()).toHaveLength(0);
  });

  it('genera reporte excel de disponibilidad', async () => {
    const { repo, engine } = setup();
    repo.upsertBudget('2026-04', 100000, [{ name: 'Transporte', limit: 30000, kind: 'shared' }]);
    const reply = await engine.availability(true);
    expect(reply.attachmentPath).toBeTruthy();
    expect(fs.existsSync(reply.attachmentPath!)).toBe(true);
  });

  it('arma contexto financiero seguro con alertas', () => {
    const { repo } = setup();
    repo.upsertBudget('2026-04', 100000, [{ name: 'Comida', limit: 20000, kind: 'shared' }]);
    repo.createExpense({
      amount: 25000,
      category: 'Comida',
      description: 'super',
      personId: repo.personForSender(baseMessage.senderJid, baseMessage.senderName),
      senderJid: baseMessage.senderJid,
      groupJid: baseMessage.groupJid,
      messageId: baseMessage.id,
      date: '2026-04-26'
    });
    const context = new FinancialContextBuilder(repo).build();
    expect(context.currentPeriod?.remaining).toBe(75000);
    expect(context.alerts.join(' ')).toContain('Comida');
    expect(JSON.stringify(context)).not.toContain('auth');
  });

  it('puede responder consejos usando CodexAdviceClient mockeado', async () => {
    const { repo } = setup();
    repo.upsertBudget('2026-04', 100000, [{ name: 'Comida', limit: 20000, kind: 'shared' }]);
    const client = new CodexAdviceClient(
      { codexBin: 'codex', repoRoot: process.cwd(), timeoutMs: 1000 },
      async ({ args, stdin }) => {
        expect(args).toContain('exec');
        expect(args).toContain('workspace-write');
        expect(stdin).toContain('Contexto financiero JSON');
        return { code: 0, stdout: 'Consejo breve.', stderr: '', timedOut: false };
      }
    );
    const engine = new UseCaseEngine(repo, { currency: 'ARS', reportsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bot-contador-')) }, client);
    const reply = await engine.handle({ ...baseMessage, text: 'dame consejos' }, parsed({
      intent: 'financial_advice',
      confidence: 0.9,
    }));
    expect(reply?.text).toBe('Consejo breve.');
  });

  it('registra ingreso sin categoría en Sin asignar y aumenta presupuesto', async () => {
    const { repo, engine } = setup();
    repo.upsertBudget('2026-04', 100000, [{ name: 'Comida', limit: 20000, kind: 'shared' }]);
    const reply = await engine.handle({ ...baseMessage, text: 'cobré 30000' }, parsed({
      intent: 'register_income',
      confidence: 0.9,
      amount: 30000,
      income: { amount: 30000, description: 'extra', category: null }
    }));
    const summary = repo.budgetSummary(new Date('2026-04-26'));
    expect(reply?.actionTaken).toBe(true);
    expect(summary?.total).toBe(130000);
    expect(summary?.categories.find((item) => item.name === 'Sin asignar')?.limit).toBe(30000);
  });

  it('ajusta el disponible mensual con gasto desconocido', async () => {
    const { repo, engine } = setup();
    repo.upsertBudget('2026-04', 100000, [{ name: 'Comida', limit: 20000, kind: 'shared' }]);
    const reply = await engine.handle({ ...baseMessage, text: 'me quedan 70000 pesos' }, parsed({
      intent: 'adjust_remaining',
      confidence: 0.9,
      amount: 70000
    }));
    const summary = repo.budgetSummary(new Date('2026-04-26'));
    expect(reply?.actionTaken).toBe(true);
    expect(summary?.remaining).toBe(70000);
    expect(summary?.adjustments[0]?.amount).toBe(30000);
  });

  it('pide confirmación si el presupuesto excede y luego crea meta corta', async () => {
    const { repo, engine } = setup();
    const budget = {
      total: 50000,
      period: null,
      categories: [{ name: 'Comida', limit: 40000, kind: 'shared' as const, personName: null }],
      fixedExpenses: [{ name: 'Alquiler', amount: 30000, source: 'manual' as const }]
    };
    const first = await engine.handle(baseMessage, parsed({ intent: 'setup_budget', confidence: 0.9, budget }));
    expect(first?.actionTaken).toBeFalsy();
    expect(first?.text).toContain('excedido');
    const confirmed = await engine.handle({ ...baseMessage, text: 'confirmo' }, parsed({ intent: 'confirm', confidence: 1 }));
    expect(confirmed?.actionTaken).toBe(true);
    expect(repo.budgetSummary(new Date('2026-04-26'))?.fixedExpenses[0]?.name).toBe('Alquiler');
    expect(repo.goals('active')[0]?.horizon).toBe('short');
  });

  it('agrupa gastos con tarjeta como gasto fijo del mes siguiente', async () => {
    const { repo, engine } = setup();
    repo.upsertBudget('2026-04', 100000, [{ name: 'Comida', limit: 20000, kind: 'shared' }]);
    await engine.handle(baseMessage, parsed({ intent: 'register_credit_card_expense', confidence: 0.9, amount: 10000, creditCard: { name: 'Visa' } }));
    await engine.handle({ ...baseMessage, id: 'm2' }, parsed({ intent: 'register_credit_card_expense', confidence: 0.9, amount: 15000, creditCard: { name: 'Visa' } }));
    const summary = repo.budgetSummary(new Date('2026-05-02'));
    expect(summary?.fixedExpenses[0]?.name).toBe('Tarjeta Visa');
    expect(summary?.fixedExpenses[0]?.amount).toBe(25000);
  });
});
