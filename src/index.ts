import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { select } from '@inquirer/prompts';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';
import { GeminiParser } from './llm/gemini.js';
import { UseCaseEngine } from './bot/useCases.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { TerminalController } from './console/terminal.js';
import { startDailyReminder } from './scheduler/reminder.js';
import { CodexAdviceClient } from './advice/codexAdviceClient.js';
import { BotPipeline } from './bot/pipeline.js';
import { CounterBot } from './bot/counterBot.js';
import { BotInstance } from './bot/types.js';
import { FinancialContextBuilder } from './advice/financialContext.js';

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(config.reportsDir, { recursive: true });
  fs.mkdirSync(config.mediaDir, { recursive: true });

  const db = openDatabase(config.dbPath);
  const repo = new Repository(db, config.currency);
  const parser = new GeminiParser(config.geminiApiKey, config.geminiModel);
  const adviceClient = new CodexAdviceClient({
    codexBin: config.codexBin,
    repoRoot: config.repoRoot,
    model: config.codexAdviceModel,
    timeoutMs: config.codexAdviceTimeoutMs
  });
  const engine = new UseCaseEngine(repo, { currency: config.currency, reportsDir: config.reportsDir }, adviceClient);
  const whatsapp = new WhatsAppClient({ authDir: config.authDir, mediaDir: config.mediaDir });
  const pipeline = new BotPipeline({
    sendText: (jid, text) => whatsapp.sendText(jid, text),
    sendDocument: (jid, filePath, caption) => whatsapp.sendDocument(jid, filePath, caption),
    whileComposing: (jid, task) => whatsapp.whileComposing(jid, task),
    markRead: (message) => whatsapp.markRead(message)
  });

  const chooseGroup = async (): Promise<{ jid: string; subject: string } | undefined> => {
    const groups = await whatsapp.groups();
    if (groups.length === 0) {
      console.log('No encontré grupos. Verificá que WhatsApp esté conectado.');
      return undefined;
    }
    const jid = await select({
      message: 'Elegí el grupo para el bot contador',
      choices: groups.map((group) => ({
        name: `${group.subject} (${group.participants})`,
        value: group.jid,
        description: group.jid
      }))
    });
    const selectedGroup = groups.find((group) => group.jid === jid);
    return selectedGroup ? { jid: selectedGroup.jid, subject: selectedGroup.subject } : undefined;
  };
  const counterBot = new CounterBot(repo, parser, engine, chooseGroup, adviceClient);
  counterBot.restoreGroup();
  counterBot.terminalActions = [
    {
      id: 'choose-group',
      label: 'Elegir grupo',
      run: () => counterBot.selectGroup()
    },
    {
      id: 'export',
      label: 'Exportar reporte',
      run: async () => {
        const reply = await counterBot.availability(true);
        console.log(reply.attachmentPath ? `Reporte generado: ${reply.attachmentPath}` : 'No hay presupuesto activo para exportar.');
      }
    },
    {
      id: 'recent',
      label: 'Ver gastos recientes',
      run: async () => {
        const recent = repo.recentExpenses();
        if (recent.length === 0) {
          console.log('Sin gastos registrados.');
          return;
        }
        for (const item of recent) {
          console.log(`${item.publicId} | ${item.amount} | ${item.category} | ${item.description} | ${item.status}`);
        }
      }
    },
    {
      id: 'openai-login',
      label: 'OpenAI/Codex login',
      run: () => runInteractiveCodex(config.codexBin, config.repoRoot, ['login'])
    },
    {
      id: 'openai-status',
      label: 'OpenAI/Codex status',
      run: () => runInteractiveCodex(config.codexBin, config.repoRoot, ['login', 'status'])
    },
    {
      id: 'openai-test',
      label: 'Probar OpenAI/Codex financiero',
      run: async () => {
        const context = new FinancialContextBuilder(repo).build();
        const answer = await adviceClient.advise('Respondé en una línea si podés leer este contexto financiero.', context);
        console.log(answer);
      }
    }
  ];
  const availableBots: BotInstance[] = [counterBot];

  whatsapp.setMessageHandler((message) => pipeline.handle(message));

  const terminal = new TerminalController(
    whatsapp,
    repo,
    pipeline,
    availableBots,
    async () => {
      await whatsapp.disconnect();
      db.close();
      process.exit(0);
    }
  );

  if (!parser.isConfigured()) {
    console.warn('Aviso: GEMINI_API_KEY no está configurada. El bot conectará, pero no podrá interpretar mensajes.');
  }

  await whatsapp.connect();
  await whatsapp.waitUntilConnected();
  startDailyReminder({
    timezone: config.timezone,
    sender: whatsapp,
    counterBot,
    isCounterBotActive: () => pipeline.isActive(counterBot.id)
  });
  await terminal.start();
}

function runInteractiveCodex(codexBin: string, repoRoot: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(codexBin, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: false
    });
    child.on('error', (error) => {
      console.log(`No pude ejecutar ${codexBin}: ${error.message}`);
      console.log('Si Codex está instalado pero no aparece en PATH, configurá CODEX_BIN con la ruta completa a codex.exe en .env.');
      resolve();
    });
    child.on('close', () => resolve());
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
