import cron from 'node-cron';
import { CounterBot } from '../bot/counterBot.js';

export function startDailyReminder(input: {
  timezone: string;
  sender: {
    sendText: (jid: string, text: string) => Promise<void>;
    whileComposing?: <T>(jid: string, task: () => Promise<T>) => Promise<T>;
  };
  counterBot: CounterBot;
  isCounterBotActive: () => boolean;
}): void {
  cron.schedule(
    '0 22 * * *',
    async () => {
      if (!input.isCounterBotActive()) return;
      const groupJid = input.counterBot.getGroup();
      if (!groupJid) return;
      const text = await whileComposing(input.sender, groupJid, async () => input.counterBot.reminderText());
      await input.sender.sendText(groupJid, text);
    },
    { timezone: input.timezone }
  );

  cron.schedule(
    '0 9 1 * *',
    async () => {
      if (!input.isCounterBotActive()) return;
      const groupJid = input.counterBot.getGroup();
      if (!groupJid) return;
      const text = await whileComposing(input.sender, groupJid, () => input.counterBot.monthlyAnalysisText());
      await input.sender.sendText(groupJid, text);
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
