import { Repository } from '../db/repository.js';
import { IncomingMessage } from '../types.js';
import { BotContext, BotHandleResult, BotInstance, BotTerminalAction } from './types.js';
import { formatLinearDailyMessage, LinearNotificationService } from '../linear/notifications.js';

const LINEAR_GROUP_SETTING = 'linear.selected_group_jid';
const LINEAR_GROUP_SUBJECT_SETTING = 'linear.selected_group_subject';

export class LinearNotificationBot implements BotInstance {
  readonly id = 'linear-notifications';
  readonly name = 'Bot Linear';
  readonly description = 'Envia un resumen diario de issues pendientes de Linear.';
  terminalActions: BotTerminalAction[] = [];

  constructor(
    private readonly repo: Repository,
    private readonly service: LinearNotificationService | undefined,
    private readonly chooseGroup: () => Promise<{ jid: string; subject: string } | undefined>
  ) {}

  restoreGroup(): void {
    const group = this.repo.getSetting(LINEAR_GROUP_SETTING);
    if (group) this.setGroup(group, this.repo.getSetting(LINEAR_GROUP_SUBJECT_SETTING));
  }

  async configure(): Promise<void | false> {
    if (!this.service) {
      console.log('Bot Linear sin configurar: agregá LINEAR_API_KEY en .env.');
      return false;
    }
    if (this.getGroup()) return;
    await this.selectGroup();
    return this.getGroup() ? undefined : false;
  }

  async selectGroup(): Promise<void> {
    const selected = await this.chooseGroup();
    if (!selected) return;
    this.setGroup(selected.jid, selected.subject);
    console.log(`Bot Linear notificando en: ${selected.subject}`);
  }

  setGroup(jid: string, subject?: string): void {
    this.repo.setSetting(LINEAR_GROUP_SETTING, jid);
    if (subject) this.repo.setSetting(LINEAR_GROUP_SUBJECT_SETTING, subject);
  }

  getGroup(): string | undefined {
    return this.repo.getSetting(LINEAR_GROUP_SETTING);
  }

  getGroupSubject(): string | undefined {
    return this.repo.getSetting(LINEAR_GROUP_SUBJECT_SETTING);
  }

  status(): string {
    if (!this.service) return 'sin LINEAR_API_KEY';
    const subject = this.getGroupSubject();
    const jid = this.getGroup();
    if (!jid) return 'sin grupo configurado';
    return subject ? `${subject} (${jid})` : jid;
  }

  async dailyMessage(): Promise<string> {
    if (!this.service) throw new Error('LINEAR_API_KEY no está configurada.');
    return formatLinearDailyMessage(await this.service.pendingSnapshot());
  }

  async handle(_message: IncomingMessage, _ctx: BotContext): Promise<BotHandleResult> {
    return { handled: false };
  }
}

