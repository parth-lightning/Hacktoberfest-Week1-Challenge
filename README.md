# Fieldwork starter

A React + TypeScript landing site with an Express API and the Sylva Living Green
hero from ThreeUI. The organization name, project cards, copy, and contact details
are placeholders to personalize.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
npm run dev
```

In a second terminal, run the API:

```sh
npm run dev:server
```

Vite serves the site at `http://localhost:5173` and proxies `/api` requests to
the Express server on port `3001`.

## Build

```sh
npm run typecheck
npm run build
npm start
```

## Contact endpoint

`POST /api/contact` accepts JSON with `name`, `email`, and `message`. It checks
the required fields and size limits, then returns `202 Accepted`. The starter
intentionally does not save or email submissions; connect a database or email
provider before using the form for real inquiries.

## ThreeUI hero

The Home page imports `SylvaHero` from the package's component entry point and
its stylesheet from `@designcodeio/threeui/style.css`. The Vite config copies the
HTML and local assets required by the package's iframe into the public directory
at dev/build time. They are generated from the installed npm package and are not
checked in.
The package API exposes Sylva's Living Green scene; the `variant` prop in the
provided example is not part of the published TypeScript API. Typography and
primary-color customization are configured from the example. The package is MIT
licensed; see its license and third-party asset notices for details.
