import { CodexAdviceClient } from '../advice/codexAdviceClient.js';
import { FinancialContextBuilder } from '../advice/financialContext.js';
import { BudgetCategoryInput, FixedExpenseInput, Repository } from '../db/repository.js';
import { createAvailabilityReport } from '../report/excel.js';
import { BotReply, IncomingMessage, ParsedMessage } from '../types.js';
import { currentPeriod, formatMoney, nextPeriod } from '../utils/format.js';

type PendingUnknownCategoryExpense = {
  amount: number;
  requestedCategory: string;
  description: string;
  personId: number;
  senderJid: string;
  groupJid: string;
  messageId: string;
  receiptPath?: string;
  date?: string | null;
};

const CATEGORY_MATCH_CONFIDENCE_THRESHOLD = 0.8;

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
      case 'register_credit_card_expense':
        return this.registerCreditCardExpense(message, parsed);
      case 'cancel_expense':
        return this.cancelExpense(message, parsed);
      case 'availability':
        return this.availability(true, parsed.category);
      case 'setup_budget':
      case 'update_budget':
        return this.setupBudget(message, parsed, currentPeriod());
      case 'setup_next_budget':
        return this.setupBudget(message, parsed, nextPeriod());
      case 'register_income':
        return this.registerIncome(message, parsed);
      case 'adjust_remaining':
        return this.adjustRemaining(message, parsed);
      case 'manage_goal':
        return this.manageGoal(parsed);
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
        return this.confirmPending(message);
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

  async monthlyAnalysisText(): Promise<string> {
    const goals = this.repo.goals('active');
    const goalsText = goals.length
      ? `Metas activas: ${goals.map((goal) => `${horizonLabel(goal.horizon)}: ${goal.title}`).join('; ')}.`
      : 'No hay metas activas registradas.';
    if (!this.adviceClient) {
      return `Arranca un nuevo mes. Actualizá tus metas de corto, mediano y largo plazo. ${goalsText}`;
    }
    const context = new FinancialContextBuilder(this.repo).build();
    const advice = await this.adviceClient.advise(
      'Hacé el análisis mensual del periodo cerrado o vigente según el contexto. Evaluá especialmente metas de corto plazo y cualquier meta mediana/larga que afecte decisiones del mes. Cerrá pidiendo actualización de metas.',
      context
    );
    return `${advice}\n\nActualizá tus metas de corto, mediano y largo plazo cuando puedas.`;
  }

  async availability(withAttachment: boolean, categoryName?: string | null): Promise<BotReply> {
    const summary = this.repo.budgetSummary();
    if (!summary) {
      return { text: `Todavía no hay presupuesto configurado para ${currentPeriod()}. Mandá el total mensual y las categorías para empezar.` };
    }
    if (categoryName) {
      const category = summary.categories.find((item) => item.name.toLowerCase() === categoryName.toLowerCase());
      if (!category) {
        const available = summary.categories.map((item) => item.name).join(', ') || 'ninguna';
        return { text: `No encontré la categoría "${categoryName}" en ${summary.period}. Categorías disponibles: ${available}.` };
      }
      const owner = category.personName ? ` (${category.personName})` : '';
      return {
        text: [
          `Disponibilidad de ${category.name}${owner} en ${summary.period}`,
          `Presupuesto: ${formatMoney(category.limit, this.options.currency)}`,
          `Gastado: ${formatMoney(category.spent, this.options.currency)}`,
          `Disponible: ${formatRemaining(category.remaining, this.options.currency)}`
        ].join('\n'),
        actionTaken: true
      };
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
          fixedSpent: summary.fixedSpent,
          variableSpent: summary.variableSpent,
          remaining: summary.remaining,
          categories: summary.categories,
          fixedExpenses: summary.fixedExpenses,
          incomes: summary.incomes,
          adjustments: summary.adjustments
        })
      : undefined;

    return { text: lines.join('\n'), attachmentPath, actionTaken: true };
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
        '- Configurar presupuesto: “presupuesto 150000, comida 20000, transporte 30000”.',
        '- Registrar ingreso: “cobré 200000 de sueldo”.',
        '- Ajustar disponible: “me quedan 50000 pesos”.',
        '- Gasto con tarjeta: “gasté 30000 con Visa”.',
        '- Gestionar metas: “creá una meta corta para juntar 100000”.',
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
    return { text: advice, actionTaken: true };
  }

  private async registerExpense(message: IncomingMessage, parsed: ParsedMessage): Promise<BotReply> {
    const missing = requiredMissing(parsed, ['amount', 'category']);
    if (missing.length > 0 || parsed.confidence < 0.55 || parsed.needsConfirmation) {
      return { text: `Necesito un dato más para registrar el gasto: ${missing.join(', ') || 'confirmación'}. Mandalo en el grupo y lo cargo.` };
    }
    const personId = parsed.personName ? this.repo.ensurePerson(parsed.personName) : this.repo.personForSender(message.senderJid, message.senderName);
    const description = parsed.description ?? (message.text || 'Gasto sin descripción');
    const requestedCategory = parsed.category!;
    const exactCategory = this.repo.findCurrentCategory(requestedCategory, personId);
    const categoryName = exactCategory?.name ?? (await this.matchExpenseCategory(requestedCategory, message.text, personId));
    if (!categoryName) {
      this.repo.savePendingConfirmation({
        groupJid: message.groupJid,
        senderJid: message.senderJid,
        type: 'unknown_category_expense',
        payload: {
          amount: parsed.amount!,
          requestedCategory,
          description,
          personId,
          senderJid: message.senderJid,
          groupJid: message.groupJid,
          messageId: message.id,
          receiptPath: message.image?.fileName,
          date: parsed.date
        } satisfies PendingUnknownCategoryExpense
      });
      return {
        text: `No encontré la categoría "${requestedCategory}". ¿Querés crearla como categoría nueva o cargar este gasto en Varios? Respondé "crear categoría" o "varios".`
      };
    }
    return this.createExpenseReply(
      {
        amount: parsed.amount!,
        category: categoryName,
        description,
        personId,
        senderJid: message.senderJid,
        groupJid: message.groupJid,
        messageId: message.id,
        receiptPath: message.image?.fileName,
        date: parsed.date
      },
      requestedCategory
    );
  }

  private createExpenseReply(
    input: {
      amount: number;
      category: string;
      description: string;
      personId: number;
      senderJid: string;
      groupJid: string;
      messageId: string;
      receiptPath?: string;
      date?: string | null;
    },
    requestedCategory?: string
  ): BotReply {
    const expense = this.repo.createExpense({
      amount: input.amount,
      category: input.category,
      description: input.description,
      personId: input.personId,
      senderJid: input.senderJid,
      groupJid: input.groupJid,
      messageId: input.messageId,
      receiptPath: input.receiptPath,
      date: input.date
    });
    const summary = this.repo.budgetSummary();
    const category = summary?.categories.find((item) => item.name.toLowerCase() === input.category.toLowerCase());
    const normalizedText =
      requestedCategory && requestedCategory.toLowerCase() !== input.category.toLowerCase()
        ? ` Interpreté "${requestedCategory}" como "${input.category}".`
        : '';
    const categoryText = category ? ` En ${category.name}, ${formatRemaining(category.remaining, this.options.currency)}.` : '';
    const totalText = summary ? ` Quedan ${formatMoney(Math.max(summary.remaining, 0), this.options.currency)} disponibles este mes.` : '';
    return {
      text: `Registré ${formatMoney(input.amount, this.options.currency)} en ${input.category} (${expense.publicId}).${normalizedText}${totalText}${categoryText}`,
      actionTaken: true
    };
  }

  private async matchExpenseCategory(requestedCategory: string, messageText: string, personId: number): Promise<string | undefined> {
    if (!this.adviceClient) return undefined;
    const categories = this.repo
      .currentCategories()
      .filter((category) => category.personId == null || category.personId === personId)
      .map((category) => category.name);
    if (categories.length === 0) return undefined;
    const result = await this.adviceClient.matchCategory({ requestedCategory, categories, messageText });
    if (!result.matchedCategory || result.confidence < CATEGORY_MATCH_CONFIDENCE_THRESHOLD) return undefined;
    return result.matchedCategory;
  }

  private registerCreditCardExpense(message: IncomingMessage, parsed: ParsedMessage): BotReply {
    const missing = requiredMissing(parsed, ['amount']);
    const cardName = parsed.creditCard?.name ?? parsed.category;
    if (missing.length > 0 || !cardName || parsed.confidence < 0.55 || parsed.needsConfirmation) {
      return { text: `Necesito monto y tarjeta para registrar el gasto con crédito. Ejemplo: “gasté 30000 con Visa”.` };
    }
    const fixed = this.repo.addCreditCardFixedExpense(cardName, parsed.amount!, parseMessageDate(parsed.date, message.timestamp));
    return {
      text: `Anoté ${formatMoney(parsed.amount!, this.options.currency)} para ${fixed.name}. Queda como gasto fijo de ${fixed.period}: ${formatMoney(fixed.amount, this.options.currency)} acumulados.`,
      actionTaken: true
    };
  }

  private cancelExpense(message: IncomingMessage, parsed: ParsedMessage): BotReply {
    const cancelled = this.repo.cancelExpense(parsed.expenseRef, message.senderJid);
    if (!cancelled) {
      return { text: 'No encontré un gasto activo que coincida. Podés pedirme “últimos gastos” y luego cancelar por ID.' };
    }
    const summary = this.repo.budgetSummary();
    const totalText = summary ? ` Disponible general actualizado: ${formatMoney(summary.remaining, this.options.currency)}.` : '';
    return { text: `Cancelé ${cancelled.publicId}: ${cancelled.description} por ${formatMoney(cancelled.amount, this.options.currency)}.${totalText}`, actionTaken: true };
  }

  private setupBudget(message: IncomingMessage, parsed: ParsedMessage, forcedPeriod: string): BotReply {
    if (!parsed.budget?.total || parsed.budget.categories.length === 0) {
      return { text: 'Para configurar el presupuesto necesito el total mensual y al menos una categoría con su monto.' };
    }
    const period = forcedPeriod;
    const categories = parsed.budget.categories;
    const fixedExpenses = parsed.budget.fixedExpenses ?? [];
    const assigned = totalBudgetItems(categories, fixedExpenses);
    if (assigned > parsed.budget.total) {
      const hole = assigned - parsed.budget.total;
      this.repo.savePendingConfirmation({
        groupJid: message.groupJid,
        senderJid: message.senderJid,
        type: 'overbudget',
        payload: { period, total: parsed.budget.total, categories, fixedExpenses, hole }
      });
      return {
        text: `Alerta: ese presupuesto queda excedido por ${formatMoney(hole, this.options.currency)} antes de guardarlo. Si querés guardarlo igual, respondé “confirmo”.`
      };
    }
    this.repo.upsertBudget(period, parsed.budget.total, categories, fixedExpenses);
    const personal = parsed.budget.categories.filter((category) => category.kind === 'personal' && category.personName);
    const nextIdentification = personal.find((category) => category.personName);
    const suffix = nextIdentification
      ? ` Necesito identificar a las personas del presupuesto. ${nextIdentification.personName}, respondé “yo”.`
      : '';
    const previous = period === currentPeriod() ? this.repo.previousBudget(period) : undefined;
    const previousHint = previous
      ? ` Gastos fijos del presupuesto anterior: ${previous.fixedExpenses.length ? previous.fixedExpenses.map((item) => `${item.name} ${formatMoney(item.amount, this.options.currency)}`).join(', ') : 'ninguno'}. Si querés, puedo usar ${previous.period} como base cuando armes el próximo.`
      : '';
    return {
      text: `Presupuesto de ${period} configurado: ${formatMoney(parsed.budget.total, this.options.currency)} en ${parsed.budget.categories.length} categorías y ${fixedExpenses.length} gastos fijos.${suffix}${previousHint}`,
      actionTaken: true
    };
  }

  private confirmPending(message: IncomingMessage): BotReply {
    const pending = this.repo.consumePendingConfirmation(message.groupJid, message.senderJid);
    if (!pending) {
      return { text: 'Recibido. Si querés que registre o cambie algo, mandame el monto, la categoría y una descripción corta.' };
    }
    if (pending.type === 'overbudget') {
      const payload = pending.payload as { period: string; total: number; categories: BudgetCategoryInput[]; fixedExpenses: FixedExpenseInput[]; hole: number };
      this.repo.upsertBudget(payload.period, payload.total, payload.categories, payload.fixedExpenses);
      this.repo.createGoal({
        title: `Cubrir hueco financiero de ${payload.period}`,
        horizon: 'short',
        amount: payload.hole,
        notes: 'Meta automática creada por presupuesto excedido. Cubrir sin tomar deuda.'
      });
      return {
        text: `Guardé el presupuesto de ${payload.period}. También creé una meta corta para cubrir ${formatMoney(payload.hole, this.options.currency)} sin deuda.`,
        actionTaken: true
      };
    }
    if (pending.type === 'unknown_category_expense') {
      return this.confirmUnknownCategoryExpense(message, pending.payload as PendingUnknownCategoryExpense);
    }
    return { text: 'Confirmación recibida, pero no encontré una acción compatible para ejecutar.' };
  }

  private confirmUnknownCategoryExpense(message: IncomingMessage, payload: PendingUnknownCategoryExpense): BotReply {
    const answer = message.text.trim().toLowerCase();
    let categoryName: string | undefined;
    if (/^(crear|crear categoria|crear categoría|nueva|categoria nueva|categoría nueva)\b/.test(answer)) {
      categoryName = payload.requestedCategory;
    } else if (/^varios\b/.test(answer)) {
      categoryName = 'Varios';
    }
    if (!categoryName) {
      this.repo.savePendingConfirmation({
        groupJid: payload.groupJid,
        senderJid: payload.senderJid,
        type: 'unknown_category_expense',
        payload,
        ttlMinutes: 60
      });
      return { text: 'Necesito una de estas dos respuestas: "crear categoría" o "varios".' };
    }
    const category = this.repo.ensureCurrentSharedCategory(categoryName, 0);
    return this.createExpenseReply({ ...payload, category: category.name }, payload.requestedCategory);
  }

  private registerIncome(message: IncomingMessage, parsed: ParsedMessage): BotReply {
    const amount = parsed.income?.amount ?? parsed.amount;
    if (!amount || parsed.confidence < 0.55 || parsed.needsConfirmation) {
      return { text: 'Necesito el monto del ingreso para sumarlo al presupuesto actual.' };
    }
    const result = this.repo.registerIncome({
      amount,
      category: parsed.income?.category ?? parsed.category,
      description: parsed.income?.description ?? parsed.description ?? (message.text || 'Ingreso'),
      senderJid: message.senderJid,
      groupJid: message.groupJid,
      messageId: message.id,
      date: parsed.date
    });
    const summary = this.repo.budgetSummary();
    return {
      text: `Sumé un ingreso de ${formatMoney(amount, this.options.currency)}. Lo asigné a ${result.category}. Disponible: ${summary ? formatMoney(summary.remaining, this.options.currency) : 'sin presupuesto activo'}.`,
      actionTaken: true
    };
  }

  private adjustRemaining(message: IncomingMessage, parsed: ParsedMessage): BotReply {
    if (!parsed.amount || parsed.confidence < 0.55 || parsed.needsConfirmation) {
      return { text: 'Necesito saber cuánto dinero te queda para ajustar el disponible mensual.' };
    }
    const summary = this.repo.budgetSummary();
    if (!summary) return { text: `Todavía no hay presupuesto configurado para ${currentPeriod()}.` };
    const delta = summary.remaining - parsed.amount;
    if (delta <= 0) {
      return { text: `El disponible calculado ya es menor o igual a ${formatMoney(parsed.amount, this.options.currency)}. No hago ajuste automático para aumentar saldo; registrá un ingreso si entró plata.` };
    }
    const expense = this.repo.createAdjustmentExpense({
      amount: delta,
      description: parsed.description ?? `Ajuste por saldo declarado: quedan ${formatMoney(parsed.amount, this.options.currency)}`,
      senderJid: message.senderJid,
      groupJid: message.groupJid,
      messageId: message.id,
      date: parsed.date
    });
    return {
      text: `Registré un ajuste desconocido de ${formatMoney(delta, this.options.currency)} (${expense.publicId}). Ahora quedan ${formatMoney(parsed.amount, this.options.currency)}.`,
      actionTaken: true
    };
  }

  private manageGoal(parsed: ParsedMessage): BotReply {
    const goal = parsed.goal;
    if (!goal) return { text: 'Decime qué querés hacer con tus metas: crear, modificar, borrar o listar.' };
    if (goal.action === 'list') {
      const goals = this.repo.goals('active');
      return {
        text: goals.length
          ? ['Metas activas:', ...goals.map((item) => `- ${horizonLabel(item.horizon)}: ${item.title}${item.targetAmount ? ` (${formatMoney(item.targetAmount, this.options.currency)})` : ''}`)].join('\n')
          : 'No hay metas activas.',
        actionTaken: true
      };
    }
    if (!goal.title) return { text: 'Necesito el nombre o título de la meta.' };
    if (goal.action === 'delete') {
      const deleted = this.repo.deleteGoal(goal.title);
      return { text: deleted ? `Borré la meta “${goal.title}”.` : `No encontré una meta activa llamada “${goal.title}”.`, actionTaken: deleted };
    }
    if (goal.action === 'update') {
      const updated = this.repo.updateGoal({ title: goal.title, horizon: goal.horizon, amount: goal.amount, targetDate: goal.targetDate, notes: goal.notes, status: goal.status });
      return { text: updated ? `Actualicé la meta “${goal.title}”.` : `No encontré una meta activa llamada “${goal.title}”.`, actionTaken: updated };
    }
    const id = this.repo.createGoal({ title: goal.title, horizon: goal.horizon ?? 'short', amount: goal.amount, targetDate: goal.targetDate, notes: goal.notes, status: goal.status });
    return { text: `Creé la meta “${goal.title}” (#${id}).`, actionTaken: true };
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
    return { text: `Listo, asocié este número con ${name}.`, actionTaken: true };
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

function totalBudgetItems(categories: BudgetCategoryInput[], fixedExpenses: FixedExpenseInput[]): number {
  return categories.reduce((sum, item) => sum + item.limit, 0) + fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
}

function horizonLabel(value: string): string {
  if (value === 'short') return 'corto plazo';
  if (value === 'medium') return 'mediano plazo';
  return 'largo plazo';
}

function parseMessageDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
