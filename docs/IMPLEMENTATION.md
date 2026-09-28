# Release procedure

Run these checks against the release build and record the results in [verification results](CONFIDENCE.md) and add the release to [release history](STATUS.md).

## Deployment and setup

Use the Deploy to Cloudflare button to create a service. Follow its setup page through GitHub App registration, configuration, repository verification and embed generation. Confirm that an empty deployment serves setup and refuses comment traffic, then test sign-in and a comment from an allowed website. Check that a different origin is rejected.

Confirm that the GitHub callback address has wildcard matching disabled. Test the generated Cloudflare values, including the repository policy and multiline private key.

## Browser behavior

Exercise the standard and forum presentations in native and iframe modes. Check Preview, browser undo, selection, focus, refresh while composing, design changes, reply pagination and uncertain-write recovery. Cover narrow and wide layouts, themes, keyboard use, code and math.

Include same-window and popup sign-in. Record the browsers used, including Safari, Firefox and physical iOS when tested. [Testing](../TESTING.md) describes the local harness; [presentation](PRESENTATION.md) records interface comparisons.

## GitHub access

Verify comment, reply, edit, delete, reaction and moderation behavior with reader and moderator accounts. Include denied permissions, revoked access, locked discussions, archived repositories, deleted discussions and changed repository identity. Compare successful changes with GitHub. See [GitHub API behavior](GITHUB-API.md).

## Resource measurements

Measure cold and warm reads, sign-in, preview, writes, counts and ranked views. Record Worker CPU and requests, object duration, SQLite operations and GitHub requests alongside the workload, configuration and deployed version. Compare with the [Free allowances](../FREE-TIER.md#free-allowances). Include traffic spread across many discussions, a burst on one popular post and a mix of signed-in and anonymous readers. For ranking, alternate between several discussions as well as testing a large one.

## Artifacts and website

Set the package version and GitHub release tag together. Build and run package validation, then attach `giscusflare-<version>.tgz` to that release. Verify the documented archive installation command in an independent website build.

Build the public page against its dedicated discussion and service. Check that both designs use that conversation, retain drafts when switching, and explain how visitors deploy their own service. Publish the page and release only after their verification records are complete.
