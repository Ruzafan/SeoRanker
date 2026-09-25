import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ArticleDto,
  ArticleSummaryDto,
  BatchResultDto,
  BillingDto,
  ClusterDto,
  CheckoutResultDto,
  PaidPlanId,
  PerformanceDto,
  SearchConsolePropertyDto,
  SearchConsoleStatusDto,
  ConnectionTestDto,
  CreateSiteInput,
  EnqueuedDto,
  JobRunDto,
  KeywordDto,
  LoginInput,
  OrganizationAdminDto,
  Paginated,
  PatchArticleInput,
  PatchKeywordInput,
  RegisterInput,
  SiteDto,
  SitesOverviewDto,
  SiteStatsDto,
  UpdateSiteInput,
  UsageDto,
  UserDto,
} from '@seo/shared';
import { ApiError, api, qs } from './api';
import { errorText } from './i18n';
import { isJobActive } from './format';

/** Polling de 5 s solo mientras `active` sea true; después se para solo. Nada de polling permanente. */
const POLL_MS = 5000;
const pollWhile =
  <T>(active: (d: T) => boolean) =>
  (q: { state: { data: T | undefined } }): number | false =>
    q.state.data !== undefined && active(q.state.data) ? POLL_MS : false;

// ---- Auth ------------------------------------------------------------------
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<UserDto>('/auth/me'),
    retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 2,
    staleTime: 60_000,
  });

export const useAuthConfig = () =>
  useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<{ registrationOpen: boolean }>('/auth/config'),
  });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<UserDto>('/auth/login', input),
    onSuccess: (u) => qc.setQueryData(['me'], u),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<UserDto>('/auth/register', input),
    onSuccess: (u) => qc.setQueryData(['me'], u),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}

// ---- Sites -----------------------------------------------------------------
export const useSites = () =>
  useQuery({ queryKey: ['sites'], queryFn: () => api.get<SiteDto[]>('/sites') });

export const useSitesOverview = () =>
  useQuery({
    queryKey: ['sites-overview'],
    queryFn: () => api.get<SitesOverviewDto>('/sites/overview'),
    refetchInterval: 30_000,
  });

export const useSite = (siteId: string) =>
  useQuery({ queryKey: ['site', siteId], queryFn: () => api.get<SiteDto>(`/sites/${siteId}`) });

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSiteInput) => api.post<SiteDto>('/sites', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sites'] });
      void qc.invalidateQueries({ queryKey: ['sites-overview'] });
    },
  });
}

export function useUpdateSite(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSiteInput) => api.patch<SiteDto>(`/sites/${siteId}`, input),
    onSuccess: (site) => {
      qc.setQueryData(['site', siteId], site);
      void qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });
}

export function useDeleteSite(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/sites/${siteId}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['site', siteId] });
      return qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });
}

export const useAuthors = (siteId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['site', siteId, 'authors'],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/sites/${siteId}/authors`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useTestConnection = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConnectionTestDto>(`/sites/${siteId}/test-connection`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['site', siteId] }),
  });
};

// ---- Stats, jobs, usage ----------------------------------------------------
export const useStats = (siteId: string) =>
  useQuery({
    queryKey: ['site', siteId, 'stats'],
    queryFn: () => api.get<SiteStatsDto>(`/sites/${siteId}/stats`),
    refetchInterval: pollWhile<SiteStatsDto>((d) => d.inProgress > 0),
  });

export const useUsage = (siteId: string) =>
  useQuery({
    queryKey: ['site', siteId, 'usage'],
    queryFn: () => api.get<UsageDto>(`/sites/${siteId}/usage`),
  });

export const useJobs = (siteId: string, page = 1) =>
  useQuery({
    queryKey: ['site', siteId, 'jobs', page],
    queryFn: () =>
      api.get<Paginated<JobRunDto>>(`/sites/${siteId}/jobs${qs({ page, pageSize: 25 })}`),
    refetchInterval: pollWhile<Paginated<JobRunDto>>((d) => d.items.some(isJobActive)),
  });

/**
 * Cuando el trabajo en curso del sitio termina (inProgress pasa de >0 a 0), refresca todo lo del sitio
 * una vez. Así las pantallas no necesitan polling propio permanente.
 */
export function useRefreshWhenIdle(siteId: string) {
  const qc = useQueryClient();
  const { data } = useStats(siteId);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    if (prev.current !== null && prev.current > 0 && data.inProgress === 0) {
      void qc.invalidateQueries({ queryKey: ['site', siteId] });
    }
    prev.current = data.inProgress;
  }, [data, qc, siteId]);
}

// ---- Keywords --------------------------------------------------------------
export interface KeywordFilters {
  status?: string;
  source?: string;
  clusterId?: string;
  search?: string;
  sort: 'score' | 'createdAt' | 'term' | 'volume' | 'gscImpressions';
  order: 'asc' | 'desc';
  page: number;
}

export const useKeywords = (siteId: string, f: KeywordFilters) =>
  useQuery({
    queryKey: ['site', siteId, 'keywords', f],
    queryFn: () =>
      api.get<Paginated<KeywordDto>>(`/sites/${siteId}/keywords${qs({ ...f, pageSize: 25 })}`),
    placeholderData: (prev) => prev,
    refetchInterval: pollWhile<Paginated<KeywordDto>>((d) =>
      d.items.some((k) => k.status === 'queued' || k.status === 'processing'),
    ),
  });

function useSiteMutation<V, R>(siteId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['site', siteId] }),
  });
}

export const useClusters = (siteId: string) =>
  useQuery({
    queryKey: ['site', siteId, 'clusters'],
    queryFn: () => api.get<ClusterDto[]>(`/sites/${siteId}/clusters`),
  });
export const useRebuildClusters = (siteId: string) =>
  useSiteMutation(siteId, () => api.post<EnqueuedDto>(`/sites/${siteId}/clusters/rebuild`));

export const useAddKeywords = (siteId: string) =>
  useSiteMutation(siteId, (terms: string[]) =>
    api.post<{ created: number; skipped: number }>(`/sites/${siteId}/keywords`, { terms }),
  );
export const useDiscover = (siteId: string) =>
  useSiteMutation(siteId, () => api.post<EnqueuedDto>(`/sites/${siteId}/keywords/discover`));
export const useBatchKeywords = (siteId: string) =>
  useSiteMutation(siteId, (v: { ids: string[]; action: 'queue' | 'discard' }) =>
    api.post<BatchResultDto>(`/sites/${siteId}/keywords/batch`, v),
  );
export const usePatchKeyword = (siteId: string) =>
  useSiteMutation(siteId, (v: { id: string; patch: PatchKeywordInput }) =>
    api.patch<KeywordDto>(`/keywords/${v.id}`, v.patch),
  );
export const useDeleteKeyword = (siteId: string) =>
  useSiteMutation(siteId, (id: string) => api.delete(`/keywords/${id}`));
export const useGenerate = (siteId: string) =>
  useSiteMutation(siteId, (keywordId: string) =>
    api.post<EnqueuedDto>(`/keywords/${keywordId}/generate`),
  );
export const useAnalyzeVoice = (siteId: string) =>
  useSiteMutation(siteId, () => api.post<EnqueuedDto>(`/sites/${siteId}/analyze-voice`));

// ---- Articles --------------------------------------------------------------
const ARTICLE_ACTIVE = new Set(['writing', 'publishing']);

export const useArticles = (siteId: string, status: string | undefined, page: number) =>
  useQuery({
    queryKey: ['site', siteId, 'articles', { status, page }],
    queryFn: () =>
      api.get<Paginated<ArticleSummaryDto>>(
        `/sites/${siteId}/articles${qs({ status, page, pageSize: 25 })}`,
      ),
    placeholderData: (prev) => prev,
    refetchInterval: pollWhile<Paginated<ArticleSummaryDto>>((d) =>
      d.items.some((a) => ARTICLE_ACTIVE.has(a.status)),
    ),
  });

export const useArticle = (id: string) =>
  useQuery({
    queryKey: ['article', id],
    queryFn: () => api.get<ArticleDto>(`/articles/${id}`),
    refetchInterval: pollWhile<ArticleDto>((a) => ARTICLE_ACTIVE.has(a.status)),
  });

function useArticleMutation<V, R>(siteId: string, articleId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['article', articleId] });
      return qc.invalidateQueries({ queryKey: ['site', siteId] });
    },
  });
}

export const usePatchArticle = (siteId: string, id: string) =>
  useArticleMutation(siteId, id, (patch: PatchArticleInput) =>
    api.patch<ArticleDto>(`/articles/${id}`, patch),
  );
export const usePublishArticle = (siteId: string, id: string) =>
  useArticleMutation(siteId, id, () => api.post<EnqueuedDto>(`/articles/${id}/publish`));
export const useRegenerateArticle = (siteId: string, id: string) =>
  useArticleMutation(siteId, id, () => api.post<EnqueuedDto>(`/articles/${id}/regenerate`));
export const useDeleteArticle = (siteId: string, id: string) =>
  useArticleMutation(siteId, id, () => api.delete(`/articles/${id}`));

// ---- Rendimiento y Search Console ----------------------------------------------
export const usePerformance = (siteId: string) =>
  useQuery({
    queryKey: ['site', siteId, 'performance'],
    queryFn: () => api.get<PerformanceDto>(`/sites/${siteId}/performance`),
  });

export const useConnectSearchConsole = (siteId: string) =>
  useMutation({
    mutationFn: () => api.post<{ url: string }>(`/sites/${siteId}/search-console/connect`),
    onSuccess: (res) => window.location.assign(res.url),
  });

export const useSearchConsoleProperties = (siteId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['site', siteId, 'gsc-properties'],
    queryFn: () =>
      api.get<SearchConsolePropertyDto[]>(`/sites/${siteId}/search-console/properties`),
    enabled,
  });

export const useSelectProperty = (siteId: string) =>
  useSiteMutation(siteId, (propertyUrl: string) =>
    api.patch<SearchConsoleStatusDto>(`/sites/${siteId}/search-console`, { propertyUrl }),
  );
export const useDisconnectSearchConsole = (siteId: string) =>
  useSiteMutation(siteId, () => api.delete(`/sites/${siteId}/search-console`));
export const useSyncSite = (siteId: string) =>
  useSiteMutation(siteId, () => api.post<EnqueuedDto>(`/sites/${siteId}/sync`));

// ---- Facturación -------------------------------------------------------------
export const useBilling = () =>
  useQuery({ queryKey: ['billing'], queryFn: () => api.get<BillingDto>('/billing') });

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: PaidPlanId) => api.post<CheckoutResultDto>('/billing/checkout', { plan }),
    onSuccess: (res) => {
      if (res.url) window.location.assign(res.url);
      else {
        void qc.invalidateQueries({ queryKey: ['billing'] });
        void qc.invalidateQueries({ queryKey: ['me'] });
        void qc.invalidateQueries({ queryKey: ['sites-overview'] });
      }
    },
  });
}

export const useBillingPortal = () =>
  useMutation({
    mutationFn: () => api.post<CheckoutResultDto>('/billing/portal'),
    onSuccess: (res) => {
      if (res.url) window.location.assign(res.url);
    },
  });

// ---- Admin -----------------------------------------------------------------
export const useAdminOrgs = (enabled: boolean) =>
  useQuery({
    queryKey: ['admin', 'orgs'],
    queryFn: () => api.get<OrganizationAdminDto[]>('/admin/organizations'),
    enabled,
  });

/** Ejecuta una mutación mostrando el error real (traducido) en un toast. */
export function withToast<T>(p: Promise<T>, okMessage?: string): Promise<T | undefined> {
  return p.then(
    (v) => {
      if (okMessage) toast.success(okMessage);
      return v;
    },
    (err: unknown) => {
      toast.error(errorText(err), {
        description: err instanceof ApiError ? err.detail : undefined,
      });
      return undefined;
    },
  );
}
