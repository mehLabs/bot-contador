import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket
} from 'baileys';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { IncomingMessage } from '../types.js';
import { sleep, typingDelayMs } from '../utils/typing.js';

type MessageHandler = (message: IncomingMessage) => Promise<void>;

export class WhatsAppClient {
  private sock?: WASocket;
  private selectedGroupJid?: string;
  private listening = true;
  private handler?: MessageHandler;
  private connectedHandler?: () => Promise<void> | void;
  private sendQueue = Promise.resolve();
  private shouldReconnect = true;

  constructor(private readonly options: { authDir: string; mediaDir: string }) {}

  setMessageHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  onConnected(handler: () => Promise<void> | void): void {
    this.connectedHandler = handler;
  }

  setSelectedGroup(jid: string): void {
    this.selectedGroupJid = jid;
  }

  getSelectedGroup(): string | undefined {
    return this.selectedGroupJid;
  }

  setListening(value: boolean): void {
    this.listening = value;
  }

  isListening(): boolean {
    return this.listening;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    fs.mkdirSync(this.options.authDir, { recursive: true });
    fs.mkdirSync(this.options.mediaDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authDir);
    const { version } = await fetchLatestBaileysVersion();
    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys)
      },
      logger: pino({ level: 'silent' }),
      browser: ['bot-contador', 'Chrome', '1.0.0'],
      syncFullHistory: false
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('Escaneá este QR con WhatsApp para conectar el bot:');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        console.log('WhatsApp conectado.');
        void this.connectedHandler?.();
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        console.log(`WhatsApp desconectado (${statusCode ?? 'sin código'}).`);
        this.sock = undefined;
        if (statusCode === DisconnectReason.loggedOut) {
          this.shouldReconnect = false;
          console.log('La sesión local de WhatsApp fue revocada o expiró. Usá wa-reset en la consola y luego connect para generar un QR nuevo.');
          return;
        }
        if (this.shouldReconnect) void this.connect();
      }
    });
    this.sock.ev.on('messages.upsert', async (event) => {
      for (const raw of event.messages ?? []) {
        await this.handleRawMessage(raw);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.sock?.end(undefined);
    this.sock = undefined;
  }

  async logoutAndClearAuth(): Promise<void> {
    this.shouldReconnect = false;
    await this.sock?.logout().catch(() => undefined);
    this.sock?.end(undefined);
    this.sock = undefined;
    this.clearAuth();
  }

  clearAuth(): void {
    fs.rmSync(this.options.authDir, { recursive: true, force: true });
    fs.mkdirSync(this.options.authDir, { recursive: true });
  }

  async groups(): Promise<Array<{ jid: string; subject: string; participants: number }>> {
    if (!this.sock) return [];
    const response = await this.sock.groupFetchAllParticipating();
    return Object.values(response).map((group: any) => ({
      jid: group.id,
      subject: group.subject ?? group.name ?? group.id,
      participants: group.participants?.length ?? 0
    }));
  }

  async sendText(text: string): Promise<void> {
    const jid = this.selectedGroupJid;
    if (!jid || !this.sock) return;
    this.sendQueue = this.sendQueue.then(async () => {
      await this.sock!.sendPresenceUpdate('composing', jid);
      await sleep(typingDelayMs(text));
      await this.sock!.sendPresenceUpdate('paused', jid);
      await this.sock!.sendMessage(jid, { text });
    });
    await this.sendQueue;
  }

  async whileComposing<T>(task: () => Promise<T>): Promise<T> {
    const jid = this.selectedGroupJid;
    if (!jid || !this.sock) return task();
    await this.sock.sendPresenceUpdate('composing', jid).catch(() => undefined);
    const pulse = setInterval(() => {
      void this.sock?.sendPresenceUpdate('composing', jid).catch(() => undefined);
    }, 8000);
    try {
      return await task();
    } finally {
      clearInterval(pulse);
      await this.sock?.sendPresenceUpdate('paused', jid).catch(() => undefined);
    }
  }

  async sendDocument(filePath: string, caption?: string): Promise<void> {
    const jid = this.selectedGroupJid;
    if (!jid || !this.sock) return;
    await this.sock.sendMessage(jid, {
      document: { url: filePath },
      fileName: path.basename(filePath),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      caption
    });
  }

  async markRead(message: IncomingMessage): Promise<void> {
    if (!this.sock) return;
    await this.sock.readMessages([
      {
        remoteJid: message.groupJid,
        id: message.id,
        participant: message.senderJid
      }
    ]);
  }

  private async handleRawMessage(raw: WAMessage): Promise<void> {
    if (!this.handler || !this.selectedGroupJid || !this.listening) return;
    const groupJid = raw.key.remoteJid;
    const selfJid = this.sock?.user?.id?.split(':')[0];
    const senderJid = raw.key.participant ?? raw.participant ?? groupJid;
    if (!senderJid) return;
    const senderPhone = senderJid.split('@')[0]?.split(':')[0];
    if (!groupJid || groupJid !== this.selectedGroupJid || raw.key.fromMe || (selfJid && senderPhone && selfJid === senderPhone)) return;
    const text = extractText(raw);
    const imageMessage = raw.message?.imageMessage;
    const image = imageMessage ? await this.downloadImage(raw, imageMessage.mimetype ?? 'image/jpeg') : undefined;
    if (!text && !image) return;
    await this.handler({
      id: raw.key.id ?? `${Date.now()}`,
      groupJid,
      senderJid,
      senderName: raw.pushName ?? undefined,
      text,
      timestamp: new Date(Number(raw.messageTimestamp ?? Date.now()) * 1000),
      image
    });
  }

  private async downloadImage(raw: WAMessage, mimeType: string): Promise<IncomingMessage['image']> {
    const buffer = (await downloadMediaMessage(raw, 'buffer', {})) as Buffer;
    const extension = mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = path.join(this.options.mediaDir, `${raw.key.id ?? Date.now()}.${extension}`);
    fs.writeFileSync(fileName, buffer);
    return { buffer, mimeType, fileName };
  }
}

function extractText(raw: WAMessage): string {
  const message = raw.message;
  if (!message) return '';
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.documentMessage?.caption ??
    ''
  ).trim();
}
