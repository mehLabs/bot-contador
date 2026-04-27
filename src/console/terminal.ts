import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { resetDatabase } from '../db/database.js';
import { Repository } from '../db/repository.js';
import { WhatsAppClient } from '../whatsapp/client.js';
import { CodexAdviceClient } from '../advice/codexAdviceClient.js';
import { FinancialContextBuilder } from '../advice/financialContext.js';

export class TerminalController {
  private readonly rl = readline.createInterface({ input, output });

  constructor(
    private readonly whatsapp: WhatsAppClient,
    private readonly repo: Repository,
    private readonly onExit: () => Promise<void> | void,
    private readonly onExport: () => Promise<string | undefined>,
    private readonly codexOptions: { codexBin: string; repoRoot: string },
    private readonly adviceClient?: CodexAdviceClient
  ) {}

  async start(): Promise<void> {
    this.printHelp();
    while (true) {
      const command = (await this.rl.question('bot-contador> ')).trim().toLowerCase();
      if (!command) continue;
      if (command === 'help' || command === '?') this.printHelp();
      else if (command === 'groups') await this.chooseGroup();
      else if (command === 'status') this.status();
      else if (command === 'pause') this.whatsapp.setListening(false);
      else if (command === 'resume') this.whatsapp.setListening(true);
      else if (command === 'disconnect') await this.whatsapp.disconnect();
      else if (command === 'connect') await this.whatsapp.connect();
      else if (command === 'wa-reset') await this.resetWhatsAppSession();
      else if (command === 'export') await this.exportReport();
      else if (command === 'recent') this.printRecent();
      else if (command === 'openai-login') await this.runInteractiveCodex(['login']);
      else if (command === 'openai-status') await this.runInteractiveCodex(['login', 'status']);
      else if (command === 'openai-test') await this.openaiTest();
      else if (command === 'dropdb') await this.dropDb();
      else if (command === 'exit' || command === 'quit') {
        await this.onExit();
        this.rl.close();
        return;
      } else {
        console.log('Comando no reconocido. Usá help para ver opciones.');
      }
    }
  }

  async chooseGroup(): Promise<void> {
    const groups = await this.whatsapp.groups();
    if (groups.length === 0) {
      console.log('No encontré grupos. Verificá que WhatsApp esté conectado.');
      return;
    }
    groups.forEach((group, index) => console.log(`${index + 1}. ${group.subject} (${group.participants}) - ${group.jid}`));
    const answer = await this.rl.question('Elegí número de grupo: ');
    const index = Number(answer) - 1;
    const selected = groups[index];
    if (!selected) {
      console.log('Selección inválida.');
      return;
    }
    this.whatsapp.setSelectedGroup(selected.jid);
    this.repo.setSetting('selected_group_jid', selected.jid);
    this.repo.setSetting('selected_group_subject', selected.subject);
    console.log(`Escuchando: ${selected.subject}`);
  }

  private status(): void {
    console.log(`Grupo activo: ${this.whatsapp.getSelectedGroup() ?? 'sin seleccionar'}`);
    console.log(`Escucha: ${this.whatsapp.isListening() ? 'activa' : 'pausada'}`);
  }

  private printRecent(): void {
    const recent = this.repo.recentExpenses();
    if (recent.length === 0) console.log('Sin gastos registrados.');
    for (const item of recent) {
      console.log(`${item.publicId} | ${item.amount} | ${item.category} | ${item.description} | ${item.status}`);
    }
  }

  private async exportReport(): Promise<void> {
    const filePath = await this.onExport();
    console.log(filePath ? `Reporte generado: ${filePath}` : 'No hay presupuesto activo para exportar.');
  }

  private async dropDb(): Promise<void> {
    const answer = await this.rl.question('Esto borra la base local. Escribí DROP para confirmar: ');
    if (answer !== 'DROP') {
      console.log('Cancelado.');
      return;
    }
    resetDatabase(this.repo.rawDb());
    console.log('Base de datos reiniciada.');
  }

  private async resetWhatsAppSession(): Promise<void> {
    const answer = await this.rl.question('Esto borra la sesión local de WhatsApp y fuerza un QR nuevo. Escribí RESET-WA para confirmar: ');
    if (answer !== 'RESET-WA') {
      console.log('Cancelado.');
      return;
    }
    await this.whatsapp.logoutAndClearAuth();
    console.log('Sesión de WhatsApp borrada. Ejecutá connect para mostrar un QR nuevo.');
  }

  private async openaiTest(): Promise<void> {
    if (!this.adviceClient) {
      console.log('El cliente de consejos no está configurado.');
      return;
    }
    const context = new FinancialContextBuilder(this.repo).build();
    const answer = await this.adviceClient.advise('Respondé en una línea si podés leer este contexto financiero.', context);
    console.log(answer);
  }

  private runInteractiveCodex(args: string[]): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn(this.codexOptions.codexBin, args, {
        cwd: this.codexOptions.repoRoot,
        stdio: 'inherit',
        windowsHide: false
      });
      child.on('error', (error) => {
        console.log(`No pude ejecutar ${this.codexOptions.codexBin}: ${error.message}`);
        console.log('Si Codex está instalado pero no aparece en PATH, configurá CODEX_BIN con la ruta completa a codex.exe en .env.');
        resolve();
      });
      child.on('close', () => resolve());
    });
  }

  private printHelp(): void {
    console.log('Comandos: groups, status, pause, resume, connect, disconnect, wa-reset, export, recent, openai-login, openai-status, openai-test, dropdb, help, exit');
  }
}
