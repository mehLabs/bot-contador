import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FinancialAdviceContext } from './financialContext.js';

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
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', this.options.repoRoot];
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
      '- No pidas SQL ni intentes modificar archivos o base de datos.',
      '',
      `Pregunta del usuario:\n${question}`,
      '',
      `Contexto financiero JSON:\n${JSON.stringify(context, null, 2)}`
    ]
      .filter(Boolean)
      .join('\n\n');
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
