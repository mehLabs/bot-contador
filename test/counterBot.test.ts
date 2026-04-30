import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexAdviceClient } from '../src/advice/codexAdviceClient.js';
import { CounterBot } from '../src/bot/counterBot.js';
import { BotContext } from '../src/bot/types.js';
import { UseCaseEngine } from '../src/bot/useCases.js';
import { schemaSql } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { GeminiParser } from '../src/llm/gemini.js';
import { IncomingMessage, ParsedMessage } from '../src/types.js';

const baseMessage: IncomingMessage = {
  id: 'm1',
  groupJid: '123@g.us',
  senderJid: '549111@s.whatsapp.net',
  senderName: 'Juan',
  text: 'cuánto queda',
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

function setup(parseResult: ParsedMessage, adviceClient?: CodexAdviceClient) {
  const db = new Database(':memory:');
  db.exec(schemaSql);
  const repo = new Repository(db, 'ARS');
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-contador-'));
  const engine = new UseCaseEngine(repo, { currency: 'ARS', reportsDir }, adviceClient);
  const parser = {
    parse: async () => parseResult,
    isConfigured: () => true
  } as unknown as GeminiParser;
  const counterBot = new CounterBot(repo, parser, engine, async () => ({ jid: '123@g.us', subject: 'Casa' }), adviceClient);
  counterBot.setGroup('123@g.us', 'Casa');
  return { db, repo, counterBot };
}

function ctx() {
  let composingJid: string | undefined;
  const context: BotContext = {
    sendText: async () => undefined,
    sendDocument: async () => undefined,
    whileComposing: async (jid, task) => {
      composingJid = jid;
      return task();
    },
    markRead: async () => undefined
  };
  return { context, composingJid: () => composingJid };
}

describe('CounterBot', () => {
  it('solo procesa mensajes del grupo configurado', async () => {
    const { counterBot } = setup(parsed({ intent: 'help' }));
    const { context } = ctx();

    const result = await counterBot.handle({ ...baseMessage, groupJid: '999@g.us' }, context);

    expect(result).toEqual({ handled: false });
  });

  it('mantiene parseo, auditoría LLM, respuesta y adjunto del contador', async () => {
    const { db, repo, counterBot } = setup(parsed({ intent: 'availability' }));
    repo.upsertBudget('2026-04', 100000, [{ name: 'Comida', limit: 30000, kind: 'shared' }]);
    const { context } = ctx();

    const result = await counterBot.handle(baseMessage, context);
    const llmCalls = db.prepare('SELECT intent, confidence, error FROM llm_calls').all() as Array<{ intent: string; confidence: number; error: string | null }>;

    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply?.text).toContain('Disponibilidad de 2026-04');
    expect(result.reply?.attachmentPath).toBeTruthy();
    expect(fs.existsSync(result.reply!.attachmentPath!)).toBe(true);
    expect(result.markRead).toBe(true);
    expect(result.stopPipeline).toBe(true);
    expect(llmCalls).toEqual([{ intent: 'availability', confidence: 1, error: null }]);
  });

  it('usa whileComposing para consejos financieros y preguntas al bot', async () => {
    const client = new CodexAdviceClient(
      { codexBin: 'codex', repoRoot: process.cwd(), timeoutMs: 1000 },
      async () => ({ code: 0, stdout: 'Consejo breve.', stderr: '', timedOut: false })
    );
    const { repo, counterBot } = setup(parsed({ intent: 'financial_advice' }), client);
    repo.upsertBudget('2026-04', 100000, [{ name: 'Comida', limit: 30000, kind: 'shared' }]);
    const testCtx = ctx();

    const result = await counterBot.handle({ ...baseMessage, text: 'dame consejos' }, testCtx.context);

    expect(testCtx.composingJid()).toBe('123@g.us');
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply?.text).toBe('Consejo breve.');
  });
});
