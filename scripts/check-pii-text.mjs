#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { scanText, renderProblems } from './lib/pii.mjs';

const [, , source, label] = process.argv;
const surface = label ?? 'Text';

const text = source && source !== '-' ? readFileSync(source, 'utf8') : readFileSync(0, 'utf8');
const problems = scanText(text, { hostnames: true });

if (problems.length === 0) process.exit(0);

console.error(renderProblems(problems, { surface }));
process.exit(1);
