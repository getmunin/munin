import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Builds a single IIFE bundle the chat widget loads as `<script src=…>`.
 *
 * Output:
 *   dist/widget.<sha>.js       – the bundle, content-hashed for immutable
 *                                CDN/edge caching (cache-control:
 *                                public, max-age=31536000, immutable).
 *   dist/widget.<sha>.js.map   – source map.
 *   dist/manifest.json         – { current: "widget.<sha>.js", sha,
 *                                builtAt }; the backend reads this at
 *                                boot to wire the unhashed redirect.
 *
 * The bundle is fully self-contained — no runtime CSS imports, no async
 * chunks. Operators paste one `<script>` line; that's it.
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
    emptyOutDir: false, // GC handled by clean-widget.mjs (older bundles
    //                     stay around for ~7 days so in-flight clients
    //                     can still fetch the version they were served).
    lib: {
      entry: resolve(__dirname, 'src/widget.ts'),
      name: 'MuninChatWidget',
      formats: ['iife'],
      fileName: () => 'widget.js', // renamed below to widget.<sha>.js
    },
    rollupOptions: {
      output: {
        // Inline all imports into a single file. The widget is small;
        // splitting would force operators to host multiple files.
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    {
      name: 'munin-widget-content-hash',
      writeBundle(_options, bundle) {
        const distDir = resolve(__dirname, 'dist');
        const jsAsset = bundle['widget.js'];
        if (!jsAsset || jsAsset.type !== 'chunk') {
          throw new Error('expected widget.js chunk in bundle');
        }
        const code: string = jsAsset.code;
        const sha = createHash('sha256').update(code).digest('hex').slice(0, 12);

        const sourceJs = join(distDir, 'widget.js');
        const targetJs = join(distDir, `widget.${sha}.js`);
        const sourceMap = join(distDir, 'widget.js.map');
        const targetMap = join(distDir, `widget.${sha}.js.map`);

        renameSync(sourceJs, targetJs);
        try {
          // Patch the //# sourceMappingURL footer to point at the hashed map.
          const patched = readFileSync(targetJs, 'utf8').replace(
            /\/\/# sourceMappingURL=widget\.js\.map/,
            `//# sourceMappingURL=widget.${sha}.js.map`,
          );
          writeFileSync(targetJs, patched);
          renameSync(sourceMap, targetMap);
        } catch {
          // sourcemap may be disabled; ignore
        }

        const manifest = {
          current: `widget.${sha}.js`,
          sha,
          builtAt: new Date().toISOString(),
        };
        writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

        // Prune older hashed bundles in this build's output dir (NOT the
        // backend's public/ — that's GC'd separately so old hashes stay
        // resolvable for ~7 days). Within dist/ we only keep the current.
        for (const file of readdirSync(distDir)) {
          if (file === manifest.current) continue;
          if (file === `${manifest.current}.map`) continue;
          if (file === 'manifest.json') continue;
          if (/^widget\.[a-f0-9]{12}\.js(\.map)?$/.test(file)) {
            unlinkSync(join(distDir, file));
          }
        }
      },
    },
  ],
}));
