import type { Config } from 'tailwindcss';
import muninPreset from '@getmunin/ui/tailwind-preset';

const config: Config = {
  presets: [muninPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../ui/src/**/*.{ts,tsx}'],
};

export default config;
