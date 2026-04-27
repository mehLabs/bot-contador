import { describe, expect, it } from 'vitest';
import { ParsedMessageSchema } from '../src/types.js';

describe('ParsedMessageSchema', () => {
  it('acepta nuevos intents', () => {
    for (const intent of ['help', 'financial_advice', 'bot_question']) {
      expect(ParsedMessageSchema.parse({ intent, confidence: 1 }).intent).toBe(intent);
    }
  });
});
