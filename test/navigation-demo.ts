/** Redirect demo sign-in to the local simulator. */
export function navigateAuthorization(url: URL): void {
  if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize') {
    throw new Error('Unexpected authorization destination.');
  }
  const target = new URL('/__demo/authorize', location.origin);
  target.search = url.search;
  location.replace(target.toString());
}
