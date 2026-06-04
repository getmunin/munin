import { describe, expect, it } from 'vitest';
import { DefaultQuotasService } from './quotas.service.ts';

describe('DefaultQuotasService', () => {
  const svc = new DefaultQuotasService();

  it('assertCanAdd is a no-op for every resource', async () => {
    await expect(svc.assertCanAdd('kb_documents')).resolves.toBeUndefined();
    await expect(svc.assertCanAdd('kb_spaces')).resolves.toBeUndefined();
    await expect(svc.assertCanAdd('cms_collections')).resolves.toBeUndefined();
    await expect(svc.assertCanAdd('cms_entries')).resolves.toBeUndefined();
    await expect(svc.assertCanAdd('cms_assets')).resolves.toBeUndefined();
    await expect(svc.assertCanAdd('crm_contacts')).resolves.toBeUndefined();
  });

  it('recordCall is a no-op for every kind', async () => {
    await expect(svc.recordCall('mcp_tool', 'kb_search')).resolves.toBeUndefined();
    await expect(svc.recordCall('api_request', 'GET /v1/orgs')).resolves.toBeUndefined();
    await expect(svc.recordCall('arbitrary_downstream_kind')).resolves.toBeUndefined();
  });
});
