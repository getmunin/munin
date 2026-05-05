import { redirect } from 'next/navigation';

export default function CrmMergeProposalsRedirect() {
  redirect('/dashboard/review');
}
