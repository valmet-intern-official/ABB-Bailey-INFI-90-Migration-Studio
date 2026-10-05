# Migration Studio — landing design guidelines

The public landing page (`src/app/page.tsx`) is built from `src/components/landing/*` and styled by
`components/landing.css`. Every value in that stylesheet resolves to a token in `tokens/tokens.css`.
The engineering workspace (`/workspace`, `/m1`) keeps its own styles in `src/app/globals.css`.

## Principles

- **Source-first.** Visuals are real product output: decoded hex, reconstructed SVG sheets, M1 graphics,
  loop-list rows and validation messages taken from the M10 reference module. Do not add mock dashboards,
  invented metrics, stock imagery or decorative illustration.
- **Calm, engineered layout.** Generous whitespace, a 12-column rhythm inside `--ds-container`, and
  asymmetric splits (5 / 7) rather than centred marketing blocks.
- **Borders before shadows.** Cards are separated by `--ds-border`; `--ds-shadow-2` is reserved for media
  that genuinely sits above the page (hero video, M1 graphic, upload tools).
- **One accent.** `--ds-accent` (industrial green) marks primary actions, active states and data
  highlights. Amber is used only for warnings in the validation log.

## Typography

| Role | Token | Notes |
| --- | --- | --- |
| Display (hero h1) | `--ds-text-display`, weight `--ds-weight-display` | Three short lines, last line in accent |
| Section heading | `--ds-text-4xl` | Max ~16 words, sentence case |
| Card heading | `--ds-text-lg` | Semibold |
| Body | `--ds-text-md` / `--ds-text-base` | Max width `--ds-measure` |
| Eyebrow, metadata, file names | `--ds-font-mono`, `--ds-text-2xs`–`--ds-text-xs` | Uppercase only for eyebrows |

Inter and IBM Plex Mono are loaded with `next/font` in `src/app/layout.tsx`.

## Components

All classes are prefixed `lp-` so they cannot collide with workspace styles.

- `Section` / `SectionHeader` (`primitives.tsx`) — numbered sections with an eyebrow (`01 — LABEL`),
  heading and lead. Use `tone="alt"` to alternate the background.
- `PrimaryButton` / `SecondaryButton` — 48px controls; one primary action per view.
- Figures — always a `<figure>` with a `figcaption` stating what the visual is and where it came from.

## Motion

- Entrance and scroll reveals are progressive enhancement, wrapped in
  `@media (prefers-reduced-motion: no-preference)`; scroll-driven effects also require
  `@supports (animation-timeline: view())`.
- Hover lifts use `--ds-lift` and `--ds-dur-fast`. Nothing loops except the hero video.
- The hero video is muted, never autoplays under reduced motion or Save-Data, pauses off-screen and has a
  visible pause control. The poster is the first frame, so layout is identical before playback.

## Accessibility

- Visible focus ring (`--ds-focus`) on every interactive element; skip link to `#main`.
- Text contrast on white is at least 4.5:1 (`--ds-text-subtle` is the lightest text colour allowed).
- Decorative graphics are `aria-hidden`; data visuals have an `aria-label` or a text equivalent.
