import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { describeError, safeFetch } from '@getmunin/core';
import { stripTrailingSlashes } from '@getmunin/types';
import { AGENT_CONFIG_REPOSITORY, DEFAULT_PROVIDER_MODELS } from './injection-tokens.ts';
import type { AgentConfigRepository } from './config.repository.ts';
import { authHeaders } from './provider-auth.ts';

const CACHE_TTL_MS = 10 * 60 * 1000;

export interface ModelEntry {
  id: string;
  contextLength: number | null;
  promptCostPerMillion: number | null;
  completionCostPerMillion: number | null;
  supportsVision: boolean | null;
}

export interface ProviderModelOffer {
  id: string;
  supportsVision?: boolean;
}

export type ProviderModelOffering = string | ProviderModelOffer;

export interface ListModelsResult {
  supported: boolean;
  models: ModelEntry[];
  fetchedAt: string;
}

interface CacheEntry {
  result: ListModelsResult;
  expiresAt: number;
}

export interface ProviderModelLister {
  listForProvider(id: string, baseUrl: string, apiKey: string): Promise<ListModelsResult>;
  invalidate(id: string): void;
}

@Injectable()
export class AgentModelsService implements ProviderModelLister {
  private readonly logger = new Logger(AgentModelsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly repo: AgentConfigRepository,
    @Optional()
    @Inject(DEFAULT_PROVIDER_MODELS)
    private readonly defaultProviderModels: readonly ProviderModelOffering[] = [],
  ) {}

  async listForCurrentActor(): Promise<ListModelsResult> {
    const id = this.repo.resolveCurrentId();
    const apiKey = await this.repo.readDecryptedProviderKey(id);
    if (!apiKey) {
      return {
        supported: this.defaultProviderModels.length > 0,
        models: this.defaultProviderModels.map(toModelEntry),
        fetchedAt: new Date().toISOString(),
      };
    }
    const config = await this.repo.read(id);
    return this.listForProvider(id, config.providerBaseUrl, apiKey);
  }

  async listForProvider(id: string, baseUrl: string, apiKey: string): Promise<ListModelsResult> {
    const cacheKey = `${id}|${baseUrl}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const result = await this.fetchModels(baseUrl, apiKey);
    this.cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  async supportsVisionFor(modelId: string): Promise<boolean | null> {
    if (!modelId) return null;
    try {
      const listing = await this.listForCurrentActor();
      if (!listing.supported) return null;
      return listing.models.find((m) => m.id === modelId)?.supportsVision ?? null;
    } catch (err) {
      this.logger.warn(`vision capability lookup failed for ${modelId}: ${describeError(err)}`);
      return null;
    }
  }

  invalidate(id: string): void {
    const prefix = `${id}|`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  private async fetchModels(baseUrl: string, apiKey: string): Promise<ListModelsResult> {
    const url = `${stripTrailingSlashes(baseUrl)}/models`;
    let res: Awaited<ReturnType<typeof safeFetch>>;
    try {
      res = await safeFetch(url, {
        method: 'GET',
        headers: authHeaders(baseUrl, apiKey),
      });
    } catch (err) {
      this.logger.warn(`fetch ${url} failed: ${describeError(err)}`);
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
      this.logger.warn(`${url} returned non-JSON: ${describeError(err)}`);
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

export function normalizeProviderModels(
  models: readonly ProviderModelOffering[] | undefined,
): string[] {
  if (!models) return [];
  const seen = new Set<string>();
  for (const model of models) {
    const trimmed = offeringId(model).trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen];
}

export function normalizeProviderOfferings(
  models: readonly ProviderModelOffering[] | undefined,
): ProviderModelOffer[] {
  if (!models) return [];
  const byId = new Map<string, ProviderModelOffer>();
  for (const model of models) {
    const id = offeringId(model).trim();
    if (id.length === 0 || byId.has(id)) continue;
    byId.set(id, typeof model === 'string' ? { id } : { ...model, id });
  }
  return [...byId.values()];
}

function offeringId(model: ProviderModelOffering): string {
  return typeof model === 'string' ? model : model.id;
}

function toModelEntry(model: ProviderModelOffering): ModelEntry {
  return {
    id: offeringId(model),
    contextLength: null,
    promptCostPerMillion: null,
    completionCostPerMillion: null,
    supportsVision: typeof model === 'string' ? null : model.supportsVision ?? null,
  };
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
      supportsVision: readSupportsVision(item),
    });
  }
  return out;
}

export function readSupportsVision(item: unknown): boolean | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;

  const architecture = record['architecture'];
  if (architecture && typeof architecture === 'object') {
    const modalities = (architecture as Record<string, unknown>)['input_modalities'];
    if (Array.isArray(modalities)) {
      return modalities.some((m) => typeof m === 'string' && m.toLowerCase() === 'image');
    }
  }

  const capabilities = record['capabilities'];
  if (capabilities && typeof capabilities === 'object') {
    const imageInput = (capabilities as Record<string, unknown>)['image_input'];
    if (imageInput && typeof imageInput === 'object') {
      const supported = (imageInput as Record<string, unknown>)['supported'];
      if (typeof supported === 'boolean') return supported;
    }
  }

  return null;
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

