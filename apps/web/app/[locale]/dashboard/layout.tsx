import { DashboardBootstrapProvider } from '@getmunin/dashboard-pages';
import { readDashboardBootstrap } from '@getmunin/dashboard-pages/server';
import { DashboardChrome } from './dashboard-chrome';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const bootstrap = await readDashboardBootstrap();

  return (
    <DashboardBootstrapProvider value={bootstrap}>
      <DashboardChrome>{children}</DashboardChrome>
    </DashboardBootstrapProvider>
  );
}
