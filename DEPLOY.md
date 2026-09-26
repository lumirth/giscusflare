# Deploy

Check [Verification](VERIFICATION.md) for unresolved build failures. This package's initial Durable Object migration belongs on a new Worker. Keep an existing service's migration history intact.

## Choose a service address

Set `PUBLIC_ORIGIN` to one HTTPS origin, such as your Worker's `workers.dev` address or a custom domain. Use that address for the embed script and GitHub App callback too. The API rejects requests to another host.

## Create a GitHub App

Create an App with the repository permission **Discussions: Read and write**. Set its user-authorization callback to:

```text
https://YOUR-COMMENTS-ORIGIN/auth/callback
```

Keep expiring user tokens enabled. The service refreshes them. Disable webhooks; this application does not use them or installation-time user authorization.

Install the App only on the public repositories that will hold comments. Enable Discussions and create the intended category, usually `Announcements`.

Save the numeric App ID, client ID, client secret, and RSA private key. The IDs go in the public configuration. The secret and private key go in Worker secrets.

See [GitHub's App authorization guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

## Set the public configuration

Replace the example values in `wrangler.jsonc`:

```json
{
  "vars": {
    "PUBLIC_ORIGIN": "https://comments.your-domain.example",
    "GITHUB_APP_ID": "123456",
    "GITHUB_CLIENT_ID": "Iv1.your-real-client-id",
    "REPOSITORIES": {
      "your-account/your-public-repository": {
        "origins": ["https://your-blog.example"],
        "category": "Announcements",
        "defaultCommentOrder": "oldest",
        "customThemeOrigins": []
      }
    }
  }
}
```

Merge this excerpt into the supplied file. Keep its `REPOSITORY_STORE` binding, migrations, and `READ_LIMITER`, `WRITE_LIMITER`, and `AUTH_LIMITER` bindings.

Repository keys must be lowercase. Origins must contain the scheme and host, with a port when needed, but no path, wildcard, or trailing slash. Add each website origin that will embed comments.

The optional `categoryId` checks the category's identity as well as its name. The setup page retrieves repository and category IDs after the App is installed.

Custom CSS can come from the comments service, an allowed website origin, or an entry in `customThemeOrigins`. Approve any external font origins there too. To use a custom domain, add a Workers custom-domain route for a domain you control.

## Install and test

Use Node 22.16 or newer:

```sh
npm install
npm test
npm run test:runtime
pip install playwright==1.57.0
python -m playwright install chromium
# Perform and record browser acceptance from TESTING.md
```

The package pins direct dependency versions. After a successful install, review and commit `package-lock.json`. Use `npm ci` for later installs.

[Testing](TESTING.md) explains what each command checks.

## Add secrets

Sign in to the intended Cloudflare account and store the App credentials:

```sh
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_PRIVATE_KEY < /path/to/your-app-private-key.pem
npm run secret
npx wrangler secret put SESSION_SECRET
```

Paste the output of `npm run secret` into the `SESSION_SECRET` prompt. Keep this key across deployments. Changing it signs readers out because the service can no longer decrypt their sessions.

The private key can use GitHub's PKCS#1 format or PKCS#8. Keep it out of source control and the embed code.

Wrangler may ask to create the Worker when you add its first secret. Alternatively, deploy first, then add secrets before putting the widget on your blog.

For local tests with a real GitHub account, copy `.dev.vars.example` to `.dev.vars` and use a separate development App and callback. The simulated demo does not need these credentials.

## Publish

```sh
npm run deploy:check
npm run deploy
```

`deploy:check` runs the release tests, checks configuration, and builds a deployment dry run. `deploy` repeats those checks and publishes the Worker.

## Test the deployed service

Use a disposable public discussion before replacing your blog's embed.

Check anonymous loading, website restrictions, custom CSS, category IDs, and an existing discussion's page mapping. Sign in as an ordinary reader and test cancellation, blocked popups, sign-out, and token refresh. Include the browsers your readers use, particularly Safari and Firefox.

Post the first comment from two sessions and confirm that both use one discussion. Check replies, long threads, both sort orders, edits, deletion, moderation, Markdown preview, and all eight emoji reactions against GitHub.

Confirm that readers cannot edit another person's comments or target another discussion. Check locked discussions and archived repositories. For a timed-out write, inspect GitHub before submitting again.

Measure Worker CPU usage, request volume, storage, and GitHub API usage. Keep the old embed settings for rollback. The comments remain in GitHub when you switch services.
