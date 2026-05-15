import { BotReply, IncomingMessage } from '../types.js';

export type BotHandleResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      reply?: BotReply;
      stopPipeline?: boolean;
      markRead?: boolean;
      composeWhileHandling?: boolean;
    };

export type BotContext = {
  sendText: (jid: string, text: string) => Promise<void>;
  sendDocument: (jid: string, filePath: string, caption?: string) => Promise<void>;
  whileComposing: <T>(jid: string, task: () => Promise<T>) => Promise<T>;
  markRead: (message: IncomingMessage) => Promise<void>;
};

export type BotTerminalAction = {
  id: string;
  label: string;
  run: () => Promise<void>;
};

export type BotInstance = {
  id: string;
  name: string;
  description: string;
  handle: (message: IncomingMessage, ctx: BotContext) => Promise<BotHandleResult>;
  configure?: () => Promise<void | false>;
  status?: () => string;
  terminalActions?: BotTerminalAction[];
};
