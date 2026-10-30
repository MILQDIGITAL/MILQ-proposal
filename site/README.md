# MILQ. — brand site concept

A static, multi-page design prototype for a new MILQ. website. Open `index.html`
through any static server (`python3 -m http.server` in this folder) — no build step.

## Concept: "Commerce, clarified."
MILQ. is opaque until you work with it, then everything is clear. The site turns
that into one consistent motion language: things move from cloudy to clear.

- **Fog hero** — a WebGL milk fog sits over a wall of client work; the cursor wipes it
  away and it slowly pours back. On touch devices a slow path clears it for you.
  The headline uses a difference blend, so it reads ink on milk and light on photos.
- **Pixel resolve** — images arrive as a coarse pixel grid and sharpen into focus
  (after Lama Lama's dithered WebGL images).
- **Focus scroll** — the manifesto blurs into focus word by word.
- **Milk gauge** — a measuring tube on the right edge fills as you scroll, marked in ml.
- **Pour transitions** — a cobalt wave rises between pages and drains on arrival.
- **Footer glass** — the giant MILQ. logo fills with milk as you reach the bottom.

## Borrowed from the references, then reworked
| Reference | Pattern | Here |
| --- | --- | --- |
| lamalama.com | Floating nav pill whose line changes per section; Swup transitions; dithered WebGL images; work rows with thumbnail strips; collapsing sticky process steps; live clock | Context line scrambles per section; pour transition; pixel resolve; rows with a cursor-following peek; process steps; Sydney clock |
| moustacherepublic.com | Full-colour service cards that stack on scroll; condensed display type | Four service cards that deepen from skim to ink |
| milqdigital.co | Anton MILQ. wordmark, giant footer logo, services/FAQ structure | Logo kept in Anton caps; footer logo now fills like a glass |

## Pages
- `index.html` — home
- `work.html` — filterable work, grid/list views
- `case.html#<slug>` — case study template, rendered from `assets/js/data.js`; scroll
  past the end to pour into the next case
- `contact.html` — brief builder; the glass fills as the brief gets fuller

## Stack
Vanilla HTML/CSS/JS, GSAP 3.12.5 + ScrollTrigger, Lenis 1.1.13 (CDN). Fonts: Anton
(logo + display), Geist, Geist Mono. Respects `prefers-reduced-motion`.

## Placeholder content
All client brands, case-study numbers and quotes are fictional placeholders.
Photography is from Unsplash via picsum.photos. Replace both before launch.
The contact form is not wired to anything.
