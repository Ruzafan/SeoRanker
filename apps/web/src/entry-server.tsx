import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { Toaster } from 'sonner';
import { App } from './app';

export { PUBLIC_PAGES } from './public/pages-meta';

/**
 * Render de una página pública para el prerender (build). Mismo árbol que main.tsx para que el
 * cliente pueda hidratar sin diferencias; sin sesión (las consultas no se ejecutan en el servidor).
 */
export function render(url: string): string {
  const queryClient = new QueryClient();
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <StaticRouter location={url}>
          <App />
        </StaticRouter>
        <Toaster richColors closeButton position="top-right" />
      </QueryClientProvider>
    </StrictMode>,
  );
}
