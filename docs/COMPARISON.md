# giscus and giscusflare

Both projects put website comments in GitHub Discussions, using a repository you choose. Readers sign in with GitHub to participate.

[giscus](https://giscus.app) runs a hosted service. You install its App and generate an embed script. It supports themes, custom CSS, website restrictions and framework wrappers. It can also be [self-hosted](https://github.com/giscus/giscus/blob/main/SELF-HOSTING.md).

Deploy giscusflare to your Cloudflare account and connect GitHub through its setup page. You can embed the default interface, replace its controls/content rendering or build your own interface with the JavaScript API.

| Choice | Hosted giscus | giscusflare |
| --- | --- | --- |
| Service | Operated by the giscus project | Deployed to your Cloudflare account |
| Embedding | Iframe | Iframe or direct rendering in your page |
| Interface | Widget settings, themes and custom CSS | Themes, replaceable controls or your own presentation |
| Native content | Provider presentation in its iframe | GitHub defaults, complete code/math replacements or your own Markdown pipeline |
| Allowed websites | Repository `giscus.json` | Service policy, restricted by default |
| Other people's repositories | Install the giscus App | Enable open hosting and let owners install your App |

See [giscus advanced usage](https://github.com/giscus/giscus/blob/main/ADVANCED-USAGE.md) and [giscusflare customization](EXTENDING.md) for configuration details.

## Reuse existing discussions

Install your giscusflare App on the same repository. Keep the category and choose each known discussion number or its exact existing hash-backed page key. Test a page with an existing conversation before replacing your site's embed.

giscusflare then loads the existing discussion and its comments. Readers authorize your App when they next sign in.

[Integration](INTEGRATION.md) explains exact page and discussion selection.
