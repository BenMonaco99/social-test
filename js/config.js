/* config.js — deployment settings.
 *
 * To enable "Sign in with Google":
 *   1. https://console.cloud.google.com/apis/credentials → Create credentials
 *      → OAuth client ID → Web application.
 *   2. Under "Authorized JavaScript origins" add the origin you serve this app
 *      from, e.g. http://localhost:8000 (Google does not allow file:// origins).
 *   3. Paste the client ID below, or enter it in the app on the sign-in screen —
 *      that stores it in this browser only.
 */
window.PlaintextConfig = {
  GOOGLE_CLIENT_ID: ''
};
