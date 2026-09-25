import { describe, expect, it } from 'vitest';
import { analyzeOnPage, type OnPageCheckId } from './onpage.js';
import { isOlderVersion } from './settings.js';

const para = (s: string, n: number) => `<p>${Array.from({ length: n }, () => s).join(' ')}</p>`;

const good = {
  keyword: 'limpiar figuras de resina',
  title: 'Cómo limpiar figuras de resina sin dañarlas: guía paso a paso',
  metaDescription:
    'Aprende a limpiar figuras de resina sin dañar la pintura: materiales, pasos y errores que debes evitar para que tu colección luzca como el primer día.',
  slug: 'limpiar-figuras-resina',
  html:
    '<p>Limpiar figuras de resina es sencillo si sabes qué evitar. Te lo contamos.</p>' +
    '<h2>Materiales para limpiar figuras de resina</h2>' +
    para('Usa un pincel suave y agua tibia con jabón neutro.', 60) +
    '<h2>Pasos</h2>' +
    para('Seca cada pieza con cuidado y guárdala lejos del sol directo.', 50) +
    '<p>Las <a href="https://t.es/a">vitrinas</a> y <a href="https://t.es/b">peanas</a> ayudan.</p>' +
    '<h2>Preguntas frecuentes</h2><h3>¿Puedo usar alcohol?</h3><p>No, daña la pintura de la figura.</p>',
  targetWords: 900,
};

const level = (r: ReturnType<typeof analyzeOnPage>, id: OnPageCheckId) =>
  r.checks.find((c) => c.id === id)?.level;

describe('analyzeOnPage', () => {
  it('un artículo bien optimizado puntúa alto', () => {
    const r = analyzeOnPage(good);
    expect(level(r, 'keyword_in_title')).toBe('good');
    expect(level(r, 'keyword_in_intro')).toBe('good');
    expect(level(r, 'keyword_in_h2')).toBe('good');
    expect(level(r, 'keyword_in_slug')).toBe('good'); // "de" se ignora
    expect(level(r, 'meta_length')).toBe('good');
    expect(level(r, 'internal_links')).toBe('good');
    expect(level(r, 'faq_section')).toBe('good');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it('detecta título sin keyword, meta ausente, texto corto y sin enlaces', () => {
    const r = analyzeOnPage({
      ...good,
      title: 'Guía',
      metaDescription: null,
      html: '<p>Texto breve.</p>',
    });
    expect(level(r, 'keyword_in_title')).toBe('bad');
    expect(level(r, 'meta_length')).toBe('bad');
    expect(level(r, 'word_count')).toBe('bad');
    expect(level(r, 'internal_links')).toBe('bad');
    expect(r.score).toBeLessThan(40);
  });

  it('la densidad mide la frase completa y avisa del exceso', () => {
    const stuffed = analyzeOnPage({
      ...good,
      html: para('limpiar figuras de resina hoy', 50),
    });
    const d = stuffed.checks.find((c) => c.id === 'keyword_density');
    expect(d?.level).toBe('bad');
    expect(d?.value).toBeGreaterThan(3.5);
  });

  it('sin keyword solo evalúa lo que no depende de ella', () => {
    const r = analyzeOnPage({ ...good, keyword: null });
    expect(r.checks.some((c) => c.id.startsWith('keyword_'))).toBe(false);
  });
});

describe('isOlderVersion', () => {
  it('compara x.y.z numéricamente', () => {
    expect(isOlderVersion('1.0.0', '1.1.0')).toBe(true);
    expect(isOlderVersion('1.10.0', '1.9.9')).toBe(false);
    expect(isOlderVersion('1.1', '1.1.0')).toBe(false);
  });
});
