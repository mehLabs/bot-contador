import 'dotenv/config';
import path from 'node:path';
import { resolveCodexBin } from './utils/resolveCodexBin.js';

export type AppConfig = {
  geminiApiKey?: string;
  geminiModel: string;
  timezone: string;
  currency: string;
  dbPath: string;
  authDir: string;
  reportsDir: string;
  mediaDir: string;
  codexBin: string;
  codexAdviceModel?: string;
  codexAdviceTimeoutMs: number;
  repoRoot: string;
};

export function loadConfig(): AppConfig {
  return {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    timezone: process.env.BOT_TIMEZONE ?? 'America/Argentina/Buenos_Aires',
    currency: process.env.BOT_CURRENCY ?? 'ARS',
    dbPath: path.resolve(process.env.DB_PATH ?? 'data/bot-contador.sqlite'),
    authDir: path.resolve(process.env.AUTH_DIR ?? 'data/auth'),
    reportsDir: path.resolve(process.env.REPORTS_DIR ?? 'data/reports'),
    mediaDir: path.resolve(process.env.MEDIA_DIR ?? 'data/media'),
    codexBin: resolveCodexBin(process.env.CODEX_BIN ?? 'codex'),
    codexAdviceModel: process.env.CODEX_ADVICE_MODEL || undefined,
    codexAdviceTimeoutMs: Number(process.env.CODEX_ADVICE_TIMEOUT_MS ?? 90000),
    repoRoot: path.resolve(process.cwd())
  };
}
