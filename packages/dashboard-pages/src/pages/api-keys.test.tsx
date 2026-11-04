import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';

interface ApiCall {
  path: string;
  init?: RequestInit;
}

interface MintBody {
  name: string;
  scopes: string[];
}

function parseMintBody(body: string): MintBody {
  return JSON.parse(body) as MintBody;
}

const calls: ApiCall[] = [];
let listResponse: unknown[] = [];

vi.mock('../api', () => ({
  api: vi.fn((path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (!init || (init.method ?? 'GET') === 'GET') {
      return Promise.resolve(listResponse);
    }
    return Promise.resolve({
      id: 'key_new',
      name: 'test-key',
      key: 'mn_admin_plaintext',
      prefix: 'mn_admin',
      scopes: parseMintBody(init.body as string).scopes,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }),
}));

const { ApiKeysPage } = await import('./api-keys');

function postedScopes(): string[] {
  const call = calls.find((c) => c.init?.method === 'POST');
  if (!call?.init?.body) throw new Error('no POST call recorded');
  return parseMintBody(call.init.body as string).scopes;
}

describe('ApiKeysPage scope picker', () => {
  beforeEach(() => {
    calls.length = 0;
    listResponse = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mints a full-access key by default', async () => {
    renderWithProviders(<ApiKeysPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mint API key' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /Mint key/ }));

    await waitFor(() => expect(postedScopes()).toEqual(['*']));
  });

  it('mints a scoped key when full access is turned off', async () => {
    renderWithProviders(<ApiKeysPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mint API key' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'test-key' } });

    fireEvent.click(screen.getByText('Full access'));
    fireEvent.click(screen.getAllByText('Read')[0]!);
    fireEvent.click(screen.getAllByText('Write')[1]!);

    fireEvent.click(screen.getByRole('button', { name: /Mint key/ }));

    await waitFor(() => {
      const scopes = postedScopes();
      expect(scopes).toContain('kb:read');
      expect(scopes).toContain('conv:write');
      expect(scopes).not.toContain('*');
    });
  });

  it('disables minting when no scope is selected', async () => {
    renderWithProviders(<ApiKeysPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mint API key' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'test-key' } });

    fireEvent.click(screen.getByText('Full access'));

    expect(screen.getByRole('button', { name: /Mint key/ }).hasAttribute('disabled')).toBe(true);
  });

  it('renders a scope summary for an existing scoped key', async () => {
    listResponse = [
      {
        id: 'key_1',
        name: 'reader',
        prefix: 'mn_admin',
        scopes: ['kb:read', 'crm:write'],
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    renderWithProviders(<ApiKeysPage />);

    expect(await screen.findByText(/Knowledge Base \(read\)/)).toBeTruthy();
    expect(screen.getByText(/Contacts \(write\)/)).toBeTruthy();
  });
});
