# Maintain your service

## Update and restore

Choose a [release](https://github.com/lumirth/giscusflare/releases) and update matching API, internal content producer and browser consumers. Preserve Worker names, routes, Repository binding/class identity, migration history, registered repository identities and live secrets, including SESSION_SECRET. Commit native consumers' lockfiles and rebuild them.

Record the known-good content/API/website versions before activating a publication. Deploy a new internal content Worker once before using inactive version uploads; subsequent releases can upload all components before activation. Activate producer, API and matching website in that order. Separate service deployments are not atomic: finish or deliberately roll back a partial activation using recorded exact versions. Code rollback does not restore stored data.

Source deployments apply Wrangler variables; copy dashboard-only public settings into source before deploying. Check health, assets, anonymous reading, content interpretation and available contribution paths. Report real authenticated GitHub acceptance separately from anonymous or simulated checks.

## Host-prepared content

Tie producer revision to its actual trust policy, compiler and immutable resource build. The API's CONTENT binding reaches a separate internal producer; local prepared previews do not need provider discovery or authentication. Completed artifact reuse is hot, bounded and disposable, so a new isolate legitimately prepares again. No durable repository artifact cache is involved.

Required stylesheet URLs must remain reachable and allowed by the website CSP. Optional modules must be allowed for their controls to work, but a failed module does not erase readable HTML. Inspect the actual content request separately from reading/count requests. Test cold source, styles and enhancements independently, and confirm native preview shares the selected lifecycle.

## Troubleshoot

| Symptom | Inspect |
| --- | --- |
| Setup works, but reading fails | Registered repository/category/installation identities and current App credentials/scope |
| Website rejected | Exact allowed origin and rendering/return URLs |
| Open hosting rejected | Returned registration reference and current hosting policy |
| Sign-in fails after domain change | PUBLIC_ORIGIN, App callback ending /auth/callback, and website service URL |
| Native requests blocked | CORS plus website CSP connect-src |
| VERSION_MISMATCH | Matching protocol 6 service/browser, then reload |
| Count unavailable | Count observation request; do not interpret failure as zero |
| Formatted content unavailable | CONTENT binding, producer revision, safe output and required styles |
| Open page offers Reload | Producer resource fingerprint differs from the page’s selected manifest; reload the matching website |
| Code readable but controls unavailable | Optional profile module and website CSP |
| Account controls unavailable while reading works | viewerError and account-access retry, or needsAuthorization and reconnecting the retained author |
| Submission unknown | Retry unchanged intent as original author; inspect GitHub before creating another effect |
| Saved effect needs refreshed display | Confirmation is complete; retry its optional observation separately |
| Several recovered drafts | Choose the actual record; same destination does not mean same intent |
| HTTP 429 or load failures | Returned retry interval, provider allowance, CPU, requests, object duration and SQL usage |
| Named sort paused | Returned reason and retry time |

Setup registration verifies public installation/category access. `/api/v6/config` reports usable repository settings and `/healthz` reports service version; neither establishes an authenticated contribution.

## Named sorts

A paused budget result needs a reset or inspected budget change. Upstream means acquisition failed and should be retried after its reported interval. Size means configured collection/order limits were exceeded. A failed provider scan and a budget pause have different continuation semantics. See [ranking settings](CONFIGURATION.md#sort-by-reactions-or-reply-counts) and [capacity](../FREE-TIER.md#optional-ranking).

## Credentials and logs

Add replacement App credentials and verify real sign-in before retiring the old credentials. Preserve SESSION_SECRET during routine updates; changing it invalidates encrypted operational records. Re-register after an installation/category change rather than adding runtime discovery work to every request.

Log request counts, timings and error codes; exclude bodies, authorization headers, callback query strings and session tokens. The supplied deployment disables Workers observability; account-level logging is separate. See [security](https://github.com/lumirth/giscusflare/blob/main/SECURITY.md).
