import { CodexAdviceClient } from '../advice/codexAdviceClient.js';
import { FinancialContextBuilder } from '../advice/financialContext.js';
import { Repository } from '../db/repository.js';
import { createAvailabilityReport } from '../report/excel.js';
import { BotReply, IncomingMessage, ParsedMessage } from '../types.js';
import { currentPeriod, formatMoney } from '../utils/format.js';

export class UseCaseEngine {
  constructor(
    private readonly repo: Repository,
    private readonly options: { currency: string; reportsDir: string },
    private readonly adviceClient?: CodexAdviceClient
  ) {}

  async handle(message: IncomingMessage, parsed: ParsedMessage): Promise<BotReply | undefined> {
    switch (parsed.intent) {
      case 'register_expense':
        return this.registerExpense(message, parsed);
      case 'cancel_expense':
        return this.cancelExpense(message, parsed);
      case 'availability':
        return this.availability(true);
      case 'setup_budget':
        return this.setupBudget(parsed);
      case 'list_recent':
        return this.listRecent();
      case 'identify_person':
        return this.identifyPerson(message, parsed);
      case 'help':
        return this.help();
      case 'financial_advice':
      case 'bot_question':
        return this.financialAdvice(message);
      case 'confirm':
        return { text: 'Recibido. Si querés que registre o cambie algo, mandame el monto, la categoría y una descripción corta.' };
      case 'correct_expense':
        return { text: 'Puedo corregir gastos, pero necesito que indiques el ID del gasto y el nuevo monto, categoría o descripción.' };
      case 'unknown':
      default:
        return undefined;
    }
  }

  reminderText(): string {
    return 'Cierre del día: si hicieron gastos hoy, pásenlos por acá y los registro.';
  }

  async availability(withAttachment: boolean): Promise<BotReply> {
    const summary = this.repo.budgetSummary();
    if (!summary) {
      return { text: `Todavía no hay presupuesto configurado para ${currentPeriod()}. Mandá el total mensual y las categorías para empezar.` };
    }
    const lines = [
      `Disponibilidad de ${summary.period}`,
      `Total: ${formatMoney(summary.total, this.options.currency)}`,
      `Gastado: ${formatMoney(summary.spent, this.options.currency)}`,
      `Disponible general: ${formatRemaining(summary.remaining, this.options.currency)}`,
      '',
      'Por categoría:',
      ...summary.categories.map((category) => {
        const owner = category.personName ? ` (${category.personName})` : '';
        return `- ${category.name}${owner}: ${formatRemaining(category.remaining, this.options.currency)} de ${formatMoney(category.limit, this.options.currency)}`;
      })
    ];

    const attachmentPath = withAttachment
      ? await createAvailabilityReport({
          reportsDir: this.options.reportsDir,
          period: summary.period,
          currency: this.options.currency,
          total: summary.total,
          spent: summary.spent,
          remaining: summary.remaining,
          categories: summary.categories
        })
      : undefined;

    return { text: lines.join('\n'), attachmentPath };
  }

  help(): BotReply {
    return {
      text: [
        'Puedo ayudarte con:',
        '- Registrar gasto: “gasté 50000 en comida”.',
        '- Registrar comprobante: mandá una imagen del ticket o transferencia.',
        '- Cancelar gasto: “cancelá el gasto GABC12” o “borrá mi último gasto”.',
        '- Consultar disponibilidad: “cuánto queda”.',
        '- Exportar Excel: pedí disponibilidad y adjunto el reporte.',
        '- Configurar presupuesto: “presupuesto abril 150000, comida 20000, transporte 30000”.',
        '- Listar gastos recientes: “últimos gastos”.',
        '- Pedir consejos financieros: “dame consejos para no pasarme este mes”.',
        '- Ver esta ayuda: “comandos” o “qué podés hacer”.'
      ].join('\n')
    };
  }

  private async financialAdvice(message: IncomingMessage): Promise<BotReply> {
    if (!this.adviceClient) {
      return { text: 'Los consejos financieros requieren configurar el puente con Codex CLI. En la consola usá openai-login y luego openai-test.' };
    }
    const context = new FinancialContextBuilder(this.repo).build();
    const advice = await this.adviceClient.advise(message.text || 'Dame consejos financieros sobre el presupuesto actual.', context);
    return { text: advice };
  }

  private registerExpense(message: IncomingMessage, parsed: ParsedMessage): BotReply {
    const missing = requiredMissing(parsed, ['amount', 'category']);
    if (missing.length > 0 || parsed.confidence < 0.55 || parsed.needsConfirmation) {
      return { text: `Necesito un dato más para registrar el gasto: ${missing.join(', ') || 'confirmación'}. Mandalo en el grupo y lo cargo.` };
    }
    const personId = parsed.personName ? this.repo.ensurePerson(parsed.personName) : this.repo.personForSender(message.senderJid, message.senderName);
    const description = parsed.description ?? (message.text || 'Gasto sin descripción');
    const expense = this.repo.createExpense({
      amount: parsed.amount!,
      category: parsed.category!,
      description,
      personId,
      senderJid: message.senderJid,
      groupJid: message.groupJid,
      messageId: message.id,
      receiptPath: message.image?.fileName,
      date: parsed.date
    });
    const summary = this.repo.budgetSummary();
    const category = summary?.categories.find((item) => item.name.toLowerCase() === parsed.category!.toLowerCase());
    const categoryText = category ? ` En ${category.name}, ${formatRemaining(category.remaining, this.options.currency)}.` : '';
    const totalText = summary ? ` Quedan ${formatMoney(Math.max(summary.remaining, 0), this.options.currency)} disponibles este mes.` : '';
    return {
      text: `Registré ${formatMoney(parsed.amount!, this.options.currency)} en ${parsed.category} (${expense.publicId}).${totalText}${categoryText}`
    };
  }

  private cancelExpense(message: IncomingMessage, parsed: ParsedMessage): BotReply {
    const cancelled = this.repo.cancelExpense(parsed.expenseRef, message.senderJid);
    if (!cancelled) {
      return { text: 'No encontré un gasto activo que coincida. Podés pedirme “últimos gastos” y luego cancelar por ID.' };
    }
    const summary = this.repo.budgetSummary();
    const totalText = summary ? ` Disponible general actualizado: ${formatMoney(summary.remaining, this.options.currency)}.` : '';
    return { text: `Cancelé ${cancelled.publicId}: ${cancelled.description} por ${formatMoney(cancelled.amount, this.options.currency)}.${totalText}` };
  }

  private setupBudget(parsed: ParsedMessage): BotReply {
    if (!parsed.budget?.total || parsed.budget.categories.length === 0) {
      return { text: 'Para configurar el presupuesto necesito el total mensual y al menos una categoría con su monto.' };
    }
    const period = parsed.budget.period ?? currentPeriod();
    this.repo.upsertBudget(period, parsed.budget.total, parsed.budget.categories);
    const personal = parsed.budget.categories.filter((category) => category.kind === 'personal' && category.personName);
    const nextIdentification = personal.find((category) => category.personName);
    const suffix = nextIdentification
      ? ` Necesito identificar a las personas del presupuesto. ${nextIdentification.personName}, respondé “yo”.`
      : '';
    return {
      text: `Presupuesto de ${period} configurado: ${formatMoney(parsed.budget.total, this.options.currency)} en ${parsed.budget.categories.length} categorías.${suffix}`
    };
  }

  private listRecent(): BotReply {
    const recent = this.repo.recentExpenses();
    if (recent.length === 0) return { text: 'No hay gastos registrados todavía.' };
    return {
      text: ['Últimos gastos:', ...recent.map((item) => `- ${item.publicId}: ${formatMoney(item.amount, this.options.currency)} en ${item.category}, ${item.description} [${item.status}]`)].join('\n')
    };
  }

  private identifyPerson(message: IncomingMessage, parsed: ParsedMessage): BotReply {
    if (!parsed.personName && !/^yo\b/i.test(message.text.trim())) {
      return { text: 'Decime a qué persona corresponde este número, por ejemplo: “soy Juan”.' };
    }
    const name = parsed.personName ?? message.senderName ?? message.senderJid.split('@')[0] ?? 'Persona';
    this.repo.identifyPerson(name, message.senderJid);
    return { text: `Listo, asocié este número con ${name}.` };
  }
}

function requiredMissing(parsed: ParsedMessage, fields: Array<'amount' | 'category'>): string[] {
  const missing = fields.filter((field) => parsed[field] == null || parsed[field] === '');
  return Array.from(new Set([...missing, ...parsed.missingFields]));
}

function formatRemaining(value: number, currency: string): string {
  if (value >= 0) return `${formatMoney(value, currency)} disponibles`;
  return `excedido por ${formatMoney(Math.abs(value), currency)}`;
}
