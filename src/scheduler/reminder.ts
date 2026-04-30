import cron from 'node-cron';
import { CounterBot } from '../bot/counterBot.js';

export function startDailyReminder(input: {
  timezone: string;
  sender: { sendText: (jid: string, text: string) => Promise<void> };
  counterBot: CounterBot;
  isCounterBotActive: () => boolean;
}): void {
  cron.schedule(
    '0 22 * * *',
    async () => {
      if (!input.isCounterBotActive()) return;
      const groupJid = input.counterBot.getGroup();
      if (!groupJid) return;
      await input.sender.sendText(groupJid, input.counterBot.reminderText());
    },
    { timezone: input.timezone }
  );

  cron.schedule(
    '0 9 1 * *',
    async () => {
      if (!input.isCounterBotActive()) return;
      const groupJid = input.counterBot.getGroup();
      if (!groupJid) return;
      await input.sender.sendText(groupJid, await input.counterBot.monthlyAnalysisText());
    },
    { timezone: input.timezone }
  );
}
