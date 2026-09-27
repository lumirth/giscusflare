# Release verification

The 1.0 implementation passes 155 core tests, 14 native workerd tests and 17 independent presentation tests. GitHub's Linux checks and project-page build also pass. See [verification evidence](CONFIDENCE.md) for the tested scope and [Cloudflare usage](../FREE-TIER.md) for resource measurements.

The package was extracted outside the workspace and used to build browser and Worker consumers. A separate Kukas source copy built against the archive without a sibling checkout. The package check excludes test and development assets.

The public Deploy button reaches Cloudflare's source-import screen with the expected build and deployment commands. The deployed setup page generates GitHub App registration settings and checks the repository policy before generating an embed. The import-screen check did not create a second deployment through that dashboard flow; the live demo service was deployed with Wrangler.

The public project page serves one persistent discussion through its default and forum presentations. Live browser checks cover sign-in, drafts across design changes, preview, comments, editing, reactions and replies. Native requests and iframe requests reject foreign origins.

The deployed reference workload completed 12,100 requests with no HTTP or execution errors. Its 6.85 ms p99 Worker CPU missed the stricter 5 ms engineering target. Measurements cover the configured workload, not a universal daily pageview capacity.

The [release procedure](IMPLEMENTATION.md) lists the checks to repeat for later releases. [Presentation evidence](PRESENTATION.md) distinguishes visual comparisons from automated behavior tests.
