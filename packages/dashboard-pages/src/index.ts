export { api, ApiError } from './api';
export { authClient } from './auth-client';
export { OrgSwitcher } from './components/org-switcher';
export { PageShell, nativeFieldClass } from './components/page-shell';
export { useActiveRole, isOwnerOrAdmin, type OrgRole } from './auth/use-active-role';
export { useAgentConfigStatus } from './auth/use-agent-config-status';
export { useDashboardGate } from './auth/use-dashboard-gate';
export { useSetupGate } from './auth/use-setup-gate';

export { AcceptInvitePage } from './pages/accept-invite';
export { BuiltinAiSettingsPage } from './pages/builtin-ai-settings';
export { AgentSetupWizard } from './pages/agent-setup-wizard';
export { AgentsPage } from './pages/agents';
export { ApiKeysPage } from './pages/api-keys';
export { AuditLogPage } from './pages/audit-log';
export { ChannelsPage } from './pages/channels';
export { EndUsersPage } from './pages/end-users';
export { ExportPage } from './pages/export';
export { DashboardPage } from './pages/overview';
export { TeamPage } from './pages/team';
export { UsagePage } from './pages/usage';
export { InboxPage } from './pages/inbox';
export { ActivityPage } from './pages/activity';
export {
  useRealtime,
  type RealtimeEventRow,
  type SubscriptionChannel,
} from './realtime';
