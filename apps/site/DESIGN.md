# Sangha landing page: design notes

Static Astro page in `src/pages/index.astro`. Copy lives in `landing-copy.md`, the brief and the facts we may claim in `brief.md`. Change the copy there first.

## Decisions

- **Identity**: the app's own. "Riverbed at night" palette, Inter only (optical size axis for headlines), coral used only for "needs you". The pebble is the only character: the logo, an inline glyph in the headline, the legend and the closing image.
- **Hero**: the headline left, the subline and CTAs right, then the live board as the product shot. The board (`src/scripts/board.ts`) uses the app's geometry, sprites, rings and motion, and plays a ten-beat loop: a session needs you, subagents land, one errors, one finishes, a cairn grows until it offers a fresh start. It only runs while on screen and holds a still frame with reduced motion.
- **Riverbed shader**: Paper's `water` shader (`src/scripts/riverbed.ts`), caustics barely lighter than the background, masked to an ellipse under the board, the product shot and the closing pebble (warm tint there). It is decorative: skipped without WebGL, frozen with reduced motion.
- **Product shots**: captured from demo data with `scripts/readme-screenshot/capture.mjs` (desktop), the phone capture, and `apps/site/scripts/capture-features.mjs` (the feature crops). Never real sessions. On phones, the phone capture replaces the desktop one.
- **Features**: a bento where every card shows the feature (orchestrator, usage popover, Remote Control, feedback crops; terminal and worktrees drawn with the pebbles). No icon-only cards and no fact strip under the hero: they told instead of showing.
- **Motion**: sections fade up once on entry; buttons scale to 0.97 on press; the copy button swaps to a check with a blur crossfade. Nothing else moves except the board and the water.
- **Not included on purpose**: logos, testimonials, star counts, numbers we cannot prove, eyebrows above headings, a pricing section.

## Mobbin references

- Nav: rerun and Affinity (links grouped with the logo, on the page's left edge), Linear (one small filled button for the main action, hairline only once scrolled).
- Hero: Retool (left headline, product UI right below the fold line), Descript (product shot directly under the CTAs).
- Features bento: Cursor (one product crop per card, cropped off the edge). Board legend: Linear "professional tool" grid (hairline cells, small icon, title, two lines), Cursor features (one idea per cell).
- Install: Giga "pip install is open" (one command block, nothing around it).
- FAQ: two columns, heading left, plain disclosure list right.

## Open points

- (verify) There is no LICENSE in the repo yet: the page never says "open source" until there is one.
- The GitHub links point to `sopial42/sangha`.
- The social preview image is `public/og.png` (the hero). It is only referenced once `site` is set in `astro.config.mjs`, since `og:image` needs an absolute URL.
