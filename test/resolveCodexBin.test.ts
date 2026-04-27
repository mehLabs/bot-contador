import { describe, expect, it } from 'vitest';
import { resolveCodexBin } from '../src/utils/resolveCodexBin.js';

describe('resolveCodexBin', () => {
  it('respeta rutas explícitas', () => {
    expect(resolveCodexBin('C:/tools/codex.exe')).toBe('C:/tools/codex.exe');
  });

  it('devuelve codex como fallback si no encuentra una ruta mejor', () => {
    const resolved = resolveCodexBin('codex');
    expect(resolved.endsWith('codex') || resolved.endsWith('codex.exe')).toBe(true);
  });
});
