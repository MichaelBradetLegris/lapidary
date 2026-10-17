import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { APP_NAME } from './src/shared/branding';

const root = process.cwd();

/**
 * index.html cannot import a TypeScript constant, so the placeholder is
 * substituted here instead. The app's name is written down once, in
 * src/shared/branding.ts.
 */
const appNamePlugin = {
  name: 'app-name-in-html',
  transformIndexHtml(html: string): string {
    return html.replace(/__APP_NAME__/g, APP_NAME);
  }
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react(), appNamePlugin],
    // Declared up front so the dev server never discovers a dependency mid-session
    // and reloads with two copies of React live at once.
    optimizeDeps: {
      include: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        'zustand',
        'diff',
        'diff-match-patch'
      ]
    },
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/renderer/index.html') }
      }
    }
  }
});
