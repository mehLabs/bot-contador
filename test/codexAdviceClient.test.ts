import { describe, expect, it } from 'vitest';
import { CodexAdviceClient } from '../src/advice/codexAdviceClient.js';

const context = {
  generatedAt: '2026-04-26T00:00:00.000Z',
  currentPeriod: undefined,
  nextPeriod: undefined,
  recentExpenses: [],
  categoryTrends: [],
  goals: [],
  alerts: ['No hay presupuesto configurado para el periodo actual.']
};

describe('CodexAdviceClient', () => {
  it('arma comando seguro con modelo opcional', async () => {
    const client = new CodexAdviceClient(
      { codexBin: 'codex', repoRoot: 'C:/repo', model: 'gpt-test', timeoutMs: 123 },
      async (input) => {
        expect(input.command).toBe('codex');
        expect(input.args).toEqual(['exec', '--skip-git-repo-check', '--ephemeral', '--full-auto', '-s', 'workspace-write', '-C', 'C:/repo', '-m', 'gpt-test', '-']);
        expect(input.stdin).toContain('Pregunta del usuario');
        expect(input.stdin).toContain('Actuá en modo agente');
        return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
      }
    );
    await expect(client.advise('hola', context)).resolves.toBe('ok');
  });

  it('devuelve mensaje claro ante timeout', async () => {
    const client = new CodexAdviceClient({ codexBin: 'codex', repoRoot: 'C:/repo', timeoutMs: 1 }, async () => ({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: true
    }));
    await expect(client.advise('hola', context)).resolves.toContain('tardó demasiado');
  });

  it('devuelve mensaje claro ante falta de login o error', async () => {
    const client = new CodexAdviceClient({ codexBin: 'codex', repoRoot: 'C:/repo', timeoutMs: 1 }, async () => ({
      code: 1,
      stdout: '',
      stderr: 'not logged in',
      timedOut: false
    }));
    await expect(client.advise('hola', context)).resolves.toContain('openai-login');
  });

  it('matchea categorías con contrato JSON estricto', async () => {
    const client = new CodexAdviceClient(
      { codexBin: 'codex', repoRoot: 'C:/repo', timeoutMs: 123 },
      async (input) => {
        expect(input.stdin).toContain('Respondé solo JSON válido');
        expect(input.stdin).toContain('Categoría pedida: super');
        expect(input.stdin).toContain('["Supermercado","Transporte"]');
        return { code: 0, stdout: '{"matchedCategory":"Supermercado","confidence":0.9,"reason":"abreviatura"}', stderr: '', timedOut: false };
      }
    );
    await expect(client.matchCategory({ requestedCategory: 'super', categories: ['Supermercado', 'Transporte'], messageText: 'gasté en super' })).resolves.toEqual({
      matchedCategory: 'Supermercado',
      confidence: 0.9,
      reason: 'abreviatura'
    });
  });

  it('devuelve null si el matcher responde JSON inválido', async () => {
    const client = new CodexAdviceClient({ codexBin: 'codex', repoRoot: 'C:/repo', timeoutMs: 123 }, async () => ({
      code: 0,
      stdout: 'no json',
      stderr: '',
      timedOut: false
    }));
    await expect(client.matchCategory({ requestedCategory: 'super', categories: ['Supermercado'], messageText: 'gasté en super' })).resolves.toMatchObject({
      matchedCategory: null,
      confidence: 0
    });
  });
});
