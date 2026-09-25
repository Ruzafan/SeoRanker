import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App } from './app';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró #root');

const tree = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster richColors closeButton position="top-right" />
    </QueryClientProvider>
  </StrictMode>
);

// Páginas públicas prerenderizadas (landing, ejemplo…): se hidratan. El panel arranca vacío.
if (root.hasChildNodes()) hydrateRoot(root, tree);
else createRoot(root).render(tree);
