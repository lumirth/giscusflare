# Verification results

These records describe the checks performed for the initial release and subsequent rendering update. To repeat them, follow [testing](../TESTING.md) and the [release procedure](IMPLEMENTATION.md). For capacity planning, start with [Cloudflare usage](../FREE-TIER.md).

## Automated and package checks

The September 27, 2026 release pass ran 155 core tests, 14 native workerd tests and 17 tests of the independent Kukas presentation. They covered origin policy, authorization, interrupted writes, session rotation, caching, ranking budgets and browser state.

Package checks extracted the release archive outside the workspace and built both browser and Worker consumers. The independent presentation also built against that archive. The checks verified public imports, selected static assets and the exclusion of development files.

A native workerd test transferred a 294 KB Unicode response through the production RPC format and checked its body, status, expiry and cache headers.

## Real GitHub queries

Seven query paths passed with a GitHub App installation token: discussion/page access, minimal discussion access, selected comment hydration, comment permissions, fresh comment detail, replies and counts. Each consumed one GraphQL point in that run.

Separate queries against public discussions returned 800 reaction candidates in 560,897 bytes and 500 candidates with all supported ranking inputs in 380,564 bytes. The service uses these compact selections for ranking and fetches comment bodies separately. [GitHub API use](GITHUB-API.md) explains the query constraints.

## Browser checks

Desktop WebKit checks exercised sign-in, return to the website, writing, Preview/Write, posting, author editing and native undo/redo. Local checks covered draft preservation across design changes, focus and selection through refresh, reply expansion and posting, and the first-page iframe response.

The deployed demo passed same-window GitHub sign-in, draft preservation between designs, preview, posting, editing, reactions and replies. GitHub readback confirmed the saved comment and reaction. Both native and iframe requests accepted the project website and rejected an unrelated origin.

The September 28 rich-content pass compared the full giscus example comment in the default and forum presentations. It checked headings, tables, code, GitHub code previews, images, malformed TeX and four valid math expressions. Mobile light and dark checks at 390 CSS pixels found no page overflow. [Presentation](PRESENTATION.md) links the earlier theme comparisons.

The recorded checks used desktop WebKit and Chromium. Physical iOS, Firefox and a complete locale/theme matrix remain useful additions to release coverage.

## Storage and recovery

A production state export restored all 143 operational records into native workerd SQLite with identical contents. The export included mappings, sessions and 129 completed operation receipts. The check also restored the previous deployed code.

Ranking tests exercised object restarts, interrupted jobs, partial GitHub failures, permission changes and daily budget pauses. Restoring a 10,000-candidate collection read 79 rows; restoring 100,000 candidates read 782 rows.

## Deployment and resource checks

The Deploy to Cloudflare button reached the source-import screen with the expected build and deploy commands. The deployed setup page generated GitHub App settings and checked repository policy before producing an embed. The demo service used Wrangler for deployment; a complete fresh account setup through the button remains on the [release checklist](IMPLEMENTATION.md#deployment-and-setup).

A concurrent deployed test completed 12,100 HTTP requests across 100 discussions, with 6.85 ms p99 Worker CPU, 20.57 GB-s of object duration and 3,071 SQLite writes. [Cloudflare usage](../FREE-TIER.md#measurements-from-a-deployed-service) records its traffic mix, simulated upstream timing, CPU tail and comparison with separate real GitHub queries.

## Shared reads in 2.0

The repository tests exercise overlapping count batches from different website pages, cached missing discussions, a write that preserves unrelated discussion reads, and access expiry after a repository becomes private. Alternating ready rankings for two discussions makes no further GitHub calls or candidate-table reads while access verification remains fresh. Count misses combine verification and summaries in one GraphQL request.

The native workerd suite checks the v2 protocol, response transfer, SQLite and encrypted-session survival across process restarts. Package checks build isolated browser and Worker consumers from the release archive. These checks complement the earlier deployed traffic measurements above.
