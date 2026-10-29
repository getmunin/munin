import { JourneysPage } from '@getmunin/dashboard-pages';

export default async function JourneyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const raw = Array.isArray(sp.publish) ? sp.publish[0] : sp.publish;
  const publishVersion = raw ? Number.parseInt(raw, 10) : undefined;
  return (
    <JourneysPage
      selectedId={id}
      publishVersion={publishVersion && publishVersion > 0 ? publishVersion : undefined}
    />
  );
}
