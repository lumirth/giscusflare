# giscus and giscusflare

Both projects put website comments in GitHub Discussions, using a repository you choose. Readers sign in with GitHub to participate.

[giscus](https://giscus.app) runs a hosted service. You install its App and generate an embed script. It supports themes, custom CSS, website restrictions and framework wrappers. It can also be [self-hosted](https://github.com/giscus/giscus/blob/main/SELF-HOSTING.md).

Deploy giscusflare to your Cloudflare account and connect GitHub through its setup page. You can embed the default interface, replace its components or build your own interface with the JavaScript API.

| Choice | Hosted giscus | giscusflare |
| --- | --- | --- |
| Service | Operated by the giscus project | Deployed to your Cloudflare account |
| Embedding | Iframe | Iframe or direct rendering in your page |
| Interface | Widget settings, themes and custom CSS | Themes, replaceable components or your own presentation |
| Allowed websites | Repository `giscus.json` | Service policy, restricted by default |
| Other people's repositories | Install the giscus App | Enable open hosting and let owners install your App |

See [giscus advanced usage](https://github.com/giscus/giscus/blob/main/ADVANCED-USAGE.md) and [giscusflare customization](EXTENDING.md) for configuration details.

## Reuse existing discussions

Install your giscusflare App on the same repository. Keep the category, page mapping, strict setting and any explicit discussion numbers. Test a page with an existing conversation before replacing your site's embed.

giscusflare then loads the existing discussion and its comments. Readers authorize your App when they next sign in.

[Integration](INTEGRATION.md) explains the mapping choices.
