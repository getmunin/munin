import { ConversationDetailPage } from '@getmunin/dashboard-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationDetailPage conversationId={id} />;
}
