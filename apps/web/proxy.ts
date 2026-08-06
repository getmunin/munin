import createMiddleware from 'next-intl/middleware';
import { withSetupGate } from '@getmunin/dashboard-pages/setup-gate';
import { routing } from './i18n/routing';
import { SUPPORTED_LOCALES } from './i18n/locales';

export default withSetupGate(createMiddleware(routing), { locales: SUPPORTED_LOCALES });

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
