import {
  VerifyEmailPage as SharedVerifyEmailPage,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';

export default function VerifyEmailPage() {
  return <SharedVerifyEmailPage footer={OSS_AUTH_FOOTER} />;
}
