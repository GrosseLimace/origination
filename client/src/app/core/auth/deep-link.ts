const DEEP_LINK_KEY = 'deepLinkUrl';

/**
 * Saves the URL a signed-out user asked for, so main.ts can take them there after Azure AD sends
 * them back from the sign-in redirect. Without it, a link to /insights/xyz would land on / after
 * sign-in. The home page itself isn't worth saving.
 */
export function rememberDeepLink(url: string | null | undefined): void {
  if (!url || url === '/' || !url.startsWith('/')) return;
  try {
    sessionStorage.setItem(DEEP_LINK_KEY, url);
  } catch {
    // sessionStorage unavailable
  }
}
