export { api, ApiError } from './api';
export { authClient } from './auth-client';
export { OrgSwitcher } from './components/org-switcher';
export { useActiveRole, isOwnerOrAdmin, type OrgRole } from './auth/use-active-role';

export { AcceptInvitePage } from './pages/accept-invite';
export { AgentsPage } from './pages/agents';
export { ApiKeysPage } from './pages/api-keys';
export { AuditLogPage } from './pages/audit-log';
export { EndUsersPage } from './pages/end-users';
export { ExportPage } from './pages/export';
export { DashboardPage } from './pages/overview';
export { TeamPage } from './pages/team';
export { UsagePage } from './pages/usage';
export { ConversationsPage } from './pages/conversations';
export { ActivityPage } from './pages/activity';
export { CrmMergeProposalsPage } from './pages/crm-merge-proposals';
export {
  useRealtime,
  type RealtimeEventRow,
  type SubscriptionChannel,
} from './realtime';
