import { Inject, Injectable, Logger } from '@nestjs/common';
import { AGENT_CONFIG_REPOSITORY } from './injection-tokens.ts';
import type { AgentConfigRepository } from './config.repository.ts';
import { authHeaders } from './provider-auth.ts';

const CACHE_TTL_MS = 10 * 60 * 1000;

export interface ModelEntry {
  id: string;
  contextLength: number | null;
  promptCostPerMillion: number | null;
  completionCostPerMillion: number | null;
}

export interface ListModelsResult {
  supported: boolean;
  models: ModelEntry[];
  fetchedAt: string;
}

interface CacheEntry {
  result: ListModelsResult;
  expiresAt: number;
}

@Injectable()
export class AgentModelsService {
  private readonly logger = new Logger(AgentModelsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly repo: AgentConfigRepository,
  ) {}

  async listForCurrentActor(): Promise<ListModelsResult> {
    const id = this.repo.resolveCurrentId();
    const config = await this.repo.read(id);
    const apiKey = await this.repo.readDecryptedProviderKey(id);
    if (!apiKey) {
      return { supported: false, models: [], fetchedAt: new Date().toISOString() };
    }

    const cacheKey = `${id}|${config.providerBaseUrl}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const result = await this.fetchModels(config.providerBaseUrl, apiKey);
    this.cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  private async fetchModels(baseUrl: string, apiKey: string): Promise<ListModelsResult> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: authHeaders(baseUrl, apiKey),
      });
    } catch (err) {
      this.logger.warn(`fetch ${url} failed: ${describe(err)}`);
      return { supported: false, models: [], fetchedAt: new Date().toISOString() };
    }
    if (!res.ok) {
      this.logger.warn(`${url} returned ${res.status}`);
      return { supported: false, models: [], fetchedAt: new Date().toISOString() };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      this.logger.warn(`${url} returned non-JSON: ${describe(err)}`);
      return { supported: false, models: [], fetchedAt: new Date().toISOString() };
    }
    const models = parseOpenAiCompatModels(body);
    if (!models) {
      return { supported: false, models: [], fetchedAt: new Date().toISOString() };
    }
    return {
      supported: true,
      models,
      fetchedAt: new Date().toISOString(),
    };
  }
}

function parseOpenAiCompatModels(body: unknown): ModelEntry[] | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const out: ModelEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string') continue;
    out.push({
      id,
      contextLength: readContextLength(item),
      promptCostPerMillion: readPromptCost(item),
      completionCostPerMillion: readCompletionCost(item),
    });
  }
  return out;
}

function readContextLength(item: unknown): number | null {
  if (!item || typeof item !== 'object') return null;
  const candidate = (item as Record<string, unknown>)['context_length'];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function readPromptCost(item: unknown): number | null {
  if (!item || typeof item !== 'object') return null;
  const pricing = (item as Record<string, unknown>)['pricing'];
  if (!pricing || typeof pricing !== 'object') return null;
  const raw = (pricing as Record<string, unknown>)['prompt'];
  return parsePerMillion(raw);
}

function readCompletionCost(item: unknown): number | null {
  if (!item || typeof item !== 'object') return null;
  const pricing = (item as Record<string, unknown>)['pricing'];
  if (!pricing || typeof pricing !== 'object') return null;
  const raw = (pricing as Record<string, unknown>)['completion'];
  return parsePerMillion(raw);
}

function parsePerMillion(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : null;
  if (n === null || !Number.isFinite(n)) return null;
  return n * 1_000_000;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
