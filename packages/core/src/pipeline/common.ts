import type { Site } from '@seo/db';
import { parseSettings } from '@seo/shared';
import type { PublishingAdapter } from '../adapters/index.js';
import { createAdapter } from '../adapters/factory.js';
import type { SiteContext } from '../ai/prompts/shared.js';
import { DataForSeoProvider, type KeywordMetricsProvider } from '../keywords/metrics.js';
import { notFound } from '../errors.js';
import type { PipelineContext } from './context.js';

export async function loadSite(ctx: PipelineContext, siteId: string): Promise<Site> {
  const site = await ctx.prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw notFound('Site');
  return site;
}

export function siteContext(site: Site): SiteContext {
  return {
    name: site.name,
    url: site.url,
    language: site.language,
    country: site.country,
    brandVoice: site.brandVoice,
    expertise: parseSettings(site.settings).expertise,
  };
}

export function metricsProviderFor(ctx: PipelineContext): KeywordMetricsProvider | null {
  const c = ctx.config.dataForSeo;
  return c ? new DataForSeoProvider(c.login, c.password, ctx.fetchFn ?? fetch) : null;
}

export function modelFor(ctx: PipelineContext, site: Site): string {
  return parseSettings(site.settings).model ?? ctx.config.defaultModel;
}

export function adapterFor(ctx: PipelineContext, site: Site): PublishingAdapter {
  if (ctx.adapterFactory) return ctx.adapterFactory(site);
  return createAdapter(site, {
    encryptionKey: ctx.encryptionKey,
    allowPrivateHosts: ctx.config.allowPrivateHosts,
    fetchFn: ctx.fetchFn,
  });
}
