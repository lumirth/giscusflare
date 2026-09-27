# giscus and giscusflare

Both projects put website comments in GitHub Discussions, using a repository you choose. Readers sign in with GitHub to participate.

[giscus](https://giscus.app) runs a hosted service. You install its App and generate an embed script. It supports themes, custom CSS, website restrictions and framework wrappers. It can also be [self-hosted](https://github.com/giscus/giscus/blob/main/SELF-HOSTING.md).

giscusflare starts with deployment to your Cloudflare account. Its setup page connects your GitHub App and allowed websites. Its JavaScript API lets custom interfaces share the behavior behind the default presentation.

| Choice | Hosted giscus | giscusflare |
| --- | --- | --- |
| Service | Operated by the giscus project | Deployed to your Cloudflare account |
| Embedding | Iframe | Iframe or direct rendering in your page |
| Interface | Widget settings, themes and custom CSS | Themes, replaceable components or your own presentation |
| Allowed websites | Repository `giscus.json` | Service policy, restricted by default |
| Other people's repositories | Install the giscus App | Enable open hosting and let owners install your App |

The [giscus advanced guide](https://github.com/giscus/giscus/blob/main/ADVANCED-USAGE.md) describes its origin restrictions and theme options. The [giscusflare customization guide](EXTENDING.md) shows the shared JavaScript API.

## Reuse existing discussions

Install your giscusflare App on the same repository. Keep the category, page mapping, strict setting and any explicit discussion numbers. Test a page with an existing conversation before replacing your site's embed.

A matching page selects the existing GitHub discussion, so no comment import is needed. Readers authorize your App when they next sign in. Also test a page without a discussion, its first contribution, replies, reactions and custom styling.

Keep the previous embed configuration with your deployment history so you can restore it if needed. [Integration](INTEGRATION.md) explains the mapping choices.
