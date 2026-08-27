'use client';

const STORAGE_KEY = 'munin.active-org';

function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function write(apply: (storage: Storage) => void): void {
  const storage = store();
  if (!storage) return;
  try {
    apply(storage);
  } catch {
    return;
  }
}

export function getActiveOrgId(): string | null {
  const storage = store();
  if (!storage) return null;
  try {
    const value = storage.getItem(STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export function setActiveOrgId(orgId: string): void {
  write((storage) => storage.setItem(STORAGE_KEY, orgId));
}

export function clearActiveOrgId(): void {
  write((storage) => storage.removeItem(STORAGE_KEY));
}
