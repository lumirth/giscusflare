# Operate your service

GitHub stores your comments. Your Worker stores the page mappings, encrypted sessions and write receipts that connect your site to those discussions. Keep that service state when updating the deployment.

## Update

Bring the desired giscusflare release into your source repository and deploy it through Cloudflare's connected build. Keep your repository policy, secrets, Worker name, Durable Object binding and migration history. For a custom browser integration, follow the release notes for any matching package update.

Record the current Worker version before deploying. Afterward, load comments on your website and check sign-in, a contribution and a reaction. If you need to roll back, restore the previous Worker version and any corresponding website bundle. A code rollback does not reverse a database migration or delete contributions already saved to GitHub. See [Cloudflare's rollback guide](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).

## Troubleshoot

| Symptom | Check |
| --- | --- |
| Setup loads, but comments do not | Finish the GitHub credentials and repository settings |
| Your website is rejected | Include its exact origin in the repository policy, including `www` if used |
| The repository or category cannot be found | Enable Discussions, install the App and match the category name |
| Sign-in fails after a domain change | Set the GitHub callback to `PUBLIC_ORIGIN` plus `/auth/callback` and update the site's service URL |
| Native requests fail in the browser | Check CORS errors, allowed origins and your site's `connect-src` policy |
| A request returns 429 | Wait for the supplied retry interval and check service and GitHub limits |
| A comment submission has an uncertain result | Keep its draft and retry through the same conversation; inspect GitHub before creating a new submission |
| Comments fail during busy periods | Check Worker CPU errors, daily requests, object duration and SQLite allowances |
| Ranking reports `paused` | Check its reason and retry time, then review the ranking age, inputs and budget |

`/healthz` checks that the service responds. `/api/v1/setup` reports whether its settings are configured. The setup page's repository check also contacts GitHub to verify access and the category.

## Freshness and usage

Public comments are cached for one minute and page-list counts for five minutes by default. Readers see their own confirmed changes immediately. Other readers get those changes on a later read after cache expiry. Increasing the lifetime reduces repeated GitHub reads. It also extends how long a previously public response can remain available after a GitHub privacy change.

Ranked order has its own observation age. The content of a comment can be fresher than the score used to place it. Presentations receive ranking status and can offer chronological order when a ranking needs more work.

[Cloudflare usage](../FREE-TIER.md) explains the costs, measurements and settings for your traffic pattern.

## Rotate credentials

Add the new GitHub App key or client secret in Cloudflare and test sign-in before retiring the old credential. Keep `SESSION_SECRET` during routine updates. Changing it makes stored sessions unreadable and requires readers to sign in again.

The browser holds an opaque service session and optional draft recovery. GitHub tokens stay encrypted on the service. See [security](../SECURITY.md) for storage and access controls.

## Logs

Use request counts, CPU, object duration, SQL usage and errors to monitor the service. Exclude comment bodies, authorization headers, callback query strings and session tokens from logs. The supplied deployment disables Workers observability; review account-level logging separately.
