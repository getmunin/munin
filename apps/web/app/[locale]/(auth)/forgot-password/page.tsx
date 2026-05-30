import {
  ForgotPasswordPage as SharedForgotPasswordPage,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';

export default function ForgotPasswordPage() {
  return <SharedForgotPasswordPage footer={OSS_AUTH_FOOTER} />;
}
