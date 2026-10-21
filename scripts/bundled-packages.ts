/*
 * opensource.5: a Vite plugin that records which npm packages each build put
 * into its bundle. electron-builder copies the production dependencies into the
 * asar as they are, but the window's script carries React, zustand and the diff
 * libraries inside it, and nothing else would list them. Each build (main,
 * preload, renderer) writes `bundled-packages.json` into its own folder under
 * `out/`, which Vite empties first, so the file never outlives its bundle.
 * `scripts/third-party-notices.ts` reads all three.
 */

import path from 'node:path';
import type { Plugin } from 'vite';

/** The record's name; third-party-notices.ts has its own copy, which a test pins equal. */
export const BUNDLED_PACKAGES_FILE = 'bundled-packages.json';

/**
 * The folder of the npm package a module id comes from, relative to `root` with
 * forward slashes, or undefined for the project's own code and Vite's virtual
 * modules. A package inside another's node_modules is named by the innermost.
 */
export function packageDirOf(id: string, root: string): string | undefined {
  const file = id.replace(/^\0/, '').replace(/\?.*$/, '').replace(/\\/g, '/');
  const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file);
  return match?.[1] ? path.relative(root, match[1]).replace(/\\/g, '/') : undefined;
}

export function bundledPackages(root: string): Plugin {
  return {
    name: 'bundled-packages',
    generateBundle(_options, bundle) {
      const dirs = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          const dir = packageDirOf(id, root);
          if (dir) dirs.add(dir);
        }
      }
      const source = `${JSON.stringify({ packages: [...dirs].sort() }, null, 2)}\n`;
      this.emitFile({ type: 'asset', fileName: BUNDLED_PACKAGES_FILE, source });
    }
  };
}
