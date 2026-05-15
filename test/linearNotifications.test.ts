import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { LinearNotificationBot } from '../src/bot/linearNotificationBot.js';
import { Repository } from '../src/db/repository.js';
import { schemaSql } from '../src/db/schema.js';
import {
  formatLinearDailyMessage,
  formatLinearUserName,
  LinearNotificationService,
  type LinearNotificationSnapshot
} from '../src/linear/notifications.js';
import { startLinearNotifications } from '../src/scheduler/linearNotifications.js';

const snapshot: LinearNotificationSnapshot = {
  users: [
    { id: 'u1', name: 'Ana' },
    { id: 'u2', name: 'Bruno' },
    { id: 'u3', name: 'Carla' }
  ],
  issues: [
    {
      assigneeId: 'u1',
      identifier: 'APP-3',
      title: 'Normal issue',
      priority: 3,
      priorityLabel: 'Medium',
      stateName: 'Todo',
      stateType: 'unstarted'
    },
    {
      assigneeId: 'u1',
      identifier: 'APP-1',
      title: 'High issue',
      priority: 2,
      priorityLabel: 'High',
      stateName: 'In Progress',
      stateType: 'started'
    },
    {
      assigneeId: 'u1',
      identifier: 'APP-9',
      title: 'Closed issue',
      priority: 1,
      priorityLabel: 'Urgent',
      stateName: 'Done',
      stateType: 'completed'
    },
    {
      assigneeId: 'u2',
      identifier: 'APP-2',
      title: 'No priority issue',
      priority: 0,
      priorityLabel: 'No priority',
      stateName: 'Backlog',
      stateType: 'backlog'
    }
  ]
};

function repo(): Repository {
  const db = new Database(':memory:');
  db.exec(schemaSql);
  return new Repository(db, 'ARS');
}

function linearBot(input: {
  repo?: Repository;
  service?: LinearNotificationService;
  chooseGroup?: () => Promise<{ jid: string; subject: string } | undefined>;
} = {}) {
  return new LinearNotificationBot(input.repo ?? repo(), input.service, input.chooseGroup ?? (async () => ({ jid: '123@g.us', subject: 'Equipo' })));
}

describe('Linear notifications formatter', () => {
  it('agrupa por usuario activo, ordena por prioridad e incluye usuarios sin pendientes', () => {
    const message = formatLinearDailyMessage(snapshot, 'Quote');

    expect(message).toContain('Ana\n- APP-1 High issue [High | In Progress]\n- APP-3 Normal issue [Medium | Todo]');
    expect(message).toContain('Bruno\n- APP-2 No priority issue [Backlog]');
    expect(message).toContain('Carla\n- Sin issues pendientes');
    expect(message).not.toContain('Closed issue');
    expect(message).not.toContain('No priority |');
    expect(message).toContain('> Quote');
  });

  it('prefiere nombre completo y usa email cuando el username coincide con el mail sin dominio', () => {
    expect(formatLinearUserName({ id: 'u1', name: 'Juan Pepe', displayName: 'juan.pepe', email: 'juan.pepe@host.com' })).toBe('Juan Pepe');
    expect(formatLinearUserName({ id: 'u2', name: '', displayName: 'juan.pepe', email: 'juan.pepe@host.com' })).toBe('juan.pepe@host.com');
    expect(formatLinearUserName({ id: 'u3', displayName: 'jpepe', email: 'juan.pepe@host.com' })).toBe('jpepe');
  });
});

describe('LinearNotificationBot', () => {
  it('persiste y restaura el grupo configurado', () => {
    const sharedRepo = repo();
    const bot = new LinearNotificationBot(sharedRepo, {} as LinearNotificationService, async () => undefined);
    bot.setGroup('123@g.us', 'Equipo');

    const restored = new LinearNotificationBot(sharedRepo, {} as LinearNotificationService, async () => undefined);
    restored.restoreGroup();

    expect(restored.getGroup()).toBe('123@g.us');
    expect(restored.status()).toBe('Equipo (123@g.us)');
  });

  it('reporta falta de token y no se configura', async () => {
    const bot = linearBot();

    await expect(bot.configure()).resolves.toBe(false);
    expect(bot.status()).toBe('sin LINEAR_API_KEY');
  });

  it('no consume mensajes entrantes', async () => {
    const bot = linearBot({ service: {} as LinearNotificationService });

    const result = await bot.handle(
      {
        id: 'm1',
        groupJid: '123@g.us',
        senderJid: '549111@s.whatsapp.net',
        text: 'hola',
        timestamp: new Date('2026-04-30T12:00:00Z')
      },
      {
        sendText: async () => undefined,
        sendDocument: async () => undefined,
        whileComposing: async (_jid, task) => task(),
        markRead: async () => undefined
      }
    );

    expect(result).toEqual({ handled: false });
  });
});

describe('startLinearNotifications', () => {
  it('agenda lunes a viernes a las 9 y respeta timezone', () => {
    const calls: Array<{ expression: string; options?: unknown }> = [];
    const scheduler: any = {
      schedule: (expression: string, _task: () => Promise<void>, options?: unknown) => {
        calls.push({ expression, options });
        return {};
      }
    };

    startLinearNotifications(
      {
        timezone: 'America/Argentina/Buenos_Aires',
        sender: { sendText: async () => undefined },
        linearBot: linearBot({ service: {} as LinearNotificationService }),
        isLinearBotActive: () => true
      },
      scheduler
    );

    expect(calls).toEqual([{ expression: '0 9 * * 1-5', options: { timezone: 'America/Argentina/Buenos_Aires' } }]);
  });

  it('no envia si el bot no esta activo o no tiene grupo', async () => {
    const sent: string[] = [];
    let task: (() => Promise<void>) | undefined;
    const scheduler: any = {
      schedule: (_expression: string, scheduledTask: () => Promise<void>) => {
        task = scheduledTask;
        return {};
      }
    };
    const bot = linearBot({ service: {} as LinearNotificationService });

    startLinearNotifications(
      {
        timezone: 'UTC',
        sender: {
          sendText: async (_jid, text) => {
            sent.push(text);
          }
        },
        linearBot: bot,
        isLinearBotActive: () => false
      },
      scheduler
    );
    await task?.();
    expect(sent).toEqual([]);

    startLinearNotifications(
      {
        timezone: 'UTC',
        sender: {
          sendText: async (_jid, text) => {
            sent.push(text);
          }
        },
        linearBot: bot,
        isLinearBotActive: () => true
      },
      scheduler
    );
    await task?.();
    expect(sent).toEqual([]);
  });
});
