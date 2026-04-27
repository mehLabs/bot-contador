import { describe, expect, it, vi } from 'vitest';
import { typingDelayMs } from '../src/utils/typing.js';

describe('typingDelayMs', () => {
  it('respeta mínimo y máximo', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(typingDelayMs('hola')).toBeGreaterThanOrEqual(900);
    expect(typingDelayMs('x'.repeat(1000))).toBeLessThanOrEqual(9000);
    vi.restoreAllMocks();
  });
});
