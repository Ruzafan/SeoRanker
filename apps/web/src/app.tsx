import { Navigate, Route, Routes } from 'react-router-dom';
import { PlainLayout, SiteLayout } from './components/layout';
import { Spinner } from './components/ui';
import { useMe } from './lib/hooks';
import { AdminPage } from './pages/admin';
import { ArticleEditorPage } from './pages/article-editor';
import { ArticlesPage } from './pages/articles';
import { BillingPage } from './pages/billing';
import { BrandVoicePage } from './pages/brand-voice';
import { DashboardPage } from './pages/dashboard';
import { JobsPage } from './pages/jobs';
import { KeywordsPage } from './pages/keywords';
import { LandingPage } from './pages/landing';
import { LoginPage } from './pages/login';
import { PerformancePage } from './pages/performance';
import { SettingsPage } from './pages/settings';
import { HomeRedirect, NewSitePage, SitesPage } from './pages/sites';
import { ApiError } from './lib/api';
import { ErrorBanner } from './components/ui';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useMe();
  if (isLoading) return <Spinner />;
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  if (error)
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorBanner error={error} />
      </div>
    );
  return data ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <PlainLayout />
          </RequireAuth>
        }
      >
        <Route path="/app" element={<HomeRedirect />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/sites/new" element={<NewSitePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/billing" element={<BillingPage />} />
      </Route>
      <Route
        path="/sites/:siteId"
        element={
          <RequireAuth>
            <SiteLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="keywords" element={<KeywordsPage />} />
        <Route path="articles" element={<ArticlesPage />} />
        <Route path="articles/:articleId" element={<ArticleEditorPage />} />
        <Route path="voice" element={<BrandVoicePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="jobs" element={<JobsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
