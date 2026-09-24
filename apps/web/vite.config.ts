import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      '/api': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // Anotaciones /*#__PURE__*/ de librerías de terceros que Rollup no sabe interpretar: ruido.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules')) return;
        warn(warning);
      },
    },
  },
});
