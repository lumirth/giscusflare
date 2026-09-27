# Public website

The GitHub Pages site introduces giscusflare and presents one real discussion in the default interface and a forum design. Both use the public conversation API. Switching designs keeps the same conversation object, sign-in state and drafts.

The public demo service allows only the website's origin. Each adopter deploys a separate service and uses its setup page to configure embedding.

## Build

Set `GISCUSFLARE_DEMO_ORIGIN` to the demo Worker's HTTPS origin and `GISCUSFLARE_DEMO_NUMBER` to its discussion number in `lumirth/giscusflare`, then run `npm run build:website`. The output is `dist/website`.

Set `GISCUSFLARE_WEBSITE_DOMAIN` to use a custom domain. The build writes a matching `CNAME`. Without it, use the GitHub Pages project address, `https://lumirth.github.io/giscusflare/`.

To preview an already built site, serve `dist/website` with a static server. Its origin must be allowed by the demo service to load comments.

## Publish

Configure those values as GitHub Actions repository variables. Enable GitHub Pages with GitHub Actions as its source, then run the `Project page` workflow. It builds and uploads `dist/website`.

The workflow does not deploy the comments Worker. Deploy that service first, install its GitHub App on `lumirth/giscusflare`, create the demo discussion and allow the public website's origin.
