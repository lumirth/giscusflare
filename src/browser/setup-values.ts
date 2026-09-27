/** These values stay in the browser until the operator copies them into Cloudflare. */
export function githubAppRegistration(origin: string, website: string): string {
  if (!/^https?:$/.test(new URL(website).protocol)) throw new Error('Enter an HTTP or HTTPS website address.');
  const url = new URL('https://github.com/settings/apps/new');
  url.search = new URLSearchParams({
    name: new URL(website).hostname + ' comments',
    description: 'GitHub Discussions comments with giscusflare',
    url: website,
    'callback_urls[]': origin + '/auth/callback',
    setup_url: origin + '/',
    public: 'true',
    discussions: 'write',
    metadata: 'read',
    webhook_active: 'false',
    request_oauth_on_install: 'false',
  }).toString();
  return url.href;
}

export function configurationValues(origin: string, repo: string, website: string, category: string, appId: string, clientId: string) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Enter the repository as owner/name.');
  const websiteOrigin = new URL(website).origin;
  if (!/^https?:$/.test(new URL(website).protocol)) throw new Error('Enter an HTTP or HTTPS website address.');
  if (!/^\d+$/.test(appId)) throw new Error('Enter the numeric GitHub App ID.');
  if (!clientId.trim()) throw new Error('Enter the GitHub client ID.');
  return {
    PUBLIC_ORIGIN: origin,
    GITHUB_APP_ID: appId,
    GITHUB_CLIENT_ID: clientId.trim(),
    REPOSITORIES: { [repo.toLowerCase()]: { origins: [websiteOrigin], category, defaultCommentOrder: 'oldest', customThemeOrigins: [] } },
  };
}

export function sessionSecret(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
