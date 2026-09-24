import type { PipelineJobType } from '../queue.js';
import { runBrandVoice } from './brand-voice.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runDiscover } from './discover.js';
import { runOutline } from './outline.js';
import { runPublish } from './publish.js';
import { runWrite } from './write.js';

export * from './context.js';
export * from './quota.js';
export * from './usage.js';
export * from './watchdog.js';
export * from './scheduler.js';
export { isRetryable } from './run-tracked.js';
export { maxTokensFor } from './write.js';

const RUNNERS: Record<PipelineJobType, (ctx: PipelineContext, info: RunInfo) => Promise<void>> = {
  'brand-voice': runBrandVoice,
  discover: runDiscover,
  outline: runOutline,
  write: runWrite,
  publish: runPublish,
};

export function runPipelineJob(
  ctx: PipelineContext,
  type: PipelineJobType,
  info: RunInfo,
): Promise<void> {
  return RUNNERS[type](ctx, info);
}
