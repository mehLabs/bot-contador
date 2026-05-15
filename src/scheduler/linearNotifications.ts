import cron from 'node-cron';
import { LinearNotificationBot } from '../bot/linearNotificationBot.js';

type CronScheduler = Pick<typeof cron, 'schedule'>;

export function startLinearNotifications(
  input: {
    timezone: string;
    sender: {
      sendText: (jid: string, text: string) => Promise<void>;
      whileComposing?: <T>(jid: string, task: () => Promise<T>) => Promise<T>;
    };
    linearBot: LinearNotificationBot;
    isLinearBotActive: () => boolean;
  },
  scheduler: CronScheduler = cron
): void {
  scheduler.schedule(
    '0 9 * * 1-5',
    async () => {
      if (!input.isLinearBotActive()) return;
      const groupJid = input.linearBot.getGroup();
      if (!groupJid) return;
      try {
        const text = await whileComposing(input.sender, groupJid, () => input.linearBot.dailyMessage());
        await input.sender.sendText(groupJid, text);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error(`[${input.linearBot.id}] No pude obtener issues de Linear: ${messageText}`);
        await input.sender.sendText(groupJid, 'No pude obtener los issues de Linear hoy.');
      }
    },
    { timezone: input.timezone }
  );
}

function whileComposing<T>(
  sender: { whileComposing?: <Result>(jid: string, task: () => Promise<Result>) => Promise<Result> },
  jid: string,
  task: () => Promise<T>
): Promise<T> {
  return sender.whileComposing ? sender.whileComposing(jid, task) : task();
}
