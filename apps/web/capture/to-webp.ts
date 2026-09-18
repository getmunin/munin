import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const artifacts = join(here, '.artifacts');
const out = process.env.MUNIN_CAPTURE_OUT ?? join(repoRoot, '.github/assets/widget-demo.webp');

const fps = process.env.MUNIN_CAPTURE_FPS ?? '12';
const width = process.env.MUNIN_CAPTURE_WIDTH ?? '420';
const quality = process.env.MUNIN_CAPTURE_QUALITY ?? '68';
const start = process.env.MUNIN_CAPTURE_START ?? '0';
const duration = process.env.MUNIN_CAPTURE_DURATION ?? '';

interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function recordedCrop(): string | null {
  const path = join(artifacts, 'widget-crop.json');
  if (!existsSync(path)) return null;
  const box = JSON.parse(readFileSync(path, 'utf8')) as CropBox;
  const even = (n: number): number => (n % 2 === 0 ? n : n - 1);
  return `${even(box.width)}:${even(box.height)}:${box.x}:${box.y}`;
}

function newestVideo(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = newestVideo(path);
      if (nested) found.push(nested);
    } else if (entry.name.endsWith('.webm')) {
      found.push(path);
    }
  }
  if (found.length === 0) return null;
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

const crop = process.env.MUNIN_CAPTURE_CROP ?? recordedCrop() ?? '452:806:972:88';
const source = process.argv[2] ?? newestVideo(artifacts);
if (!source) {
  console.error('no recorded video found — run the widget capture first');
  process.exit(1);
}

const frames = mkdtempSync(join(tmpdir(), 'munin-capture-'));
try {
  const ffmpegArgs = ['-y'];
  if (start !== '0') ffmpegArgs.push('-ss', start);
  ffmpegArgs.push('-i', source);
  if (duration) ffmpegArgs.push('-t', duration);
  ffmpegArgs.push(
    '-vf',
    `crop=${crop},fps=${fps},scale=${width}:-1:flags=lanczos`,
    join(frames, 'f_%04d.png'),
  );
  execFileSync('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'inherit'] });

  const files = readdirSync(frames)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => join(frames, name));
  if (files.length === 0) throw new Error('ffmpeg produced no frames');

  mkdirSync(dirname(out), { recursive: true });
  execFileSync(
    'img2webp',
    [
      '-loop',
      '0',
      '-d',
      String(Math.round(1000 / Number(fps))),
      '-q',
      quality,
      '-m',
      '6',
      ...files,
      '-o',
      out,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );

  console.log(
    `wrote ${out} — ${files.length} frames, ${(statSync(out).size / 1024).toFixed(0)} kB, from ${source}`,
  );
} finally {
  rmSync(frames, { recursive: true, force: true });
}
