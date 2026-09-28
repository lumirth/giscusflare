# Build the project website

This directory contains the page at [giscusflare.kukas.me](https://giscusflare.kukas.me/). Edit `index.html` for copy and `style.css` for the surrounding page. The comments use the default interface and the [forum example](../examples/forum.ts).

## Build

From the repository root:

```sh
GISCUSFLARE_DEMO_ORIGIN=https://your-demo.workers.dev \
GISCUSFLARE_DEMO_NUMBER=1 \
npm run build:website
```

Use your demo service's HTTPS origin and a discussion number in `lumirth/giscusflare`. The output is `dist/website`. The repository is set in `demo.ts`.

Set `GISCUSFLARE_WEBSITE_DOMAIN` to use a custom domain. The build writes a matching `CNAME`. Without it, the GitHub Pages project address is `https://lumirth.github.io/giscusflare/`.

Serve `dist/website` with a static server to preview the page. To load comments locally, allow the preview origin in your demo service's repository policy.

## Publish

Deploy the demo Worker, install its GitHub App on the discussion repository, create the demo discussion and allow the public website's origin.

Set the build values above as GitHub Actions repository variables. Enable GitHub Pages with GitHub Actions as its source. Push to `main` or run the **Project page** workflow to build and publish the website. The Worker is deployed separately.

When changing the page layout, keep the comments below the introduction card. Page styles should stop at `#demo-comments` so the default interface retains its own spacing and typography.
