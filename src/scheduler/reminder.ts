import cron from 'node-cron';
import { UseCaseEngine } from '../bot/useCases.js';
import { WhatsAppClient } from '../whatsapp/client.js';

export function startDailyReminder(input: { timezone: string; whatsapp: WhatsAppClient; engine: UseCaseEngine }): void {
  cron.schedule(
    '0 22 * * *',
    async () => {
      if (!input.whatsapp.getSelectedGroup()) return;
      await input.whatsapp.sendText(input.engine.reminderText());
    },
    { timezone: input.timezone }
  );
}
