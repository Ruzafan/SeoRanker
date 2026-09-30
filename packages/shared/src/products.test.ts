import { describe, expect, it } from 'vitest';
import { wordDiff } from './diff.js';
import { diagnoseProduct, type ProductSnapshot } from './products.js';

const base: ProductSnapshot = {
  id: 1,
  name: 'Taza Hogwarts',
  url: 'https://t.es/taza',
  status: 'publish',
  shortDescription: '<p>Taza de cerámica.</p>',
  description: 'palabra '.repeat(80),
  categories: ['Tazas'],
  tags: ['harry potter', 'tazas'],
  price: '12.95',
  images: [{ id: 5, url: 'https://t.es/a.jpg', alt: 'Taza' }],
  seoPlugin: 'yoast',
  focusKeyword: 'taza hogwarts',
  seoTitle: 'Taza Hogwarts de cerámica',
  metaDescription:
    'Taza de Hogwarts de cerámica de 350 ml, apta para lavavajillas. Envío en 24 h a toda España.',
};

describe('diagnoseProduct', () => {
  it('un producto completo no tiene problemas', () => {
    expect(diagnoseProduct(base)).toEqual({ score: 100, issues: [] });
  });
  it('detecta huecos y resta puntos', () => {
    const r = diagnoseProduct({
      ...base,
      focusKeyword: '',
      metaDescription: '',
      shortDescription: '<p> </p>',
      images: [...base.images, { id: 6, url: 'x', alt: '' }],
      tags: [],
      description: 'poco',
    });
    expect(r.issues).toEqual([
      'NO_FOCUS_KEYWORD',
      'NO_META_DESCRIPTION',
      'NO_SHORT_DESCRIPTION',
      'IMAGES_WITHOUT_ALT',
      'FEW_TAGS',
      'THIN_DESCRIPTION',
    ]);
    expect(r.score).toBe(24);
  });
  it('sin plugin SEO no evalúa sus campos', () => {
    expect(diagnoseProduct({ ...base, seoPlugin: null, metaDescription: '' }).issues).toEqual([
      'NO_SEO_PLUGIN',
    ]);
  });
});

describe('wordDiff', () => {
  it('marca palabras quitadas y añadidas y reconstruye ambos textos', () => {
    const before = 'Taza de cerámica para café';
    const after = 'Taza de cerámica Hogwarts para té';
    const parts = wordDiff(before, after);
    expect(
      parts
        .filter((p) => p.op !== 'added')
        .map((p) => p.text)
        .join(''),
    ).toBe(before);
    expect(
      parts
        .filter((p) => p.op !== 'removed')
        .map((p) => p.text)
        .join(''),
    ).toBe(after);
    expect(parts.filter((p) => p.op === 'added').map((p) => p.text.trim())).toEqual([
      'Hogwarts',
      'té',
    ]);
    expect(parts.filter((p) => p.op === 'removed').map((p) => p.text.trim())).toEqual(['café']);
  });
  it('la puntuación va aparte: cambiar el punto final no marca la palabra', () => {
    const parts = wordDiff('Bufanda Gryffindor.', 'Bufanda Gryffindor de punto.');
    expect(parts.filter((p) => p.op === 'removed')).toEqual([]);
    expect(parts.filter((p) => p.op === 'added').map((p) => p.text)).toEqual([' de punto']);
  });
  it('texto vacío: todo añadido', () => {
    expect(wordDiff('', 'hola mundo')).toEqual([{ op: 'added', text: 'hola mundo' }]);
  });
});
