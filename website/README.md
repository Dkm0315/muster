# muster-website

Marketing site + portal-shell preview for [Muster](../README.md). Plain Vite + vanilla TypeScript; the only runtime dependency is `three` (the hero constellation). No React, no webfonts, no backend.

## Develop

```bash
pnpm install                          # from repo root
pnpm --filter muster-website dev      # http://localhost:5173
pnpm --filter muster-website build    # -> website/dist
pnpm --filter muster-website preview  # serve the production build
pnpm --filter muster-website typecheck
```

## Pages

- `/` — marketing site. Hero constellation (300 nodes mustering into formation, three.js, lazy-loaded after first paint behind a CSS poster), 3D→ASCII toggle (also auto-engages past the hero), animated terminal replay using the real CLI output formats, "why" cards, comparison table, surfaces diagram.
- `/portal.html` — static mock of the future control portal (left rail / run log with collapsible tool blocks / artifact theater / "muster view" topology strip). Sample data only, clearly labeled preview, `noindex`.

## Deploy

The build is fully static — any static host works:

- **Vercel**: project root `website/`, build command `pnpm build`, output `dist`. (Or from monorepo root: `pnpm --filter muster-website build`, output `website/dist`.)
- **Netlify**: base `website`, build `pnpm build`, publish `dist`.
- **GitHub Pages**: upload `website/dist` (e.g. `actions/upload-pages-artifact` with `path: website/dist`). If serving from a sub-path (`/<repo>/`), set Vite `base` accordingly in `vite.config.ts`.

Update the canonical / `og:url` in `index.html` to the final domain before going live. There is intentionally no `og:image` yet — add a 1200×630 raster when one exists.

## Notes

- `prefers-reduced-motion` disables the constellation, terminal typing, and SVG pulses; a CSS radial-gradient poster remains.
- The three.js chunk is code-split and loaded after first paint; the page is fully usable without it (and without JS, via `<noscript>` terminal fallback).
- ASCII mode samples a 110×48 render target each ~66ms and maps luminance to a character ramp in a `<pre>` — the same scene, no second renderer.
