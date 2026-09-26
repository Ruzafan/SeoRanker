import { describe, expect, it } from 'vitest';
import { dedupeSimilar, findCannibal, sameIntent, similarity, tokens } from './similarity.js';

describe('similitud de búsquedas', () => {
  it('ignora acentos, palabras vacías y plurales', () => {
    expect([...tokens('Cómo limpiar las figuras de resina')]).toEqual([
      'limpiar',
      'figura',
      'resina',
    ]);
    expect([...tokens('clases')]).toEqual([...tokens('clase')]);
    expect([...tokens('colores')]).toEqual([...tokens('color')]);
  });

  it('misma intención: casi las mismas palabras o contenida con una de diferencia', () => {
    expect(sameIntent('cómo limpiar figuras de resina', 'limpiar figura resina')).toBe(true);
    expect(sameIntent('figuras de resina', 'figuras de resina baratas')).toBe(true);
    expect(sameIntent('figuras de resina', 'cómo pintar figuras de resina a mano')).toBe(false);
    expect(sameIntent('vitrinas para figuras', 'limpiar figuras de resina')).toBe(false);
    expect(sameIntent('resina', 'resina epoxi')).toBe(false); // una palabra no basta
    expect(similarity('a', 'b')).toBe(0);
  });

  it('findCannibal encuentra el artículo por su keyword o su título', () => {
    const targets = [
      { id: 'a1', texts: ['vitrinas con luz led', 'Las mejores vitrinas LED para coleccionistas'] },
      { id: 'a2', texts: ['limpiar figuras de resina'] },
    ];
    expect(findCannibal('como limpiar una figura de resina', targets)?.id).toBe('a2');
    expect(findCannibal('mejores vitrinas led coleccionistas', targets)?.id).toBe('a1');
    expect(findCannibal('pintar miniaturas', targets)).toBeNull();
  });

  it('dedupeSimilar se queda con la de mayor puntuación de cada grupo', () => {
    const out = dedupeSimilar([
      { term: 'figura de resina', score: 40 },
      { term: 'figuras de resina', score: 70 },
      { term: 'vitrinas led', score: 50 },
    ]);
    expect(out.map((o) => o.term)).toEqual(['figuras de resina', 'vitrinas led']);
  });
});
