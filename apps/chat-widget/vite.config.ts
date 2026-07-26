import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

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
      entry: resolve(__dirname, 'src/widget.ts'),
      name: 'MuninChatWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: {
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
          const patched = readFileSync(targetJs, 'utf8').replace(
            /\/\/# sourceMappingURL=widget\.js\.map/,
            `//# sourceMappingURL=widget.${sha}.js.map`,
          );
          writeFileSync(targetJs, patched);
          renameSync(sourceMap, targetMap);
        } catch {}

        const manifest = {
          current: `widget.${sha}.js`,
          sha,
          builtAt: new Date().toISOString(),
        };
        writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

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
