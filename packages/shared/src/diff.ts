/** Trozo de un diff palabra a palabra: igual, quitado (solo en el antes) o añadido (solo en el después). */
export interface DiffPart {
  op: 'equal' | 'removed' | 'added';
  text: string;
}

/**
 * Palabras, espacios y signos sueltos (así el texto se reconstruye tal cual). Los signos van
 * aparte para que "Gryffindor." → "Gryffindor de…" marque solo el punto, no la palabra entera.
 */
const tokenize = (s: string) => s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];

/**
 * Diff palabra a palabra por la subsecuencia común más larga, como el de git en modo palabra.
 * Pensado para textos cortos (metas, títulos, descripciones cortas): O(n·m).
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] =
        a[i] === b[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, row[j + 1] as number);
    }
  }
  const parts: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += text;
    else parts.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('equal', a[i] as string);
      i++;
      j++;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      push('removed', a[i++] as string);
    } else {
      push('added', b[j++] as string);
    }
  }
  while (i < a.length) push('removed', a[i++] as string);
  while (j < b.length) push('added', b[j++] as string);
  return parts;
}
