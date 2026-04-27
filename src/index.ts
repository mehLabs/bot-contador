import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';
import { GeminiParser } from './llm/gemini.js';
import { UseCaseEngine } from './bot/useCases.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { TerminalController } from './console/terminal.js';
import { startDailyReminder } from './scheduler/reminder.js';
import { CodexAdviceClient } from './advice/codexAdviceClient.js';

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

  const savedGroup = repo.getSetting('selected_group_jid');
  if (savedGroup) whatsapp.setSelectedGroup(savedGroup);

  whatsapp.setMessageHandler(async (message) => {
    repo.upsertContact(message.senderJid, message.senderName);
    try {
      const parsed = await parser.parse({
        text: message.text,
        senderName: message.senderName,
        senderJid: message.senderJid,
        image: message.image ? { buffer: message.image.buffer, mimeType: message.image.mimeType } : undefined
      });
      repo.saveLlmCall({ messageId: message.id, intent: parsed.intent, confidence: parsed.confidence, rawJson: JSON.stringify(parsed) });
      const reply = await engine.handle(message, parsed);
      if (!reply) return;
      await whatsapp.sendText(reply.text);
      if (reply.attachmentPath) await whatsapp.sendDocument(reply.attachmentPath, 'Reporte de disponibilidad');
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      repo.saveLlmCall({ messageId: message.id, error: messageText });
      await whatsapp.sendText(`No pude procesar ese mensaje: ${messageText}`);
    }
  });

  const terminal = new TerminalController(
    whatsapp,
    repo,
    async () => {
      await whatsapp.disconnect();
      db.close();
      process.exit(0);
    },
    async () => (await engine.availability(true)).attachmentPath,
    { codexBin: config.codexBin, repoRoot: config.repoRoot },
    adviceClient
  );

  whatsapp.onConnected(async () => {
    if (!whatsapp.getSelectedGroup()) {
      await terminal.chooseGroup();
    } else {
      console.log(`Grupo restaurado: ${whatsapp.getSelectedGroup()}`);
    }
  });

  if (!parser.isConfigured()) {
    console.warn('Aviso: GEMINI_API_KEY no está configurada. El bot conectará, pero no podrá interpretar mensajes.');
  }

  startDailyReminder({ timezone: config.timezone, whatsapp, engine });
  await whatsapp.connect();
  await terminal.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
