import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Builds a single IIFE bundle the analytics tracker loads as
 * `<script src=…>`. Mirrors the chat-widget pipeline.
 *
 * Output:
 *   dist/tracker.<sha>.js       – the bundle, content-hashed for
 *                                 immutable CDN caching.
 *   dist/tracker.<sha>.js.map   – source map.
 *   dist/manifest.json          – { current: "tracker.<sha>.js", sha,
 *                                 builtAt }; the backend reads this at
 *                                 boot to wire the unhashed redirect.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    conditions: mode === 'development' ? ['development'] : [],
  },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    sourcemap: true,
    minify: 'esbuild',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/tracker.ts'),
      name: 'MuninAnalyticsTracker',
      formats: ['iife'],
      fileName: () => 'tracker.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    {
      name: 'munin-tracker-content-hash',
      writeBundle(_options, bundle) {
        const distDir = resolve(__dirname, 'dist');
        const jsAsset = bundle['tracker.js'];
        if (!jsAsset || jsAsset.type !== 'chunk') {
          throw new Error('expected tracker.js chunk in bundle');
        }
        const code: string = jsAsset.code;
        const sha = createHash('sha256').update(code).digest('hex').slice(0, 12);

        const sourceJs = join(distDir, 'tracker.js');
        const targetJs = join(distDir, `tracker.${sha}.js`);
        const sourceMap = join(distDir, 'tracker.js.map');
        const targetMap = join(distDir, `tracker.${sha}.js.map`);

        renameSync(sourceJs, targetJs);
        try {
          const patched = readFileSync(targetJs, 'utf8').replace(
            /\/\/# sourceMappingURL=tracker\.js\.map/,
            `//# sourceMappingURL=tracker.${sha}.js.map`,
          );
          writeFileSync(targetJs, patched);
          renameSync(sourceMap, targetMap);
        } catch {
          // sourcemap may be disabled; ignore
        }

        const manifest = {
          current: `tracker.${sha}.js`,
          sha,
          builtAt: new Date().toISOString(),
        };
        writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

        for (const file of readdirSync(distDir)) {
          if (file === manifest.current) continue;
          if (file === `${manifest.current}.map`) continue;
          if (file === 'manifest.json') continue;
          if (/^tracker\.[a-f0-9]{12}\.js(\.map)?$/.test(file)) {
            unlinkSync(join(distDir, file));
          }
        }
      },
    },
  ],
}));
