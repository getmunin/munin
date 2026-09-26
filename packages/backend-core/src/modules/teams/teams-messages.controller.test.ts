import { describe, expect, it } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ALLOW_ANONYMOUS } from '../../common/auth/auth.guard.ts';
import {
  TeamsMessagesController,
  type TeamsActivityReceiver,
  type TeamsInvokeHandler,
} from './teams-messages.controller.ts';

function fakeResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('TeamsMessagesController', () => {
  it('stays callable without a Munin credential, since Teams authenticates with its own JWT', () => {
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, TeamsMessagesController)).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, TeamsMessagesController)).toBe('v1/teams');
  });

  it('answers 401 and never touches the inbound pipeline when the Bot Connector token is missing', async () => {
    let touched = false;
    const inbound: TeamsActivityReceiver = {
      integrationForApp: () => {
        touched = true;
        return Promise.resolve(null);
      },
      tenantMatches: () => true,
      processActivity: () => {
        touched = true;
        return Promise.resolve();
      },
    };
    const interactions: TeamsInvokeHandler = {
      handleInvoke: () => {
        touched = true;
        return Promise.resolve({ status: 200, body: {} });
      },
    };
    const controller = new TeamsMessagesController(inbound, interactions, {
      resolve: () => Promise.resolve(null),
    });
    const res = fakeResponse();
    await controller.handle(
      { type: 'message', serviceUrl: 'https://smba.trafficmanager.net/emea/' },
      { headers: {} },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(touched).toBe(false);
  });
});
