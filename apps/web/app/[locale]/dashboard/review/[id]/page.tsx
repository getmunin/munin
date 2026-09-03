import { ReviewPage } from '@getmunin/dashboard-pages';

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReviewPage selectedId={id} />;
}
