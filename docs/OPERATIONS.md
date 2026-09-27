# Operate your service

GitHub stores the discussion content. Giscusflare stores the state needed to connect pages, recover writes and manage sessions. Each repository has a SQLite Durable Object. Public response caches are disposable; mappings and unresolved write records are not.

## When something fails

| Symptom | Check |
| --- | --- |
| The setup page loads, but comments do not | Finish the GitHub credentials and repository settings |
| A website is rejected | Its exact origin must match the repository policy |
| The repository or category cannot be found | Enable Discussions, install the App and match the category name |
| Sign-in returns to the wrong address | Match the GitHub callback to `PUBLIC_ORIGIN` plus `/auth/callback` |
| Native requests fail in the browser | Inspect CORS errors and your site's `connect-src` policy |
| A request returns 429 | Respect the retry interval; inspect service and GitHub limits |
| A submission has an uncertain result | Retain its draft and retry through the same conversation; inspect GitHub before submitting it as a new comment |
| Worker requests fail under load | Check CPU errors, daily requests, object duration and SQLite allowances |

`/healthz` is a service health check. `/api/v1/setup` reports whether deployment settings are configured. The setup page's repository check goes further by contacting GitHub. Verify sign-in and a contribution on the actual website after changing credentials or routing.

## Updates

Record the current Worker version, source revision, public configuration and website integration. Deploy the service together with any custom browser package changes required by the release. Keep the Worker identity, Durable Object binding and migration history.

Preserve page-to-discussion mappings and unresolved operations before a storage change. A successful GitHub write can outlive a lost HTTP response. Its pending record prevents an automatic retry from creating another contribution.

After deployment, verify anonymous loading, sign-in, a comment, a reply and a reaction. Restore the previous Worker version and matching website bundle if necessary. Cloudflare rollback restores code; it does not undo GitHub comments or reverse a database migration. See [Cloudflare's rollback guide](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).

## Cache and ranking freshness

The default public display lifetime is one minute; page-list counts use five minutes. Increasing those values reduces repeated reads at the cost of later visibility for other readers. Your own successful writes appear immediately. Upstream privacy changes can take the remaining public cache lifetime to affect a previously cached response.

Optional ranking has its own observation age and resource budget. Its data can be older than the comment page currently being displayed. A presentation should use the ranking status supplied by the service and keep chronological comments usable when ranking needs more work or has reached its allocation.

## Credentials and logs

Rotate an App key or client secret by setting the new Cloudflare secret and testing sign-in before retiring the old credential. Changing `SESSION_SECRET` invalidates encrypted reader sessions.

The browser stores an opaque service session, sign-in proofs and optional draft recovery. GitHub tokens stay encrypted on the service. Public discussion content and profiles remain visible on GitHub.

Measure requests, CPU, object duration, SQL rows and errors without logging comment bodies or credentials. Keep authorization headers, callback query strings and session tokens out of logs. The supplied deployment disables Workers observability; account settings may add logging independently.
