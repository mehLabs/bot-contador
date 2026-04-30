import { CodexAdviceClient } from '../advice/codexAdviceClient.js';
import { Repository } from '../db/repository.js';
import { GeminiParser } from '../llm/gemini.js';
import { IncomingMessage } from '../types.js';
import { agentParsedMessage, shouldRouteToAgent } from './agentRouting.js';
import { BotContext, BotHandleResult, BotInstance, BotTerminalAction } from './types.js';
import { UseCaseEngine } from './useCases.js';

const COUNTER_GROUP_SETTING = 'counter.selected_group_jid';
const COUNTER_GROUP_SUBJECT_SETTING = 'counter.selected_group_subject';

export class CounterBot implements BotInstance {
  readonly id = 'counter';
  readonly name = 'Bot contador';
  readonly description = 'Registra gastos, presupuesto, ingresos, metas y disponibilidad.';
  terminalActions: BotTerminalAction[] = [];

  constructor(
    private readonly repo: Repository,
    private readonly parser: GeminiParser,
    private readonly engine: UseCaseEngine,
    private readonly chooseGroup: () => Promise<{ jid: string; subject: string } | undefined>,
    private readonly adviceClient?: CodexAdviceClient
  ) {}

  restoreGroup(): void {
    const legacyGroup = this.repo.getSetting('selected_group_jid');
    const group = this.repo.getSetting(COUNTER_GROUP_SETTING) ?? legacyGroup;
    if (group) this.setGroup(group, this.repo.getSetting(COUNTER_GROUP_SUBJECT_SETTING));
  }

  async configure(): Promise<void> {
    if (this.getGroup()) return;
    await this.selectGroup();
  }

  async selectGroup(): Promise<void> {
    const selected = await this.chooseGroup();
    if (!selected) return;
    this.setGroup(selected.jid, selected.subject);
    console.log(`Bot contador escuchando: ${selected.subject}`);
  }

  setGroup(jid: string, subject?: string): void {
    this.repo.setSetting(COUNTER_GROUP_SETTING, jid);
    if (subject) this.repo.setSetting(COUNTER_GROUP_SUBJECT_SETTING, subject);
  }

  getGroup(): string | undefined {
    return this.repo.getSetting(COUNTER_GROUP_SETTING);
  }

  getGroupSubject(): string | undefined {
    return this.repo.getSetting(COUNTER_GROUP_SUBJECT_SETTING);
  }

  status(): string {
    const subject = this.getGroupSubject();
    const jid = this.getGroup();
    if (!jid) return 'sin grupo configurado';
    return subject ? `${subject} (${jid})` : jid;
  }

  reminderText(): string {
    return this.engine.reminderText();
  }

  monthlyAnalysisText(): Promise<string> {
    return this.engine.monthlyAnalysisText();
  }

  availability(withAttachment: boolean): Promise<{ attachmentPath?: string }> {
    return this.engine.availability(withAttachment);
  }

  async handle(message: IncomingMessage, ctx: BotContext): Promise<BotHandleResult> {
    const selectedGroup = this.getGroup();
    if (!selectedGroup || message.groupJid !== selectedGroup) return { handled: false };

    this.repo.upsertContact(message.senderJid, message.senderName);
    try {
      const parsed = shouldRouteToAgent(message.text)
        ? agentParsedMessage()
        : await this.parser.parse({
            text: message.text,
            senderName: message.senderName,
            senderJid: message.senderJid,
            image: message.image ? { buffer: message.image.buffer, mimeType: message.image.mimeType } : undefined
          });
      this.repo.saveLlmCall({ messageId: message.id, intent: parsed.intent, confidence: parsed.confidence, rawJson: JSON.stringify(parsed) });
      const usesCodexAgent = parsed.intent === 'financial_advice' || parsed.intent === 'bot_question';
      const reply = usesCodexAgent
        ? await ctx.whileComposing(message.groupJid, () => this.engine.handle(message, parsed))
        : await this.engine.handle(message, parsed);
      if (!reply) return { handled: true, stopPipeline: false };
      return { handled: true, reply, markRead: Boolean(reply.actionTaken), stopPipeline: true };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.repo.saveLlmCall({ messageId: message.id, error: messageText });
      return {
        handled: true,
        reply: { text: `No pude procesar ese mensaje: ${messageText}` },
        stopPipeline: true
      };
    }
  }
}
