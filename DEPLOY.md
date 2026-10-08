# Deploy giscusflare

Deploy the comments service to your Cloudflare account, connect GitHub, then add the embed code to your website. You need a Cloudflare account and a public GitHub repository with Discussions enabled.

## Build and deploy from source

Install the locked dependencies with `npm ci`, configure `wrangler.jsonc`, then run `npm run deploy:check`. Deploy with `npm run deploy`. The public deploy button uses the source revision available on GitHub.

For an existing service, preserve its Worker identity, Durable Object binding, platform migration history and secrets. Update the service and website package together when their public protocol changes.

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lumirth/giscusflare)

The button creates a copy of the giscusflare source and deploys a Worker. Open its `workers.dev` address to reach the setup page. You will use that setup page to connect GitHub and generate your website's embed.

Choose the repository where you want comments to appear. It can be an existing repository, a dedicated comments repository or the source copy you just created. Enable Discussions in its GitHub settings.

## Connect GitHub

1. Enter your website address on the setup page and follow its link to register a GitHub App. It fills in the callback address and required permissions.
2. On GitHub, clear **Allow wildcard matching** for the callback address and register the App. Keep the generated public visibility so visitors can sign in.
3. Note the App ID and client ID. Generate a client secret and download a private key.
4. Install the App on your comments repository.
5. Choose a discussion category. Announcements works well if you want new discussions to start through your website.

## Configure Cloudflare

Return to the setup page and enter the App ID, client ID, repository, category and website address. Generate the configuration values.

Open your Worker in the Cloudflare dashboard, then **Settings → Variables and Secrets**. Copy these generated values into its variables:

| Variable | Value |
| --- | --- |
| `PUBLIC_ORIGIN` | Your service's address, without a trailing slash |
| `GITHUB_APP_ID` | The numeric App ID shown by GitHub |
| `GITHUB_CLIENT_ID` | The App's client ID |
| `REPOSITORIES` | The generated JSON, including your repository, category and allowed website |

Add these as encrypted secrets:

| Secret | Value |
| --- | --- |
| `GITHUB_CLIENT_SECRET` | The client secret generated on GitHub |
| `GITHUB_PRIVATE_KEY` | The full contents of the downloaded PEM file |
| `SESSION_SECRET` | The random key generated on the setup page |

Save and deploy the changes. For more than one website, add each exact origin to the repository's `origins` list. For example, `https://example.com` and `https://www.example.com` are separate entries.

## Add comments

Return to the setup page. Enter your repository and website, choose how pages map to discussions, and generate the embed code.

Paste the script where you want comments to appear. Open your website, sign in and post a comment. The comment should appear both on your website and in the selected GitHub discussion category.

For JavaScript embedding and page identifiers, see [website integration](docs/INTEGRATION.md). See [configuration](docs/CONFIGURATION.md) to add websites or change service settings.

## Use a custom domain

To use an address such as `comments.example.com`, add a Custom Domain in the Worker's **Settings → Domains & Routes**. Use a domain in an active Cloudflare zone.

Update these together:

- `PUBLIC_ORIGIN` to `https://comments.example.com`.
- The GitHub App's callback URL to `https://comments.example.com/auth/callback`.
- The service address in your website's embed code or JavaScript configuration.

See [operations](docs/OPERATIONS.md#update) when updating your deployment.

Cloudflare documents [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/) and [custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). GitHub documents the [App registration parameters](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters) used by setup.
