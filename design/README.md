# design

The design system and screen specs the web app was built from, plus static mockups and screenshots of them.

| Path | Purpose |
|---|---|
| [DESIGN.md](DESIGN.md) | Concept and voice, type, colour, spacing, motion, icons, components, screens, responsive and accessibility rules, number formatting, implementation notes |
| [mockups/](mockups/README.md) | Static HTML mockups of every screen, sharing the tokens and component CSS |
| [screens/](screens/README.md) | Screenshots of the mockups at desktop and phone width, light and dark |

## Decisions and tradeoffs

- **The price ladder is the centrepiece.** A vertical ladder of tiers with a marker at the projected price shows the core idea (the group reaches a cheaper tier) without reading numbers.
- **Prices in a monospace font, on a warm paper background,** so amounts line up and read like a ledger.
- **Mockups are plain HTML and CSS,** reviewable in any browser with no build; the app re-implements them in Svelte rather than importing them.
- To find how the app applies these rules visit [../web/src/lib/styles/tokens.css](../web/src/lib/styles/tokens.css) and [../web/src/lib/format.ts](../web/src/lib/format.ts).
