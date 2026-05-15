import { BotInstance, BotContext } from './types.js';
import { IncomingMessage } from '../types.js';

export class BotPipeline {
  private activeBots: BotInstance[] = [];

  constructor(private readonly ctx: BotContext) {}

  setActiveBots(bots: BotInstance[]): void {
    this.activeBots = [...bots];
  }

  getActiveBots(): BotInstance[] {
    return [...this.activeBots];
  }

  isActive(botId: string): boolean {
    return this.activeBots.some((bot) => bot.id === botId);
  }

  async activate(bot: BotInstance): Promise<void> {
    if (this.isActive(bot.id)) return;
    const configured = await bot.configure?.();
    if (configured === false) return;
    this.activeBots = [...this.activeBots, bot];
  }

  deactivate(botId: string): void {
    this.activeBots = this.activeBots.filter((bot) => bot.id !== botId);
  }

  async handle(message: IncomingMessage): Promise<void> {
    for (const bot of this.activeBots) {
      try {
        const result = await this.ctx.whileComposing(message.groupJid, () => bot.handle(message, this.ctx));
        if (!result.handled) continue;
        if (result.reply) {
          await this.ctx.sendText(message.groupJid, result.reply.text);
          if (result.reply.attachmentPath) {
            await this.ctx.sendDocument(message.groupJid, result.reply.attachmentPath, 'Reporte de disponibilidad');
          }
        }
        if (result.markRead) await this.ctx.markRead(message);
        if (result.stopPipeline) return;
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error(`[${bot.id}] No pude procesar el mensaje ${message.id}: ${messageText}`);
      }
    }
  }
}
