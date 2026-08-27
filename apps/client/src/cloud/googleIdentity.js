export const GOOGLE_DRIVE_FILE_SCOPE =
  'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_IDENTITY_SCRIPT_SRC =
  'https://accounts.google.com/gsi/client';

const GOOGLE_IDENTITY_SCRIPT_ID = 'dm-forge-google-identity-services';
const scriptLoads = new WeakMap();

export class GoogleIdentityError extends Error {
  constructor(message, { code = 'identity_error', cause } = {}) {
    super(message);
    this.name = 'GoogleIdentityError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function getOAuthApi(google) {
  const oauth2 = google?.accounts?.oauth2;
  if (!oauth2?.initTokenClient) {
    throw new GoogleIdentityError(
      'Google Identity Services loaded without its OAuth client.',
      { code: 'identity_unavailable' }
    );
  }
  return oauth2;
}

function scriptLoadError(cause) {
  return new GoogleIdentityError(
    'Google sign-in could not be loaded. Check your connection and try again.',
    { code: 'script_load_failed', cause }
  );
}

/**
 * Loads the external GIS client on demand. A WeakMap keeps multiple identity
 * instances on the same page from adding duplicate script elements.
 */
export function loadGoogleIdentityServices({
  documentRef = globalThis.document,
  getGoogle = () => globalThis.google,
  scriptSrc = GOOGLE_IDENTITY_SCRIPT_SRC,
} = {}) {
  const existingGoogle = getGoogle();
  if (existingGoogle?.accounts?.oauth2) return Promise.resolve(existingGoogle);

  if (!documentRef?.createElement) {
    return Promise.reject(
      new GoogleIdentityError(
        'Google sign-in requires a browser document.',
        { code: 'browser_required' }
      )
    );
  }

  const inFlight = scriptLoads.get(documentRef);
  if (inFlight) return inFlight;

  const load = new Promise((resolve, reject) => {
    let watchedScript = null;
    const settleLoaded = () => {
      try {
        const google = getGoogle();
        getOAuthApi(google);
        resolve(google);
      } catch (error) {
        watchedScript?.remove?.();
        reject(scriptLoadError(error));
      }
    };
    const settleFailed = (error) => {
      watchedScript?.remove?.();
      reject(scriptLoadError(error));
    };
    const existingScript = documentRef.querySelector?.(
      `#${GOOGLE_IDENTITY_SCRIPT_ID}`
    );

    if (existingScript) {
      watchedScript = existingScript;
      if (existingScript.addEventListener) {
        existingScript.addEventListener('load', settleLoaded, { once: true });
        existingScript.addEventListener('error', settleFailed, { once: true });
      } else {
        existingScript.onload = settleLoaded;
        existingScript.onerror = settleFailed;
      }
      return;
    }

    const script = documentRef.createElement('script');
    watchedScript = script;
    script.id = GOOGLE_IDENTITY_SCRIPT_ID;
    script.src = scriptSrc;
    script.async = true;
    script.defer = true;
    script.onload = settleLoaded;
    script.onerror = settleFailed;

    const parent =
      documentRef.head || documentRef.body || documentRef.documentElement;
    if (!parent?.append) {
      reject(
        new GoogleIdentityError(
          'Google sign-in could not attach its browser script.',
          { code: 'browser_required' }
        )
      );
      return;
    }
    parent.append(script);
  });

  scriptLoads.set(documentRef, load);
  load.catch(() => {
    if (scriptLoads.get(documentRef) === load) {
      scriptLoads.delete(documentRef);
    }
  });
  return load;
}

function tokenError(response) {
  return new GoogleIdentityError(
    response?.error_description ||
      response?.error ||
      'Google did not return an access token.',
    { code: response?.error || 'token_missing' }
  );
}

function popupError(error) {
  const code = error?.type || 'popup_error';
  const messages = {
    popup_closed: 'Google sign-in was closed before it finished.',
    popup_failed_to_open:
      'Google sign-in could not open. Allow popups and try again.',
  };
  return new GoogleIdentityError(
    messages[code] || 'Google sign-in could not be completed.',
    { code, cause: error }
  );
}

/**
 * Creates a browser-only Google Identity Services token client.
 *
 * Tokens and expiry metadata live only in this closure. Nothing is written to
 * localStorage, IndexedDB, cookies, or a backend.
 */
export function createGoogleIdentity({
  clientId,
  documentRef = globalThis.document,
  getGoogle = () => globalThis.google,
  now = () => Date.now(),
  scriptSrc = GOOGLE_IDENTITY_SCRIPT_SRC,
} = {}) {
  if (!clientId) {
    throw new GoogleIdentityError(
      'A Google OAuth browser client ID is required.',
      { code: 'client_id_missing' }
    );
  }

  let accessToken = null;
  let expiresAt = null;
  let lastTokenResponse = null;
  let oauth2Api = null;
  let tokenClient = null;
  let pendingAuthorization = null;
  let activeConnect = null;

  function clearAccessToken() {
    accessToken = null;
    expiresAt = null;
    lastTokenResponse = null;
  }

  function getAccessToken() {
    if (accessToken && expiresAt !== null && now() >= expiresAt) {
      clearAccessToken();
    }
    return accessToken;
  }

  function settleAuthorization(response) {
    const pending = pendingAuthorization;
    pendingAuthorization = null;
    if (!pending) return;

    if (response?.error || !response?.access_token) {
      clearAccessToken();
      pending.reject(tokenError(response));
      return;
    }

    if (
      oauth2Api?.hasGrantedAllScopes &&
      !oauth2Api.hasGrantedAllScopes(response, GOOGLE_DRIVE_FILE_SCOPE)
    ) {
      clearAccessToken();
      pending.reject(
        new GoogleIdentityError(
          'Google Drive access was not granted. Reconnect and approve Drive access.',
          { code: 'insufficient_scope' }
        )
      );
      return;
    }

    accessToken = response.access_token;
    const expiresIn = Number(response.expires_in);
    expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? now() + expiresIn * 1000
        : null;
    lastTokenResponse = { ...response };
    pending.resolve({ ...response });
  }

  function rejectAuthorization(error) {
    const pending = pendingAuthorization;
    pendingAuthorization = null;
    if (!pending) return;
    clearAccessToken();
    pending.reject(popupError(error));
  }

  async function ensureTokenClient() {
    if (tokenClient) return tokenClient;

    const google = await loadGoogleIdentityServices({
      documentRef,
      getGoogle,
      scriptSrc,
    });
    oauth2Api = getOAuthApi(google);
    tokenClient = oauth2Api.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      callback: settleAuthorization,
      error_callback: rejectAuthorization,
    });

    if (!tokenClient?.requestAccessToken) {
      tokenClient = null;
      throw new GoogleIdentityError(
        'Google Identity Services did not provide a token client.',
        { code: 'identity_unavailable' }
      );
    }
    return tokenClient;
  }

  function connect({ prompt = 'select_account', force = false } = {}) {
    if (!force && getAccessToken()) {
      return Promise.resolve({ ...lastTokenResponse });
    }
    if (activeConnect) return activeConnect;

    const attempt = (async () => {
      const client = await ensureTokenClient();
      return new Promise((resolve, reject) => {
        pendingAuthorization = { resolve, reject };
        try {
          client.requestAccessToken({ prompt });
        } catch (error) {
          pendingAuthorization = null;
          reject(
            new GoogleIdentityError(
              'Google sign-in could not be started. Try again.',
              { code: 'request_failed', cause: error }
            )
          );
        }
      });
    })();

    activeConnect = attempt;
    attempt.then(
      () => {
        if (activeConnect === attempt) activeConnect = null;
      },
      () => {
        if (activeConnect === attempt) activeConnect = null;
      }
    );
    return attempt;
  }

  async function revoke() {
    const token = getAccessToken();
    clearAccessToken();
    if (!token) return { successful: true, skipped: true };

    const oauth2 = oauth2Api || getGoogle()?.accounts?.oauth2;
    if (!oauth2?.revoke) {
      throw new GoogleIdentityError(
        'Google sign-out is unavailable. Local access has still been cleared.',
        { code: 'revoke_unavailable' }
      );
    }

    return new Promise((resolve, reject) => {
      try {
        oauth2.revoke(token, (result = {}) => {
          if (result.error || result.successful === false) {
            reject(
              new GoogleIdentityError(
                result.error_description ||
                  result.error ||
                  'Google could not revoke Drive access.',
                { code: result.error || 'revoke_failed' }
              )
            );
            return;
          }
          resolve({ successful: true, ...result });
        });
      } catch (error) {
        reject(
          new GoogleIdentityError(
            'Google could not revoke Drive access. Local access has still been cleared.',
            { code: 'revoke_failed', cause: error }
          )
        );
      }
    });
  }

  return {
    clearAccessToken,
    connect,
    getAccessToken,
    isConnected: () => Boolean(getAccessToken()),
    revoke,
  };
}
