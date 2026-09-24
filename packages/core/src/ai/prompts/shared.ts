export interface SiteContext {
  name: string;
  url: string;
  language: string;
  country: string;
  brandVoice: string | null;
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Prompt de sistema compuesto por sitio. No hay nada de una tienda concreta aquí:
 * todo lo específico viene de la voz de marca guardada en el sitio.
 */
export function composeSystemPrompt(site: SiteContext, role: string): string {
  const lang = languageName(site.language);
  const parts = [
    role,
    `You work for the website "${site.name}" (${site.url}). Target audience: ${lang}-speaking readers in ${site.country}.`,
    `Always write in ${lang}. Use natural, native phrasing; never translate literally from English.`,
  ];
  if (site.brandVoice?.trim()) {
    parts.push(
      `Brand voice profile — follow it faithfully:\n<brand_voice>\n${site.brandVoice.trim()}\n</brand_voice>`,
    );
  }
  return parts.join('\n\n');
}
