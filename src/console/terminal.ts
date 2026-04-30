import { checkbox, input, select } from '@inquirer/prompts';
import { resetDatabase } from '../db/database.js';
import { Repository } from '../db/repository.js';
import { BotInstance } from '../bot/types.js';
import { BotPipeline } from '../bot/pipeline.js';
import { WhatsAppClient } from '../whatsapp/client.js';

type MainOption = 'status' | 'whatsapp' | 'database' | 'bots' | 'exit';
type WhatsAppOption = 'connect' | 'disconnect' | 'pause' | 'resume' | 'reset' | 'status' | 'back';
type DatabaseOption = 'dropdb' | 'back';
type BotOption = 'select-active' | 'list-active' | `bot:${string}` | 'back';
type BotMenuOption = 'toggle' | 'configure' | 'status' | `action:${string}` | 'back';

export class TerminalController {
  constructor(
    private readonly whatsapp: WhatsAppClient,
    private readonly repo: Repository,
    private readonly pipeline: BotPipeline,
    private readonly availableBots: BotInstance[],
    private readonly onExit: () => Promise<void> | void
  ) {}

  async start(): Promise<void> {
    while (true) {
      const option = await select<MainOption>({
        message: 'Menú principal',
        choices: [
          { name: 'Estado general', value: 'status' },
          { name: 'Cuenta WhatsApp', value: 'whatsapp' },
          { name: 'Base de datos', value: 'database' },
          { name: 'Acciones bots', value: 'bots' },
          { name: 'Salir', value: 'exit' }
        ]
      });

      if (option === 'status') this.printStatus();
      else if (option === 'whatsapp') await this.whatsappMenu();
      else if (option === 'database') await this.databaseMenu();
      else if (option === 'bots') await this.botsMenu();
      else if (option === 'exit') {
        await this.onExit();
        return;
      }
    }
  }

  private async whatsappMenu(): Promise<void> {
    while (true) {
      const option = await select<WhatsAppOption>({
        message: 'Cuenta WhatsApp',
        choices: [
          { name: 'Conectar', value: 'connect' },
          { name: 'Desconectar', value: 'disconnect' },
          { name: 'Pausar escucha', value: 'pause' },
          { name: 'Reanudar escucha', value: 'resume' },
          { name: 'Resetear sesión local', value: 'reset' },
          { name: 'Ver estado', value: 'status' },
          { name: 'Volver', value: 'back' }
        ]
      });
      if (option === 'connect') {
        await this.whatsapp.connect();
        await this.whatsapp.waitUntilConnected();
      } else if (option === 'disconnect') {
        await this.whatsapp.disconnect();
      } else if (option === 'pause') {
        this.whatsapp.setListening(false);
        console.log('Escucha pausada.');
      } else if (option === 'resume') {
        this.whatsapp.setListening(true);
        console.log('Escucha activa.');
      } else if (option === 'reset') {
        await this.resetWhatsAppSession();
      } else if (option === 'status') {
        this.printWhatsAppStatus();
      } else {
        return;
      }
    }
  }

  private async databaseMenu(): Promise<void> {
    while (true) {
      const option = await select<DatabaseOption>({
        message: 'Base de datos',
        choices: [
          { name: 'Borrar base local', value: 'dropdb' },
          { name: 'Volver', value: 'back' }
        ]
      });
      if (option === 'dropdb') await this.dropDb();
      else return;
    }
  }

  private async botsMenu(): Promise<void> {
    while (true) {
      const option = await select<BotOption>({
        message: 'Acciones bots',
        choices: [
          { name: 'Seleccionar bots activos', value: 'select-active' },
          { name: 'Listar bots activos', value: 'list-active' },
          ...this.availableBots.map((bot) => ({
            name: `${bot.name}${this.pipeline.isActive(bot.id) ? ' (activo)' : ''}`,
            value: `bot:${bot.id}` as const,
            description: bot.description
          })),
          { name: 'Volver', value: 'back' }
        ]
      });
      if (option === 'select-active') await this.selectActiveBots();
      else if (option === 'list-active') this.printActiveBots();
      else if (option.startsWith('bot:')) {
        const bot = this.availableBots.find((item) => item.id === option.slice(4));
        if (bot) await this.botMenu(bot);
      } else {
        return;
      }
    }
  }

  private async botMenu(bot: BotInstance): Promise<void> {
    while (true) {
      const actions = bot.terminalActions ?? [];
      const option = await select<BotMenuOption>({
        message: bot.name,
        choices: [
          { name: this.pipeline.isActive(bot.id) ? 'Desactivar bot' : 'Activar bot', value: 'toggle' },
          { name: 'Configurar', value: 'configure', disabled: bot.configure ? false : 'Sin configuración disponible' },
          { name: 'Ver estado', value: 'status' },
          ...actions.map((action) => ({
            name: action.label,
            value: `action:${action.id}` as const
          })),
          { name: 'Volver', value: 'back' }
        ]
      });
      if (option === 'toggle') await this.toggleBot(bot);
      else if (option === 'configure') await bot.configure?.();
      else if (option === 'status') console.log(`${bot.name}: ${bot.status?.() ?? 'sin estado'}`);
      else if (option.startsWith('action:')) {
        const action = actions.find((item) => item.id === option.slice(7));
        await action?.run();
      } else {
        return;
      }
    }
  }

  private async selectActiveBots(): Promise<void> {
    const activeIds = this.pipeline.getActiveBots().map((bot) => bot.id);
    const selectedIds = await checkbox<string>({
      message: 'Elegí los bots activos',
      choices: this.availableBots.map((bot) => ({
        name: bot.name,
        value: bot.id,
        description: bot.description,
        checked: activeIds.includes(bot.id)
      }))
    });
    const selectedBots = this.availableBots.filter((bot) => selectedIds.includes(bot.id));
    for (const bot of selectedBots) {
      await bot.configure?.();
    }
    this.pipeline.setActiveBots(selectedBots);
    this.printActiveBots();
  }

  private async toggleBot(bot: BotInstance): Promise<void> {
    if (this.pipeline.isActive(bot.id)) {
      this.pipeline.deactivate(bot.id);
      console.log(`${bot.name} desactivado.`);
      return;
    }
    await this.pipeline.activate(bot);
    console.log(`${bot.name} activado.`);
  }

  private printStatus(): void {
    this.printWhatsAppStatus();
    console.log(`Escucha: ${this.whatsapp.isListening() ? 'activa' : 'pausada'}`);
    this.printActiveBots();
  }

  private printWhatsAppStatus(): void {
    console.log(`WhatsApp: ${this.whatsapp.isConnected() ? 'conectado' : 'desconectado'}`);
  }

  private printActiveBots(): void {
    const activeBots = this.pipeline.getActiveBots();
    console.log(`Bots activos: ${activeBots.length ? activeBots.map((bot) => bot.name).join(', ') : 'ninguno'}`);
    for (const bot of activeBots) {
      console.log(`- ${bot.name}: ${bot.status?.() ?? 'sin estado'}`);
    }
  }

  private async dropDb(): Promise<void> {
    const answer = await input({ message: 'Esto borra la base local. Escribí DROP para confirmar:' });
    if (answer !== 'DROP') {
      console.log('Cancelado.');
      return;
    }
    resetDatabase(this.repo.rawDb());
    console.log('Base de datos reiniciada.');
  }

  private async resetWhatsAppSession(): Promise<void> {
    const answer = await input({ message: 'Esto borra la sesión local de WhatsApp y fuerza un QR nuevo. Escribí RESET-WA para confirmar:' });
    if (answer !== 'RESET-WA') {
      console.log('Cancelado.');
      return;
    }
    await this.whatsapp.logoutAndClearAuth();
    console.log('Sesión de WhatsApp borrada. Usá Cuenta WhatsApp > Conectar para mostrar un QR nuevo.');
  }
}
