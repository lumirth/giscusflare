/** Navigate to GitHub. The demo replaces this module at build time. */
export function navigateAuthorization(url: URL): void {
  if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize') {
    throw new Error('Unexpected GitHub authorization destination.');
  }
  location.replace(url.toString());
}
