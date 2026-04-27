import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FinancialAdviceContext } from './financialContext.js';

export type CategoryMatchResult = {
  matchedCategory: string | null;
  confidence: number;
  reason: string;
};

export type CodexAdviceOptions = {
  codexBin: string;
  repoRoot: string;
  model?: string;
  timeoutMs: number;
  systemBriefPath?: string;
};

export type ProcessRunner = (input: {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
}) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

export class CodexAdviceClient {
  constructor(
    private readonly options: CodexAdviceOptions,
    private readonly runner: ProcessRunner = runProcess
  ) {}

  async advise(question: string, context: FinancialAdviceContext): Promise<string> {
    const prompt = this.buildPrompt(question, context);
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--full-auto', '-s', 'workspace-write', '-C', this.options.repoRoot];
    if (this.options.model) args.push('-m', this.options.model);
    args.push('-');

    const result = await this.runner({
      command: this.options.codexBin,
      args,
      cwd: this.options.repoRoot,
      stdin: prompt,
      timeoutMs: this.options.timeoutMs
    });

    if (result.timedOut) {
      return 'No pude obtener consejos financieros porque Codex tardó demasiado. Probá de nuevo o revisá el comando openai-status en la consola.';
    }
    if (result.code !== 0) {
      return `No pude consultar Codex. Revisá la sesión con el comando de consola openai-status o iniciá sesión con openai-login. Detalle: ${compactError(result.stderr || result.stdout)}`;
    }
    const answer = result.stdout.trim();
    return answer || 'Codex respondió sin contenido. Probá reformular la consulta.';
  }

  async matchCategory(input: { requestedCategory: string; categories: string[]; messageText: string }): Promise<CategoryMatchResult> {
    const prompt = this.buildCategoryMatchPrompt(input);
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--full-auto', '-s', 'workspace-write', '-C', this.options.repoRoot];
    if (this.options.model) args.push('-m', this.options.model);
    args.push('-');

    const result = await this.runner({
      command: this.options.codexBin,
      args,
      cwd: this.options.repoRoot,
      stdin: prompt,
      timeoutMs: this.options.timeoutMs
    });

    if (result.timedOut || result.code !== 0) return noCategoryMatch('No se pudo consultar el agente.');
    const parsed = parseCategoryMatch(result.stdout);
    if (!parsed) return noCategoryMatch('El agente no devolvió JSON válido.');
    const existing = input.categories.find((category) => category.toLowerCase() === parsed.matchedCategory?.toLowerCase());
    if (!existing) return { matchedCategory: null, confidence: parsed.confidence, reason: parsed.reason || 'La categoría sugerida no existe.' };
    return { matchedCategory: existing, confidence: parsed.confidence, reason: parsed.reason };
  }

  buildPrompt(question: string, context: FinancialAdviceContext): string {
    const systemBrief = this.readSystemBrief();
    return [
      systemBrief ? `Documento del sistema:\n${systemBrief}` : '',
      'Rol: sos un asistente de análisis financiero doméstico para un presupuesto compartido.',
      'Reglas:',
      '- Respondé en español rioplatense, breve y accionable.',
      '- No inventes datos. Si falta información, decilo.',
      '- No des asesoramiento profesional de inversión, legal ni fiscal.',
      '- Separá hechos calculados de sugerencias.',
      '- Actuá en modo agente: pensá el plan antes de responder, ejecutá comandos cuando hagan falta y esperá sus resultados antes de concluir.',
      '- Usá las herramientas de terminal disponibles en el workspace para inspeccionar datos, generar reportes o verificar cálculos si la solicitud lo requiere.',
      '- Actuá en nombre de la persona que hizo la solicitud, respetando el alcance del presupuesto compartido.',
      '- No hagas cambios destructivos ni irreversibles salvo que la solicitud lo pida de forma explícita.',
      '- No pidas SQL al usuario; si necesitás revisar datos, usá las herramientas locales disponibles y explicá qué hiciste.',
      '- Los gastos con tarjeta de crédito cargados este mes cuentan como gastos fijos del periodo siguiente; revisá nextPeriod antes de decir que no existen.',
      '',
      `Pregunta del usuario:\n${question}`,
      '',
      `Contexto financiero JSON:\n${JSON.stringify(context, null, 2)}`
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  buildCategoryMatchPrompt(input: { requestedCategory: string; categories: string[]; messageText: string }): string {
    return [
      'Sos un matcher estricto de categorías de presupuesto.',
      'Respondé solo JSON válido con esta forma exacta: {"matchedCategory": string|null, "confidence": number, "reason": string}.',
      'matchedCategory debe ser null o una de las categorías existentes, copiando el nombre exacto.',
      'Usá null si no hay una coincidencia clara o si la categoría pedida parece una categoría nueva.',
      'No inventes categorías.',
      `Categoría pedida: ${input.requestedCategory}`,
      `Mensaje original: ${input.messageText || '(sin texto)'}`,
      `Categorías existentes JSON: ${JSON.stringify(input.categories)}`
    ].join('\n');
  }

  private readSystemBrief(): string | undefined {
    const briefPath = this.options.systemBriefPath ?? path.join(this.options.repoRoot, 'docs', 'openai-system-brief.md');
    if (!fs.existsSync(briefPath)) return undefined;
    return fs.readFileSync(briefPath, 'utf8');
  }
}

export function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
}): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(input.stdin);
  });
}

function compactError(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500) || 'sin detalle';
}

function parseCategoryMatch(value: string): CategoryMatchResult | undefined {
  try {
    const parsed = JSON.parse(extractJsonObject(value));
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    return {
      matchedCategory: typeof parsed.matchedCategory === 'string' && parsed.matchedCategory.trim() ? parsed.matchedCategory.trim() : null,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
    };
  } catch {
    return undefined;
  }
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

function noCategoryMatch(reason: string): CategoryMatchResult {
  return { matchedCategory: null, confidence: 0, reason };
}
