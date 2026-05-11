export function AuthChip({ mode }: { mode: 'public' | 'bearer' | 'session' | 'bearer|session' }) {
  if (mode === 'public') {
    return (
      <span className="auth public" title="No authentication required">
        ⛶ Public
      </span>
    );
  }
  const titleMap: Record<string, string> = {
    bearer: 'Bearer (admin or user token)',
    session: 'Session cookie',
  };
  const parts = mode.split('|');
  return (
    <span className="auth" title={'Accepted: ' + parts.map((p) => titleMap[p] ?? p).join(' · ')}>
      🔒 {parts.join(' · ')}
    </span>
  );
}
