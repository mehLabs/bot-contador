import { describe, expect, it } from 'vitest';
import { ParsedMessageSchema } from '../src/types.js';

describe('ParsedMessageSchema', () => {
  it('acepta nuevos intents', () => {
    for (const intent of ['help', 'financial_advice', 'bot_question', 'register_income', 'adjust_remaining', 'register_credit_card_expense', 'manage_goal', 'setup_next_budget']) {
      expect(ParsedMessageSchema.parse({ intent, confidence: 1 }).intent).toBe(intent);
    }
  });

  it('acepta datos estructurados nuevos', () => {
    const parsed = ParsedMessageSchema.parse({
      intent: 'setup_budget',
      confidence: 1,
      budget: {
        total: 100000,
        categories: [{ name: 'Comida', limit: 30000, kind: 'shared' }],
        fixedExpenses: [{ name: 'Alquiler', amount: 50000, source: 'manual' }]
      },
      goal: { action: 'create', title: 'Fondo', horizon: 'short', amount: 10000 },
      income: { amount: 20000, category: 'Sin asignar' },
      creditCard: { name: 'Visa' }
    });
    expect(parsed.budget?.fixedExpenses[0]?.name).toBe('Alquiler');
    expect(parsed.goal?.horizon).toBe('short');
    expect(parsed.income?.amount).toBe(20000);
    expect(parsed.creditCard?.name).toBe('Visa');
  });

  it('acepta disponibilidad con categoría', () => {
    const parsed = ParsedMessageSchema.parse({
      intent: 'availability',
      confidence: 1,
      category: 'Comida'
    });
    expect(parsed.category).toBe('Comida');
  });
});
