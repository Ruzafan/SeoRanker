import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings.js';

describe('parseSettings', () => {
  it('devuelve defaults con {}', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it('conserva lo válido y descarta lo roto', () => {
    const s = parseSettings({ wordCount: 1500, cadence: 'nunca', seeds: ['figuras'] });
    expect(s.wordCount).toBe(1500);
    expect(s.cadence).toBe('off');
    expect(s.seeds).toEqual(['figuras']);
  });
  it('tolera null y tipos raros', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
  });
});
