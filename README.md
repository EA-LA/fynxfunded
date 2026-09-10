# FYNX Funded

Official web application for the FYNX Funded trading-evaluation platform.

## Development

```sh
npm ci
npm run dev
```

## Quality checks

```sh
npm run lint
npm test -- --run
npm run build
```

## Production

The `main` branch deploys to [www.fynxfunded.com](https://www.fynxfunded.com) through Vercel.

Public search metadata is defined in `index.html`, the XML sitemap is located at `public/sitemap.xml`, and authenticated application routes are excluded from search in `public/robots.txt`.
