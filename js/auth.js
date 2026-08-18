/* auth.js — Google Identity Services sign-in.
 *
 * The app has no backend, so the Google ID token is read in the browser to get
 * the signed-in person's name, email and picture. The token's signature is NOT
 * verified here — that requires a server. Treat the resulting session as a
 * convenience for this browser, not as a security boundary: everything this app
 * stores is local anyway.
 */
(function (global) {
  'use strict';

  var CLIENT_ID_KEY = 'plaintext.googleClientId';
  var GSI_SRC = 'https://accounts.google.com/gsi/client';
  var gsiPromise = null;

  function configuredClientId() {
    var stored = null;
    try { stored = localStorage.getItem(CLIENT_ID_KEY); } catch (e) { /* storage off */ }
    var fromFile = (global.PlaintextConfig || {}).GOOGLE_CLIENT_ID || '';
    return (stored || fromFile || '').trim();
  }

  function setClientId(value) {
    var clean = String(value || '').trim();
    try {
      if (clean) localStorage.setItem(CLIENT_ID_KEY, clean);
      else localStorage.removeItem(CLIENT_ID_KEY);
    } catch (e) { /* storage off */ }
    gsiPromise = null; // force re-initialisation with the new id
    return clean;
  }

  function isConfigured() { return !!configuredClientId(); }

  function fileProtocol() { return location.protocol === 'file:'; }

  /* Load the Google script once; resolves with window.google or rejects. */
  function loadGsi() {
    if (gsiPromise) return gsiPromise;
    gsiPromise = new Promise(function (resolve, reject) {
      if (global.google && global.google.accounts && global.google.accounts.id) {
        return resolve(global.google);
      }
      var existing = document.querySelector('script[src="' + GSI_SRC + '"]');
      var script = existing || document.createElement('script');
      var timer = setTimeout(function () {
        reject(new Error('Google sign-in did not load (offline, or blocked by the browser).'));
      }, 8000);

      script.addEventListener('load', function () {
        clearTimeout(timer);
        if (global.google && global.google.accounts && global.google.accounts.id) resolve(global.google);
        else reject(new Error('Google sign-in loaded but is unavailable.'));
      });
      script.addEventListener('error', function () {
        clearTimeout(timer);
        reject(new Error('Could not reach accounts.google.com.'));
      });

      if (!existing) {
        script.src = GSI_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    });
    return gsiPromise;
  }

  /* Decode a JWT payload. No signature check — see the note at the top. */
  function decodeIdToken(token) {
    var parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed credential from Google.');
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  }

  /* Sanity checks that do not need a server: right audience, right issuer,
     not expired. These catch mistakes, not a determined forger. */
  function validateClaims(claims) {
    var issuers = ['https://accounts.google.com', 'accounts.google.com'];
    if (issuers.indexOf(claims.iss) === -1) throw new Error('Unexpected token issuer.');
    if (claims.aud !== configuredClientId()) throw new Error('Token was issued for a different app.');
    if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('That sign-in has expired — try again.');
    if (!claims.sub) throw new Error('Token is missing an account id.');
    return claims;
  }

  function profileFromToken(token) {
    var claims = validateClaims(decodeIdToken(token));
    return {
      sub: claims.sub,
      email: claims.email || '',
      emailVerified: !!claims.email_verified,
      name: claims.name || (claims.email || '').split('@')[0] || 'Google user',
      picture: claims.picture || ''
    };
  }

  /**
   * Render Google's official button into `container`.
   * onSuccess(profile) fires after a successful sign-in; onError(message) on failure.
   */
  function renderButton(container, opts) {
    opts = opts || {};
    if (!isConfigured()) {
      return Promise.reject(new Error('No Google client ID configured.'));
    }
    return loadGsi().then(function (google) {
      google.accounts.id.initialize({
        client_id: configuredClientId(),
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: function (response) {
          try {
            opts.onSuccess(profileFromToken(response.credential));
          } catch (err) {
            if (opts.onError) opts.onError(err.message);
          }
        }
      });
      google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: opts.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        logo_alignment: 'center',
        width: opts.width || 300
      });
      if (opts.oneTap) google.accounts.id.prompt();
      return true;
    });
  }

  function signOut() {
    try {
      if (global.google && global.google.accounts && global.google.accounts.id) {
        global.google.accounts.id.disableAutoSelect();
      }
    } catch (e) { /* nothing to disable */ }
  }

  global.Auth = {
    isConfigured: isConfigured,
    configuredClientId: configuredClientId,
    setClientId: setClientId,
    renderButton: renderButton,
    profileFromToken: profileFromToken,
    fileProtocol: fileProtocol,
    signOut: signOut
  };
})(window);
