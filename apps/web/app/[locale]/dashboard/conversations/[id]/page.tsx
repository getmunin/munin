import { ConversationsPage } from '@getmunin/dashboard-pages';

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConversationsPage selectedId={id} />;
}
