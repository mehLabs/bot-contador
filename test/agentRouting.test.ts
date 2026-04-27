import { describe, expect, it } from 'vitest';
import { agentParsedMessage, shouldRouteToAgent } from '../src/bot/agentRouting.js';

describe('agentRouting', () => {
  it('deriva al agente con invocacion explicita', () => {
    expect(shouldRouteToAgent('/agente revisá todo')).toBe(true);
    expect(agentParsedMessage().intent).toBe('bot_question');
  });

  it('no infiere acciones multiples localmente', () => {
    expect(shouldRouteToAgent('gasté 5000 en comida y decime cuánto queda')).toBe(false);
    expect(shouldRouteToAgent('registrá un ingreso de 100000 y creá una meta corta')).toBe(false);
  });

  it('mantiene acciones simples en el flujo deterministico', () => {
    expect(shouldRouteToAgent('gasté 5000 en comida')).toBe(false);
    expect(shouldRouteToAgent('presupuesto 150000, comida 20000, transporte 30000')).toBe(false);
  });
});
