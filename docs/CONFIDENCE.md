# Verification evidence

Recorded on September 27, 2026. [Testing](../TESTING.md) describes the repeatable checks; [Cloudflare usage](../FREE-TIER.md) separates resource measurements from capacity estimates.

## Automated checks

The release passes 155 core tests, 14 native workerd tests and 17 tests of the independent Kukas presentation. Coverage includes origin policy, scoped authorization, operation recovery, session rotation, response caching, ranking budgets and browser state. Unsupported HTTP protocol versions return a reload instruction without contacting GitHub.

The packed archive was extracted outside the workspace. Both its browser and Worker imports built there, and the Kukas presentation built with no sibling source checkout. The package includes its asset manifest and selected asset-copy API; it excludes test and development assets.

A native workerd test transfers a 294 KB Unicode response through the production RPC representation and checks its body, status, expiry and cache headers. The service transfers completed text through RPC after deployed streamed-response tests showed canceled object calls. That change also avoids relying on the streamed-body lifetime behavior reported in [workerd issue 7277](https://github.com/cloudflare/workerd/issues/7277).

## GitHub queries

Seven production query paths passed with a real GitHub App installation token: combined discussion/page access, minimal discussion access, selected comment hydration, comment permissions, fresh comment detail, replies and counts. Each GraphQL query consumed one point in the observed rate counter. This test performed no content writes.

Separate live public-discussion queries returned 800 reaction candidates in 560,897 bytes and 500 candidates with all supported ranking inputs in 380,564 bytes. These tests establish that those selections worked on those discussions; GraphQL cost, response size and latency still depend on the selection and data.

## Browser observations

Desktop WebKit checks exercised GitHub sign-in, return to the website, writing, Preview/Write, posting, author editing and native undo/redo. Local release checks also covered draft preservation across design changes, focus and selection through refresh, reply expansion and posting, and an iframe whose first page arrives in its initial response.

The narrow-layout pass preserved the host's 8px gutter without document overflow. [Presentation evidence](PRESENTATION.md) records theme and rich-content checks. Physical iOS, Firefox, the full locale/theme matrix and every real-token moderation role have not been covered by this release pass.

## Storage and recovery

A production state export restored all 143 operational records into native workerd SQLite with identical contents. The export included mappings, sessions and 129 completed operation receipts. The existing deployed code was restored after the export, which also exercised code rollback.

The ranking runtime tests include actual object restarts, stale job fencing, partial GitHub failures, changed permissions and daily budget pauses. A 10,000-candidate collection restored from 79 rows; 100,000 candidates restored from 782 rows. These are compact candidate records, not copies of comment bodies.


## Deployed reference run

All 12,100 HTTP requests completed successfully. Cloudflare recorded 6.85 ms p99 outer Worker CPU, 20.57 GB-s of repository duration and 3,071 written SQLite rows. The workload used a simulated upstream and concurrent traffic. [Cloudflare usage](../FREE-TIER.md) gives the full workload, the missed 5 ms engineering target, real GitHub timing and the limits of extrapolating daily capacity.

The public demo passed same-window GitHub sign-in, draft preservation between designs, preview, posting, editing, reactions and replies. GitHub readback confirmed the saved comment and reaction. Its native and iframe paths accepted the project origin and rejected another origin. Repeated iframe requests also passed the real Cache API immutable-header case.
