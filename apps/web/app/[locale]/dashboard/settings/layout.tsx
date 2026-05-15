import { OSS_SETTINGS_GROUPS, SettingsShell } from '@getmunin/dashboard-pages';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell groups={OSS_SETTINGS_GROUPS}>{children}</SettingsShell>;
}
