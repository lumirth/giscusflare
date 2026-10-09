# Deploy giscusflare

Deploy the API and its internal content Worker to Cloudflare, register a public GitHub discussion repository, then generate your website embed. You need a Cloudflare account and a public repository with Discussions enabled.

## Build and deploy from source

Install locked dependencies with `npm ci` and run `npm run build`. The standard content producer has its own configuration in `wrangler.content.jsonc`; deploy it with `npm run deploy:content`. Add its service name as the API's `CONTENT` binding:

```json
"services": [{ "binding": "CONTENT", "service": "giscusflare-content" }]
```

The content Worker has no public route or commenter credentials. Choose unique Worker names for your deployment and keep the binding consistent. The API's source config owns static assets and the Repository Durable Object. After configuring GitHub and repository registration below, run `npm run deploy:check` and deploy the API with `npm run deploy`.

The [Deploy to Cloudflare button](https://deploy.workers.cloudflare.com/?url=https://github.com/lumirth/giscusflare) creates a source copy and initial API service. Open its address to reach setup; provision the internal content Worker and binding before using the standard rich-content profile.

## Connect GitHub

1. Enter your website address on setup and follow its GitHub App registration link.
2. Register a public App, with Discussions read/write and Metadata read permissions. Clear callback wildcard matching.
3. Record the App ID and client ID, create a client secret, and download its private key.
4. Install the App on the chosen public repository and enable Discussions.
5. Choose its exact category name, such as Announcements.

The callback is your service origin plus `/auth/callback`. Enter App ID and client ID in the source configuration or setup form. Store the downloaded private key locally for the registration command and as an encrypted Worker secret.

## Register the repository

Repository setup resolves its immutable repository, installation and category IDs once. Run the operator command against your source configuration:

```sh
npm run register -- --config wrangler.jsonc --secrets .dev.vars --repo you/comments --category Announcements
```

The secrets file supplies the existing `GITHUB_PRIVATE_KEY`; alternatively supply that environment variable. The command reads the App ID from `config.vars.GITHUB_APP_ID` and prints only public registration facts. Configuration files use JSON syntax. Paste that returned JSON into setup's registration field, or copy repositoryId, installationId and categoryId into the repository policy:

Use the [registered repository policy](docs/CONFIGURATION.md#choose-allowed-websites) as the configuration shape; its field reference owns defaults and allowed values.

Use the actual returned installation ID as a number. Normal reads reuse this registration and one credential owner; they do not repeat installation discovery. Current provider results still establish scope, visibility and permissions. Re-register when the App installation or selected category changes. Open hosting uses an explicit installation-backed registration reference; see [configuration](docs/CONFIGURATION.md#offer-open-hosting).

## Configure Cloudflare

Set public variables in source or the API Worker's **Settings → Variables and Secrets**:

Set `PUBLIC_ORIGIN`, `GITHUB_APP_ID`, `GITHUB_CLIENT_ID` and registered `REPOSITORIES`. [Configuration](docs/CONFIGURATION.md#service-settings) is the variable and policy reference.

Store `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` and `SESSION_SECRET` as encrypted secrets. The private key is the complete downloaded PEM; setup generates the random session key. Setup uses its own service origin and accepts repository, website, category, App ID, client ID and the registration JSON. It does not retain those values on your behalf.

Deploy the configured API and open setup again. Choose an exact page key or explicit existing discussion number, then generate the script. Test anonymous reading, prepared preview and a real sign-in/contribution against GitHub. The setup/configuration check does not establish authenticated participation.

## Update an existing deployment

Follow [operations](docs/OPERATIONS.md#update-and-restore) for preserved bindings/secrets, version activation and rollback. Browser and API packages must agree on protocol 7; durable addresses, receipts and browser storage remain independent of that protocol version.

## Use a custom domain

Add a Custom Domain to the API Worker's **Settings → Domains & Routes** using an active Cloudflare zone. Update PUBLIC_ORIGIN, the GitHub callback and website service URL together. Keep the content Worker internal. Follow [operations](docs/OPERATIONS.md) for verification and rollback.
