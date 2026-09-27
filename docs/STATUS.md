# Release verification

The release combines the shared conversation API, cloud-first setup, optional ranking and public-response caching. Verification covers the package, browser behavior, GitHub permissions and deployed Cloudflare usage separately.

## Package and setup

The package archive has been extracted outside the workspace and used to build both a custom browser consumer and the Worker. A separate Kukas source copy built against that archive with no sibling giscusflare checkout.

The package checks exclude development assets and test code. Setup tests exercise App registration parameters, generated Cloudflare values, local secret generation and repository verification before embed generation. Public-page tests check the deployment link and both presentations.

## Browser behavior

The standard and forum presentations share one conversation object in the public demo. Automated checks preserve drafts and sign-in when switching designs, make no additional read for the switch, and retain editor nodes and selection through refresh.

The [presentation record](PRESENTATION.md) contains the earlier theme and native undo comparisons. It identifies the browser and date of each observation. [Testing](../TESTING.md) covers the remaining browser acceptance work.

## Deployment evidence

Local workerd tests and storage experiments establish runtime behavior and row accounting for their recorded workloads. They do not measure deployed Worker CPU percentiles. [Cloudflare usage](../FREE-TIER.md) records the current measurement boundary.

Before publishing a release, record the fresh deployment path through a real website comment, native and iframe authorization checks, the permitted and rejected origin checks, and the deployed resource workload. Keep the source revision, configuration and service version with those results.
