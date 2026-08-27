import { describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_IDENTITY_SCRIPT_SRC,
  createGoogleIdentity,
} from '../googleIdentity.js';

function createScriptDocument(onAppend) {
  const appendedScripts = [];
  return {
    appendedScripts,
    createElement: vi.fn(() => ({})),
    querySelector: vi.fn(() => null),
    head: {
      append: vi.fn((script) => {
        appendedScripts.push(script);
        onAppend(script);
      }),
    },
  };
}

function createGoogleApi(tokenResponse = {}) {
  let tokenConfig;
  const requestAccessToken = vi.fn(() => {
    tokenConfig.callback({
      access_token: 'memory-only-token',
      expires_in: 3600,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      ...tokenResponse,
    });
  });
  const revoke = vi.fn((_token, callback) => {
    callback({ successful: true });
  });
  const google = {
    accounts: {
      oauth2: {
        hasGrantedAllScopes: vi.fn(() => true),
        initTokenClient: vi.fn((config) => {
          tokenConfig = config;
          return { requestAccessToken };
        }),
        revoke,
      },
    },
  };

  return { google, requestAccessToken, revoke, readConfig: () => tokenConfig };
}

describe('createGoogleIdentity', () => {
  it('loads Google Identity Services only when connect is called', async () => {
    let google;
    const api = createGoogleApi();
    const documentRef = createScriptDocument((script) => {
      google = api.google;
      script.onload();
    });
    const identity = createGoogleIdentity({
      clientId: 'browser-client-id',
      documentRef,
      getGoogle: () => google,
    });

    expect(documentRef.createElement).not.toHaveBeenCalled();
    expect(documentRef.head.append).not.toHaveBeenCalled();

    const response = await identity.connect();

    expect(documentRef.appendedScripts).toHaveLength(1);
    expect(documentRef.appendedScripts[0]).toMatchObject({
      async: true,
      defer: true,
      src: GOOGLE_IDENTITY_SCRIPT_SRC,
    });
    expect(api.readConfig()).toMatchObject({
      client_id: 'browser-client-id',
      scope: GOOGLE_DRIVE_FILE_SCOPE,
    });
    expect(api.requestAccessToken).toHaveBeenCalledWith({
      prompt: 'select_account',
    });
    expect(response.access_token).toBe('memory-only-token');
    expect(identity.getAccessToken()).toBe('memory-only-token');
  });

  it('rejects authorization errors without retaining a token', async () => {
    let google;
    const api = createGoogleApi({
      access_token: undefined,
      error: 'access_denied',
      error_description: 'The user declined access.',
    });
    const documentRef = createScriptDocument((script) => {
      google = api.google;
      script.onload();
    });
    const identity = createGoogleIdentity({
      clientId: 'browser-client-id',
      documentRef,
      getGoogle: () => google,
    });

    await expect(identity.connect()).rejects.toMatchObject({
      code: 'access_denied',
      message: 'The user declined access.',
    });
    expect(identity.getAccessToken()).toBeNull();
  });

  it('revokes consent and clears the in-memory access token', async () => {
    let google;
    const api = createGoogleApi();
    const documentRef = createScriptDocument((script) => {
      google = api.google;
      script.onload();
    });
    const identity = createGoogleIdentity({
      clientId: 'browser-client-id',
      documentRef,
      getGoogle: () => google,
    });
    await identity.connect();

    await expect(identity.revoke()).resolves.toMatchObject({
      successful: true,
    });

    expect(api.revoke).toHaveBeenCalledWith(
      'memory-only-token',
      expect.any(Function)
    );
    expect(identity.getAccessToken()).toBeNull();
  });

  it('forgets expired tokens instead of persisting or reusing them', async () => {
    let google;
    let currentTime = 10_000;
    const api = createGoogleApi({ expires_in: 1 });
    const documentRef = createScriptDocument((script) => {
      google = api.google;
      script.onload();
    });
    const identity = createGoogleIdentity({
      clientId: 'browser-client-id',
      documentRef,
      getGoogle: () => google,
      now: () => currentTime,
    });
    await identity.connect();

    currentTime += 1_001;

    expect(identity.getAccessToken()).toBeNull();
    expect(identity.isConnected()).toBe(false);
  });
});
