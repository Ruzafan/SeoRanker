import type { Article, JobRun, Keyword, Site } from '@seo/db';
import {
  parseSettings,
  type ArticleDto,
  type ArticleStatus,
  type ArticleSummaryDto,
  type JobRunDto,
  type JobType,
  type KeywordDto,
  type KeywordStatus,
  type SiteDto,
} from '@seo/shared';

/** Nunca incluye `credentials`: solo el booleano `hasCredentials`. */
export function toSiteDto(site: Site): SiteDto {
  return {
    id: site.id,
    name: site.name,
    url: site.url,
    platform: site.platform,
    language: site.language,
    country: site.country,
    brandVoice: site.brandVoice,
    settings: parseSettings(site.settings),
    hasCredentials: site.credentials.length > 0,
    active: site.active,
    createdAt: site.createdAt.toISOString(),
  };
}

export function toKeywordDto(k: Keyword): KeywordDto {
  return {
    id: k.id,
    siteId: k.siteId,
    term: k.term,
    source: k.source,
    intent: k.intent,
    score: k.score,
    status: k.status as KeywordStatus,
    seedTerm: k.seedTerm,
    volume: k.volume,
    difficulty: k.difficulty,
    cpc: k.cpc,
    gscImpressions: k.gscImpressions,
    gscClicks: k.gscClicks,
    gscPosition: k.gscPosition,
    createdAt: k.createdAt.toISOString(),
  };
}

export function toArticleSummary(a: Article): ArticleSummaryDto {
  return {
    id: a.id,
    siteId: a.siteId,
    keywordId: a.keywordId,
    title: a.title,
    slug: a.slug,
    status: a.status as ArticleStatus,
    wordCount: a.wordCount,
    remoteUrl: a.remoteUrl,
    remoteStatus: a.remoteStatus,
    decayDetectedAt: a.decayDetectedAt?.toISOString() ?? null,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    updatedAt: a.updatedAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}

export function toArticleDto(a: Article): ArticleDto {
  return {
    ...toArticleSummary(a),
    metaDescription: a.metaDescription,
    contentHtml: a.contentHtml,
    outline: (a.outline as ArticleDto['outline']) ?? null,
    remotePostId: a.remotePostId,
  };
}

export function toJobRunDto(j: JobRun): JobRunDto {
  return {
    id: j.id,
    siteId: j.siteId,
    type: j.type as JobType,
    status: j.status as JobRunDto['status'],
    refId: j.refId,
    attempt: j.attempt,
    error: j.error,
    meta: (j.meta as Record<string, unknown> | null) ?? null,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
  };
}
