import { ParsedMessage } from '../types.js';

export function shouldRouteToAgent(text: string): boolean {
  return /^\/agente(?:\s|$)/i.test(text.trim());
}

export function agentParsedMessage(): ParsedMessage {
  return {
    intent: 'bot_question',
    confidence: 1,
    amount: null,
    category: null,
    description: null,
    personName: null,
    date: null,
    expenseRef: null,
    correction: null,
    creditCard: null,
    income: null,
    goal: null,
    budget: null,
    missingFields: [],
    needsConfirmation: false,
    naturalReplyHint: null
  };
}
