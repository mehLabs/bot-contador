import { describe, expect, it } from 'vitest';
import { BotPipeline } from '../src/bot/pipeline.js';
import { BotContext, BotInstance } from '../src/bot/types.js';
import { IncomingMessage } from '../src/types.js';

const message: IncomingMessage = {
  id: 'm1',
  groupJid: '123@g.us',
  senderJid: '549111@s.whatsapp.net',
  text: 'hola',
  timestamp: new Date('2026-04-26T12:00:00Z')
};

function ctx() {
  const sent: Array<{ jid: string; text: string }> = [];
  const documents: Array<{ jid: string; filePath: string; caption?: string }> = [];
  const read: string[] = [];
  const context: BotContext = {
    sendText: async (jid, text) => {
      sent.push({ jid, text });
    },
    sendDocument: async (jid, filePath, caption) => {
      documents.push({ jid, filePath, caption });
    },
    whileComposing: async (_jid, task) => task(),
    markRead: async (incoming) => {
      read.push(incoming.id);
    }
  };
  return { context, sent, documents, read };
}

function bot(id: string, handle: BotInstance['handle']): BotInstance {
  return { id, name: id, description: id, handle };
}

describe('BotPipeline', () => {
  it('ignora mensajes cuando ningún bot aplica', async () => {
    const { context, sent } = ctx();
    const pipeline = new BotPipeline(context);
    pipeline.setActiveBots([bot('a', async () => ({ handled: false }))]);

    await pipeline.handle(message);

    expect(sent).toHaveLength(0);
  });

  it('ejecuta bots activos en orden', async () => {
    const order: string[] = [];
    const { context } = ctx();
    const pipeline = new BotPipeline(context);
    pipeline.setActiveBots([
      bot('a', async () => {
        order.push('a');
        return { handled: false };
      }),
      bot('b', async () => {
        order.push('b');
        return { handled: false };
      })
    ]);

    await pipeline.handle(message);

    expect(order).toEqual(['a', 'b']);
  });

  it('corta el pipeline cuando un bot lo pide', async () => {
    const order: string[] = [];
    const { context, sent, read } = ctx();
    const pipeline = new BotPipeline(context);
    pipeline.setActiveBots([
      bot('a', async () => {
        order.push('a');
        return { handled: true, reply: { text: 'listo' }, markRead: true, stopPipeline: true };
      }),
      bot('b', async () => {
        order.push('b');
        return { handled: true, reply: { text: 'no debería' } };
      })
    ]);

    await pipeline.handle(message);

    expect(order).toEqual(['a']);
    expect(sent).toEqual([{ jid: '123@g.us', text: 'listo' }]);
    expect(read).toEqual(['m1']);
  });

  it('continúa con el siguiente bot si uno falla', async () => {
    const { context, sent } = ctx();
    const pipeline = new BotPipeline(context);
    pipeline.setActiveBots([
      bot('a', async () => {
        throw new Error('boom');
      }),
      bot('b', async () => ({ handled: true, reply: { text: 'fallback' }, stopPipeline: true }))
    ]);

    await pipeline.handle(message);

    expect(sent).toEqual([{ jid: '123@g.us', text: 'fallback' }]);
  });

  it('activa y desactiva bots desde la API de administración', async () => {
    const { context } = ctx();
    const pipeline = new BotPipeline(context);
    let configured = 0;
    const managedBot = {
      ...bot('managed', async () => ({ handled: false })),
      configure: async () => {
        configured += 1;
      }
    };

    await pipeline.activate(managedBot);
    await pipeline.activate(managedBot);
    pipeline.deactivate('managed');

    expect(configured).toBe(1);
    expect(pipeline.isActive('managed')).toBe(false);
    expect(pipeline.getActiveBots()).toHaveLength(0);
  });
});
