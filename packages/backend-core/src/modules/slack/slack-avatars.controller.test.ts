import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  SlackAvatarsController,
  slackAvatarFilename,
  slackAvatarPng,
  type AvatarResponse,
} from './slack-avatars.controller.ts';

function fakeResponse() {
  const state = { status: 0, headers: {} as Record<string, string>, body: '' };
  const res: AvatarResponse = {
    status(code: number) {
      state.status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return res;
    },
    send(body: Buffer) {
      state.body = body.toString('base64');
      return res;
    },
  };
  return { res, state };
}

describe('slackAvatarFilename', () => {
  it('content-addresses each avatar so a changed icon gets a URL Slack has not cached', () => {
    const file = slackAvatarFilename('default');
    expect(file).toMatch(/^default\.[0-9a-f]{8}\.png$/);
    expect(slackAvatarFilename('default')).toBe(file);
    expect(slackAvatarFilename('default-dark')).not.toBe(file);
    expect(slackAvatarFilename('A')).not.toBe(file);
  });

  it('rejects keys with no avatar behind them', () => {
    expect(slackAvatarFilename('a')).toBeNull();
    expect(slackAvatarFilename('AB')).toBeNull();
    expect(slackAvatarFilename('4')).toBeNull();
  });
});

describe('SlackAvatarsController', () => {
  const controller = new SlackAvatarsController();

  it('serves the png a content-addressed filename points at', () => {
    const { res, state } = fakeResponse();
    controller.serve(slackAvatarFilename('default')!, res);
    expect(state.status).toBe(200);
    expect(state.headers['content-type']).toBe('image/png');
    expect(state.body).toBe(slackAvatarPng('default'));
  });

  it('still serves the pre-hash filenames already posted into Slack threads', () => {
    const { res, state } = fakeResponse();
    controller.serve('A-dark.png', res);
    expect(state.body).toBe(slackAvatarPng('A-dark'));
  });

  it('rejects a filename outside the avatar set', () => {
    const { res } = fakeResponse();
    expect(() => controller.serve('../secret.png', res)).toThrow(NotFoundException);
    expect(() => controller.serve('4.png', res)).toThrow(NotFoundException);
    expect(() => controller.serve('default.zz.png', res)).toThrow(NotFoundException);
  });
});
