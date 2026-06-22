'use client';

import { AgentSetupWizard, useSetupGate } from '@getmunin/dashboard-pages';
import { PageSpinner } from '@getmunin/ui';

export default function SetupRoute() {
  const { ready } = useSetupGate();

  if (!ready) {
    return <PageSpinner className="min-h-screen bg-background" />;
  }

  return <AgentSetupWizard />;
}
