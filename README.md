<img src="https://raw.githubusercontent.com/lumirth/giscusflare/main/public/brand/giscusflare-logo.png" alt="giscusflare" width="96" height="96">

# giscusflare

A customizable comments system powered by GitHub Discussions, self-hosted on Cloudflare.

- Replies and reactions, with Markdown, syntax highlighting and math.
- The default GitHub/giscus-inspired interface, with themes and multiple languages.
- Replace individual components or build your own interface in JavaScript.
- Deploy on Cloudflare's Free plan.

[Try the demo](https://giscusflare.kukas.me/) · [Customization](docs/EXTENDING.md) · [Cloudflare usage](FREE-TIER.md)

## Get started

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lumirth/giscusflare)

Deploy to your Cloudflare account, then open your new service's address. Its setup page helps you connect GitHub and generate the code to add comments to your website. Follow the [setup guide](DEPLOY.md).

## How it works

Choose a public GitHub repository for your comments. giscusflare finds the discussion for each page and creates one when someone first comments or reacts. Visitors use their GitHub accounts to participate, and you can read and manage the discussions on GitHub too.

Optional [named weighted sorts](docs/CONFIGURATION.md#sort-by-reactions-or-reply-counts) return a complete captured traversal and report the interval used to acquire its inputs. `refreshSeconds` controls acquisition cadence; it does not promise that every source value is younger than that interval.

Already using giscus? You can [keep your existing discussions](docs/COMPARISON.md#reuse-existing-discussions).

## Customize your comments

Use an iframe embed or [mount comments directly in your page](docs/INTEGRATION.md#native-rendering). The [customization guide](docs/EXTENDING.md) covers themes, component replacements and building a custom interface. The demo's [forum design](https://github.com/lumirth/giscusflare/blob/main/examples/forum.ts) is a complete example you can adapt.

## Documentation

- [Website integration](docs/INTEGRATION.md)
- [Configuration](docs/CONFIGURATION.md)
- [JavaScript API](docs/API.md)
- [Updates and troubleshooting](docs/OPERATIONS.md)
- [Contributing](https://github.com/lumirth/giscusflare/blob/main/CONTRIBUTING.md) and [testing](https://github.com/lumirth/giscusflare/blob/main/TESTING.md)

MIT licensed. See [credits and licenses](THIRD-PARTY-NOTICES.md).
