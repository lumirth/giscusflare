# Maintain your service

## Update

1. Choose a [release](https://github.com/lumirth/giscusflare/releases) and read its update instructions.
2. Merge the release changes into your source repository. Preserve your Wrangler configuration, including the Worker name, repository settings, Durable Object binding and migration history. Keep the existing secrets in Cloudflare.
3. Record the current Worker version and deploy through your connected Cloudflare build.
4. If your website imports the browser package, update it as required by the release and rebuild the site.
5. Open comments on your website and check sign-in, posting and reactions.

Source deployments apply the values in Wrangler's `vars`. If you changed public settings in the Cloudflare dashboard, copy those values into your source configuration before deploying. Keep `SESSION_SECRET` to preserve existing sign-ins.

To roll back, restore the previous Worker version and the corresponding website bundle. A code rollback does not reverse a database migration. Follow any storage instructions in the release notes. See [Cloudflare's rollback guide](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).

## Troubleshoot

| Symptom | What to do |
| --- | --- |
| Setup loads, but comments do not | Complete the GitHub credentials and repository settings on the setup page |
| Your website is rejected | Add its exact origin to the repository policy, including `www` if used |
| The repository or category cannot be found | Enable Discussions, install the App on the repository and match the category name |
| Sign-in fails after a domain change | Set the GitHub callback to `PUBLIC_ORIGIN` plus `/auth/callback` and update the site's service URL |
| Native requests fail in the browser | Check the browser console for CORS or Content Security Policy errors; allow your service in `connect-src` |
| Requests return `VERSION_MISMATCH` | Deploy matching Worker and browser package versions, then reload the page |
| A request returns 429 | Wait for the supplied retry interval; check Cloudflare and GitHub usage if it recurs |
| A submission has an uncertain result | Check GitHub before posting again. Retry in the existing composer so the service can recover the original operation |
| Comments fail during busy periods | Check Worker execution errors and CPU, then requests, object duration and SQLite allowances |
| A custom sort does not load | Check the returned reason and retry time in [custom sort troubleshooting](#when-a-custom-sort-cannot-load) |

The setup page's repository check contacts GitHub and verifies access and the category. `/api/v2/setup` reports whether service settings are configured. `/healthz` checks that the service responds.

## When a custom sort cannot load

For an order such as "Popular", check the reason returned with the API's `paused` status:

- `budget`: wait for the allowance to reset, or adjust `RANKING_BUDGET` after checking account usage.
- `upstream`: GitHub could not complete the read. Retry after the reported time.
- `freshness`: collection could not meet `maxAgeSeconds`. Increase that age or reduce the selected ranking inputs.
- `size`: the collection or returned order exceeded its size limit. Check discussion size and `maxOrderBytes`.
- `inputs`: score data is missing or invalid. Check the profile and service errors; include both when reporting a persistent failure.

See [sorting configuration](CONFIGURATION.md#sort-by-reactions-or-reply-counts) for the settings and [API state](API.md#ranked-views) for custom interfaces.

## Rotate credentials

Add the new GitHub App key or client secret in Cloudflare and test sign-in before retiring the old credential. Keep `SESSION_SECRET` during routine updates. Changing it requires readers to sign in again.

## Logs

Use request counts, timing and error codes to investigate failures. Exclude comment bodies, authorization headers, callback query strings and session tokens from logs. The supplied deployment disables Workers observability; check account-level logging separately.

See [security](../SECURITY.md) for access controls and session storage.
