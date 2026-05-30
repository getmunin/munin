import {
  ResetPasswordPage as SharedResetPasswordPage,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';

export default function ResetPasswordPage() {
  return <SharedResetPasswordPage footer={OSS_AUTH_FOOTER} />;
}
