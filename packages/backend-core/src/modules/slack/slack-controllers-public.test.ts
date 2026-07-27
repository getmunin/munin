import { describe, expect, it } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ALLOW_ANONYMOUS } from '../../common/auth/auth.guard.ts';
import { SlackAvatarsController } from './slack-avatars.controller.ts';
import { SlackEventsController } from './slack-events.controller.ts';
import { SlackOAuthController } from './slack-oauth.controller.ts';

const cases = [
  { name: 'SlackEventsController', cls: SlackEventsController, path: 'v1/slack' },
  { name: 'SlackOAuthController', cls: SlackOAuthController, path: 'v1/slack/oauth' },
  { name: 'SlackAvatarsController', cls: SlackAvatarsController, path: 'v1/slack/avatars' },
];

describe('Slack controllers stay callable without a Munin credential when AuthGuard is registered as a global APP_GUARD (Slack signs requests instead of sending a bearer token)', () => {
  for (const { name, cls, path } of cases) {
    it(`${name} sets ALLOW_ANONYMOUS and keeps its route path`, () => {
      expect(Reflect.getMetadata(ALLOW_ANONYMOUS, cls)).toBe(true);
      expect(Reflect.getMetadata(PATH_METADATA, cls)).toBe(path);
    });
  }
});
