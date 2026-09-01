import { LearningPage } from '@getmunin/dashboard-pages';

export default async function LearningDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LearningPage selectedId={id} />;
}
