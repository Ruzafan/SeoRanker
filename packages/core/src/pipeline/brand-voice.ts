import { AppError } from '../errors.js';
import {
  brandVoiceSchema,
  brandVoiceSystem,
  brandVoiceToolDescription,
  brandVoiceUser,
  BRAND_VOICE_PROMPT_VERSION,
} from '../ai/prompts/brand-voice.js';
import { adapterFor, loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

const SAMPLE_COUNT = 12;

export function runBrandVoice(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    const site = await loadSite(ctx, info.siteId);
    const adapter = adapterFor(ctx, site);
    const samples = await adapter.getSamples(SAMPLE_COUNT);
    if (samples.length === 0) {
      throw new AppError('INVALID_STATE', 'The site has no published content to analyse', {
        httpStatus: 409,
      });
    }
    const model = modelFor(ctx, site);
    const result = await ctx.claude.callTool({
      model,
      system: brandVoiceSystem(siteContext(site)),
      user: brandVoiceUser(samples),
      maxTokens: 2500,
      toolDescription: brandVoiceToolDescription,
      schema: brandVoiceSchema,
    });
    await tracker.add(result.model, result.usage);
    await ctx.prisma.site.update({
      where: { id: site.id },
      data: { brandVoice: result.data.profile },
    });
    return { meta: { samples: samples.length, prompt: BRAND_VOICE_PROMPT_VERSION } };
  });
}
