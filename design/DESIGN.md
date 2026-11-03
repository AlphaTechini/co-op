# Co-op design system and screen specs

Version 1.0 · 2026-11-03 · Owner: design · Implementer: SvelteKit (Svelte 5 runes), static adapter

This document plus the files in `design/mockups/` is the complete spec. The mockups are the visual source of truth: when this text and a mockup disagree on a pixel, the mockup wins; when they disagree on behaviour or data, this text wins. Data shapes come from `docs/SPEC.md` (sections 1.2 and 3.1) and the contract in `contracts/coop/src/views.rs`.

| File | What it is | What you do with it |
|---|---|---|
| `mockups/tokens.css` | Every design token, light and dark | Copy verbatim to `web/src/lib/styles/tokens.css`, import once in `+layout.svelte` |
| `mockups/components.css` | All component and page-layout CSS, class names match section 7 | Copy verbatim to `web/src/lib/styles/components.css`, import once after tokens. Split into component `<style>` blocks later only if you want; do not rename classes |
| `mockups/icons.svg` | The icon sprite (36 symbols) | Turn into `Icon.svelte` (section 6) |
| `mockups/overview.html`, `pool.html`, `receipt.html`, `spawn.html`, `how.html` | Static, high-fidelity screens with mockup data | Port the markup to routes and components |
| `mockups/kit.html` | States not shown on the five screens: buttons, every status, skeletons, empty state, banners, RPC error, toasts, field error, excluded member | Reference for state components |
| `screens/*.png` | Renders at 1440x900 and 390x844, light and dark | Compare your build against these |

Open any mockup in a browser and click the sun icon to flip themes.

---

## 1. Concept and voice

**Concept: the clearing slip.** Co-op is a neutral clearing house for small buyers, so it looks like a well-made ledger rather than a crypto dashboard: warm paper, ink, hairline rules, figures set in a ledger mono, and a serif reserved for the few sentences that matter (the headline, the invariant, the receipt verdict). Color is never decoration. It carries exactly three meanings:

- **Jade** means *in the group*: committed members, reached tiers, the current price, payments that respected the limit.
- **Cobalt, dashed** means *conditional intent*: an agent that is in only if the group reaches its number. Dashed borders and hatching are the visual signature of "not yet".
- **Amber** means *time pressure*: lock countdown, locked pools, awaiting settlement.

Everything else is ink on paper. The signature object is the **tier ladder**: a vertical price ladder where the group's marker drops down rungs as units arrive. The signature moment is a dashed cobalt member turning solid jade.

**Voice.** Plain, exact, numbers first. Write like a receipt, not a launch post.

- Sentence case everywhere. No title case, no ALL CAPS except the mono eyebrow labels (CSS does the uppercasing).
- Lead with the number: "8 more pledged units drop the price to 0.50", not "You're so close to unlocking savings!".
- Name things the way the contract does: *agent, pool, tier, limit, lock, settle, refund*. Never "wallet", "deal", "drop".
- No hype words (revolutionary, seamless, unlock, powerful, magic), no exclamation marks, no emoji.
- **No em-dashes anywhere in UI copy.** Use a period, a comma or a colon. Use `·` (U+00B7) only as a separator inside metadata lines.
- Prices always carry their unit once per group: "0.70 NEAR per unit" in heroes, bare "0.70" in tables whose header says NEAR.
- Use the real minus sign `−` (U+2212) for discounts: `−30%`.
- Use curly quotes for agent memos in prose (“ ”) and never fabricate a memo: if `memo` is empty, show nothing.
- Honesty is a feature: say "LLM off · rules parser", "demo", "testnet" plainly where relevant.

---

## 2. Typography

Load once in `app.html` (exact URL; do not add weights):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap" rel="stylesheet">
```

| Role | Family | Weights | Used for |
|---|---|---|---|
| Display (`--font-display`) | Newsreader (optical sizes) | 400, 400 italic, 500 (wordmark only) | Hero headline, page titles, the invariant clause, receipt verdict, step titles, empty-state titles, policy sentence |
| UI (`--font-sans`) | Host Grotesk | 400, 500, 600 | All interface text, labels, buttons, body |
| Figures (`--font-mono`) | IBM Plex Mono | 400, 500 | Every number that is money, units, time or a count in a data context; account ids; tx hashes; method names; eyebrow labels |

`body` sets `font-variant-numeric: tabular-nums`. Mono figures use `tabular-nums slashed-zero` (slashed zero prevents 0/O confusion in hashes and prices). **Any number that updates live must be mono or tabular**, so digits never shift width while counting.

### Scale (desktop; phone overrides in brackets, applied under 640px by tokens.css)

| Token / class | Font | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `.t-display-xl` | Newsreader | 76/74 (42/44) | 400 | −0.022em | Overview hero only |
| `.t-display-l` | Newsreader | 44/46 (34/38) | 400 | −0.022em | Page titles |
| `.t-display-m` | Newsreader | 32/36 (26/30) | 400 | −0.022em | Section titles on How, receipt verdict |
| `.t-title-l` | Host Grotesk | 22/28 | 600 | −0.012em | Section titles in app screens ("Pools") |
| `.t-title-m` | Host Grotesk | 17/24 | 600 | −0.006em | Sub-section titles |
| `.t-body-l` | Host Grotesk | 17/26 | 400 | 0 | Ledes |
| `.t-body` (default) | Host Grotesk | 15/22 | 400 | 0 | Body, inputs, buttons |
| `.t-body-s` | Host Grotesk | 13/18 | 400 | 0 | Meta, memos, feed, table cells |
| `.t-label` | Host Grotesk | 13/16 | 500 | 0 | Stat labels, pills, column headers |
| `.t-eyebrow` | Plex Mono | 11/16 | 500 | +0.08em, uppercase | Section eyebrows ("PROJECTED PRICE") |
| `.num-hero` | Plex Mono | 64/64 (48) | 500 | −0.045em | Projected / final price |
| `.num-l`, `.stat__value` | Plex Mono | 28/32 (24/28) | 500 | −0.02em | Stat tiles |
| `.num-m` | Plex Mono | 18/24 | 500 | −0.01em | Prices in rows, countdown |
| `.num-s` | Plex Mono | 13/18 | 400 | −0.01em | Table figures, ids |
| `.num-xs` | Plex Mono | 12/16 | 400 | 0 | Times, tx chips |
| `.unit` | Host Grotesk | 13 | 400 | 0 | "NEAR", "units" after a figure, tertiary color |

Rules: one display-font element per viewport region (do not stack two serif headings). Italic Newsreader is used once per page at most (the hero "Bulk price."). Headings get `text-wrap: balance`, paragraphs `text-wrap: pretty`.

---

## 3. Color

All values live in `tokens.css`. Components reference **semantic tokens only**. Theme: light by default, dark via `prefers-color-scheme`, overridable with `<html data-theme="light|dark">` (persist the choice in `localStorage` key `coop-theme`, read it in an inline script in `app.html` before paint to avoid a flash).

### Semantic tokens

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--bg` | `#f5f4ef` | `#0e0e0d` | Page (warm paper / warm night, never pure white or blue-black) |
| `--bg-sunken` | `#eeece5` | `#0a0a09` | Wells, table footers, code, equation terms |
| `--surface` | `#fbfaf7` | `#151514` | Cards |
| `--elevated` | `#ffffff` | `#1c1c1a` | Inputs, tx chips, the invariant card, toasts |
| `--surface-hover` | `#eeece5` | `#222220` | Row hover |
| `--border` / `--border-strong` / `--border-subtle` | `#dedbd2` / `#c9c5ba` / `#e7e4dc` | `#2a2927` / `#3a3935` / `#1f1f1d` | Hairlines |
| `--text-primary` | `#171716` | `#edece7` | 17.2:1 / 15.4:1 on surface |
| `--text-secondary` | `#5a5953` | `#a8a69e` | 6.7:1 / 7.5:1 |
| `--text-tertiary` | `#6f6d66` | `#8a887f` | 5.0:1 / 5.1:1 (still AA for small text) |
| `--text-disabled` | `#96948b` | `#5b5a54` | Disabled only, never for information |
| `--ink` | `#171716` | `#edece7` | Primary button fill, marker, Settled pill (inverts in dark) |
| `--accent` | `#0b6e4e` | `#4cc38a` | Links, focus ring, current tier, active nav |
| `--positive` | = accent | = accent | Paid within limit, delivered, live |
| `--committed(-subtle/-border)` | `#0b6e4e` / `#e1f0e8` / `#bfe0cf` | `#4cc38a` / `#11281e` / `#1f4a39` | In the group |
| `--conditional(-subtle/-border)` | `#2b4bc0` / `#eff2fd` / `#a9bbf3` | `#8ea6f0` / `#161c33` / `#2c3a6e` | Conditional intent (always with a dashed border) |
| `--excluded(-subtle)` | `#6f6d66` / `#eeece5` | `#8a887f` / `#222220` | Excluded or refunded |
| `--warning(-subtle/-border)` | `#8f5b00` / `#fbf3e2` / `#ecd3a0` | `#e2b04a` / `#261d0c` / `#57421a` | Lock countdown, Locked, Expired |
| `--negative(-subtle/-border)` | `#b42318` / `#fcefed` / `#f2c4bd` | `#f07a6e` / `#2a1513` / `#5c2a24` | Errors only (RPC down, failed spawn). Never used for money that was refunded: refunds are good news |
| `--track` | `#e7e4dc` | `#222220` | Unfilled part of any bar |
| `--hatch`, `--hatch-bg`, `--hatch-fill` | cobalt stripes | cobalt stripes | Pending conditional units. Use `background: var(--hatch-fill)` |

All text/background pairs above were computed against WCAG 2.1 and pass AA (4.5:1) at body size; white on accent is 6.3:1, dark-ink on dark accent is 8.7:1.

### Tier data palette

Tiers are ordinal (each deeper tier is a bigger discount), so they use a **single-hue sequential jade ramp**, entry tier lightest, best tier darkest (light theme) or brightest (dark theme): `--tier-1` .. `--tier-8` (contract max is 8 tiers).

For a pool with `n` tiers, tier `i` (0-based) uses `--tier-k` with `k = round(i * 7 / max(n - 1, 1)) + 1`. Three tiers therefore use `--tier-1`, `--tier-5`, `--tier-8`. A one-tier pool uses `--tier-8`. The "below minimum" zone (when `tiers[0].min_units > 1`) uses `--text-disabled` as its fill.

Never color a tier by status hues, never cycle colors, never use tier colors for text (text stays in text tokens; the colored mark beside it carries identity).

---

## 4. Space, layout, radii, elevation

- **Spacing** is a 4px grid: `--space-1` 2, `-2` 4, `-3` 8, `-4` 12, `-5` 16, `-6` 20, `-7` 24, `-8` 32, `-9` 40, `-10` 48, `-11` 64, `-12` 80, `-13` 96 (px).
- **Container**: max 1240px content (`--container`), `--gutter` 32px, 16px under 640px. Pool and receipt pages put `class="is-wide"` on `<body>` (or on the layout root) for 1360px, because they hold three columns.
- **Page rhythm**: `.page` has 40px top / 80px bottom padding. Sections are separated by 64px (`.section + .section`). Cards in a column are 24px apart.
- **Radii**: `--radius-xs` 3 (tags, marker), `-s` 6 (tx chips, small buttons, glyphs), `-m` 8 (buttons, inputs, rungs), `-l` 12 (cards, proof, toasts), `-xl` 16, `-pill`.
- **Elevation**: the UI is flat. Cards are `--surface` + 1px `--border`, **no shadow**. `--shadow-1` (1px hairline) only on inputs, secondary buttons and the invariant card. `--shadow-2` on the slider thumb. `--shadow-3` only on toasts. Never put big soft shadows on cards.
- **Header** is 56px, sticky, `--bg` at 88% with 12px backdrop blur and a hairline bottom border. This is the only translucent surface in the product.

---

## 5. Motion

Durations: `--dur-instant` 80ms, `--dur-fast` 140ms, `--dur-base` 220ms, `--dur-slow` 360ms, `--dur-marker` 640ms. Easings: `--ease-out` cubic-bezier(0.22, 1, 0.36, 1) for everything that arrives, `--ease-in-out` for loops, `--ease-spring` cubic-bezier(0.34, 1.36, 0.64, 1) only for the glyph pop and toasts.

| What | How | Trigger |
|---|---|---|
| Ladder marker | `inset-block-start` transitions over 640ms `--ease-out`; segment fills (`::before`) and hatch (`::after`) transition the same way | `projected.units` or pledged units change |
| Price change | Swap the number, add `data-changed` for one frame: `price-in` (fade + 8px drop, 360ms). Downward movement mirrors the price falling | `projected.unit_price` changes |
| Tier reached | Current rung gets `data-just-reached` for 1200ms (accent ring expanding to 10px and fading). Also inserts a highlighted feed entry (7.11) | `projected.tier_index` increases |
| Conditional flips in | Member row gets `data-flipped` for 1200ms: row background fades from `--accent-subtle`, glyph pops (scale 0.8 to 1, spring), pill and glyph colors cross-fade over 360ms from dashed cobalt to solid jade. The row then moves from "Waiting on a condition" to "In the group"; animate the move with Svelte `animate:flip` (duration 360ms, `--ease-out`) | `projected_in` goes false to true |
| Feed entry | New entries get `data-new`: fade + 6px slide down, 360ms. Use `in:` once, never on initial load | SSE / poll delivers an entry |
| Countdown | Digits change with no animation (mono prevents jitter). Timeline `__elapsed` width transitions linearly over 1s | every second |
| Live dot | 2.4s pulse ring | always, while data is fresh |
| Hover | Colors and backgrounds 140ms | pointer |
| Toast | 360ms spring in, 220ms fade out | |

`prefers-reduced-motion: reduce`: tokens set all durations to 0 and components.css clamps every animation and transition to 0.01ms. Do not add JS animation that ignores this (check `matchMedia` before using `animate:flip`; pass `duration: 0`). Everything must remain understandable with no motion: the flip is also announced in text (section 10).

---

## 6. Iconography

Inline SVG, Lucide-style geometry on a 24 grid, `fill: none`, `stroke: currentColor`, `stroke-width: 1.5` (1.75 at 12px), round caps and joins. Sizes: 12 (`.icon--xs`), 14 (`--sm`), 16 (default), 20 (`--lg`). Icons inherit text color; they never carry meaning alone.

Build `Icon.svelte`: `<svg class="icon {cls}" aria-hidden="true"><use href="#i-{name}"/></svg>` and render the sprite from `mockups/icons.svg` once in `+layout.svelte` (hidden). Symbols and their uses:

| Symbol | Used for |
|---|---|
| `check` | Settled pill, passed rung, proof checks |
| `check-circle` | Current rung, delivered, success toast, invariant card |
| `arrow-up-right` | Every external link (tx chips, NearBlocks) |
| `arrow-right` | Primary CTA |
| `arrow-down` | (reserved) price moved down |
| `chevron-right` | Pool row affordance, breadcrumbs |
| `chevron-down` | Disclosure |
| `x` | Dismiss, "not built" |
| `plus`, `minus` | Example-brief chips, steppers |
| `clock` | Settled-at time, pending delivery |
| `lock` | Locked pill, lock countdown, paused spawn |
| `timer` | Settles-in countdown |
| `hourglass` | Expired pill (awaiting settlement) |
| `user-plus` / `user-minus` | Feed: joined / left |
| `dashed` | Conditional join (feed icon, waiting rung) |
| `route` | Feed: decision (agent skipped / chose) |
| `trending-down` | Feed: tier reached |
| `receipt` | Feed: settle call; Receipt tab |
| `undo` | Refunded pill, refunded feed entry |
| `bot` | Feed: spawned agent |
| `alert` | Errors, claimable delivery, warnings |
| `info` | Parser note |
| `refresh` | Retry |
| `wifi-off` | RPC unreachable |
| `store` | Seller |
| `package` | Item token, awaiting inventory |
| `layers` | Tiers, escrow inventory |
| `coins` | Seller payout |
| `users` | Demo agents (honesty list) |
| `key` | Function-call keys |
| `shield` | Contract escrow, "enforced by the contract" |
| `fork` | Sub-accounts |
| `cpu` | Parser / LLM indicator |
| `code` | Source link |
| `external` | (reserved) generic external |
| `copy` | Copy hash / account id |
| `sun`, `moon` | Theme toggle |

The brand mark is three stacked bars of decreasing width (a price ladder), top two in `currentColor`, bottom bar in `--accent`. Markup is in every mockup header; reuse it as `Logo.svelte`. Favicon: the same mark on `--bg`.

---

## 7. Components

Class names below exist in `components.css`. Each subsection lists anatomy, data mapping and states. Build each as a Svelte component with typed props.

### 7.1 App shell (`.site-header`, `.nav`, `.net-chip`, `.site-footer`)

- Header row: logo (mark + "Co-op" in Newsreader 24/500, −0.03em) · nav links "Pools" (`/`), "Spawn an agent" (`/spawn`), "How it works" (`/how`) · right: network chip + theme toggle.
- Active link: `aria-current="page"`, primary text, 2px ink underline sitting on the header's bottom border.
- **Network chip** (`.net-chip`): dot + "testnet" + (≥1024px) contract id in tertiary mono; links to `explorerAccountBase + contractId` from `/api/config` (fallback `https://testnet.nearblocks.io/address/<contract>`). `data-rpc="ok|slow|down"`: ok when the last RPC call succeeded within 2 polls, slow when the last call took > 3s or one poll failed, down after 3 consecutive failures. Title attribute: "RPC <host> is responding" / "is slow" / "is unreachable".
- Under 768px the nav moves to a second 44px row (`.nav-row`) that scrolls horizontally if needed. Nothing hides behind a menu.
- Footer: "Co-op runs on NEAR testnet only. The demo seller and its voucher token are ours and have no value." Links: "Contract on NearBlocks", "Source" (repo URL), "What is not built" (`/how#not-built`).

### 7.2 Buttons (`.btn`)

Variants: `--primary` (ink fill; it inverts in dark mode, which is intended), `--secondary` (elevated + strong border + hairline shadow), `--ghost`, `--accent` (jade, reserve for nothing yet; do not introduce a second primary). Sizes: default 40px, `--sm` 32px, `--lg` 48px; `--block` for full width. Busy: `aria-busy="true"` + `.spinner` + verb in progress ("Spawning"). Disabled: `disabled` attribute, sunken fill, never opacity alone. Pressed: 1px translateY. One primary button per view.

### 7.3 Status pill (`.pill`)

Map `PoolView.status` exactly:

| status | class | leading mark | label |
|---|---|---|---|
| `AwaitingInventory` | `pill--awaiting` | `package` | Awaiting inventory |
| `Open` | `pill--open` | `.pill__dot` (pulses) | Open |
| `Locked` | `pill--locked` | `lock` | Locked |
| `Expired` | `pill--expired` | `hourglass` | Awaiting settlement |
| `Settling` | `pill--settling` | `.spinner` 10px | Settling {settle_cursor} of {member_count} |
| `Settled` | `pill--settled` | `check` | Settled |
| `Refunded` | `pill--refunded` | `undo` | Refunded |

`--lg` size in page heads. Pills are never clickable.

### 7.4 Tag (`.tag`)

Quiet mono chip for archetype ("Bargain"), conditions ("if ≥ 20"), HTTP state labels in docs, and the parser indicator ("LLM off · rules parser" with `cpu` icon; when `/api/health` says `llm: "on"`: "LLM on · {model}" if the server exposes it, else "LLM on").

### 7.5 Card (`.card`, `__head`, `__body`, `__foot`)

Surface fill, 1px border, 12px radius, no shadow. Head: 15/600 title + optional mono count (`.card__count`) + right-side meta. Foot: 13px tertiary explanatory line. Padding 24px (20px on phones).

### 7.6 Stat tile and strip (`.stats`, `.stat`)

Label (13/500 secondary) · value (mono 28/500, unit in `.unit`) · meta (13 tertiary). In a strip, tiles are separated by vertical hairlines with no boxes. 6 columns ≥1024, 3 at 640 to 1023, 2 on phones (CSS handles borders). In-card variants: `.pool-facts` (4 columns, 24px values) and `.receipt-figures`.

### 7.7 Countdown (`.countdown`, `.timeline`)

Two items: "Locks in" (`lock` icon) and "Settles in" (`timer`), each with a mono 18px value and the absolute time below ("14:15 UTC"). Under them, the timeline: a 6px track from `offer.created_at_ns` to `deadline_ns`; ink fill to now; amber 2px tick at `lock_at_ns`; amber hatch for the lock window; a ringed dot at now. Legend: "Opened 14:00", "Lock", "Deadline".

- Format: `mm:ss` under 1 hour, `h:mm:ss` under 24 hours, `2d 4h` beyond.
- `data-urgent` (amber value) when under 5 minutes to lock.
- After lock: first item becomes "Locked" with value "Frozen" in amber; after deadline: "Settles in" becomes "Deadline passed" and shows "Awaiting settlement" until status changes. After settlement the countdown is replaced by "Settled {date}, {time} UTC" in the meta line.
- `role="timer"`, `aria-live="off"`: never announce ticks. Announce only state changes (section 10).
- Tick from a single `$state` clock in a shared store (one `setInterval(1000)` for the app), not one timer per component. Compute from chain timestamps (ns → ms) against `Date.now()`; do not trust local "elapsed" counters.

### 7.8 Tier ladder (`.ladder`) · the hero

Anatomy, top to bottom:
1. Eyebrow "Projected price" (or "Final price" once `result` exists).
2. `.num-hero` price + "NEAR per unit". If no tier is reached: show "None" in tertiary, unit "no tier yet".
3. Summary sentence (`.ladder__summary`, max 36ch, key figures in `<b>`), rules below.
4. Ladder body: a 3-column grid `76px | 14px | 1fr`, one row per segment (min 104px each): left gutter holds the marker, middle is the rail, right are the rungs.
5. Legend: "In the group" (solid tier swatch), "Conditional" (hatch), "Open" (track).

**Geometry (implement exactly; pure function `ladderModel(pool, members)`):**

```ts
// segments: one per tier, plus a leading "below minimum" segment when tiers[0].min_units > 1
segs = [];
if (tiers[0].min_units > 1) segs.push({ kind: 'below', from: 0, to: tiers[0].min_units });
tiers.forEach((t, i) => segs.push({
  kind: 'tier', tier: i,
  from: (i === 0 && t.min_units === 1) ? 0 : t.min_units,
  to: tiers[i + 1]?.min_units ?? offer.max_units,
}));
frac = (u, s) => clamp((u - s.from) / Math.max(s.to - s.from, 1), 0, 1);
inUnits      = (result ?? projected).units;                 // solid fill
pledgedUnits = pool.units_unconditional + pool.units_conditional; // fill + hatch
// per segment: style="--in:{frac(inUnits,s)}; --pend:{frac(pledgedUnits,s)}; --seg-color: var(--tier-k)"
k = index of the last segment with s.from <= inUnits (clamped to segs.length - 1);
markerPos = (k + frac(inUnits, segs[k])) / segs.length * 100;   // percent, set as --pos
```

Segments are equal height on purpose (ordinal scale): tiers 1, 20, 50 of 60 would otherwise crush the first rung. Within a segment the scale is linear. After settlement, pledged equals in (excluded units are gone), so no hatch shows.

**Marker** (`.ladder__marker`): ink label "27 units" (mono 12, "units" at 10px 70% opacity), a 5px arrow and a 2px ink line crossing the rail. Moves via `--pos` with the 640ms transition.

**Threshold ticks** (`.ladder__notch`, optional): a 8x2 cobalt tick outside the rail at a waiting member's threshold, drawn **only when that threshold is not equal to some tier's `min_units`** (Bargain agents always sit on a tier boundary, so normally none show). Position = same piecewise mapping as the marker.

**Rungs** (`.rung`), one per segment, aligned to the top of their segment. Content: price (mono 22/500, unit "NEAR") with discount on the right (`−30%`, or "list" for tier 0), "from N units", then status lines. Let `t = (result ?? projected).tier_index`:

| state (`data-state`) | when | status line(s) |
|---|---|---|
| `passed` | tier index < t | `check` "Passed" (all tertiary) |
| `current` | index == t | accent box, `check-circle` "Current price" (or "Final price" once settled) |
| `ahead` | index == t + 1 (or 0 when t is null) | cobalt `dashed` "{a} agents waiting, {u} units" if any waiting member has threshold within this tier; then tertiary "{x} pledged units away" |
| `far` | further below | price tertiary, no status |
| `below-min` | the leading below-minimum segment | price slot shows "No tier", from "fewer than {min} units", status "Everyone is refunded if the group stays here" |

`x` ("pledged units away") is computed by simulation, not subtraction, because adding units can pull waiting conditionals in: find the smallest `x >= 1` such that `resolve(members + x unconditional units).units >= nextTier.min_units`, where `resolve` is the SPEC 1.5 algorithm (start with all, drop highest unmet threshold). Cap the loop at `offer.max_units - pledgedUnits`; if no `x` works, say "Not reachable with current capacity".

**Summary sentence variants** (pick the first that applies):

1. Settled: "Tier {i+1} of {n}, reached with **{units} units**. Every agent paid the same price{, half the list price | , {pct}% under the list price}."
2. Refunded: "The group reached **{units} units**, short of the first tier at {min}. Everyone was refunded in full."
3. Locked or Expired: "Membership is frozen. The group settles at **{price}** with **{units} units**."
4. No tier yet: "**{pledged} units** pledged. **{x} more** reach the first tier at **{price}**. If the group stays below {min}, everyone is refunded."
5. Best tier already: "**{units} units** in the group from {members_in} agents. This is the best tier."
6. Waiting agents would join: "**{units} units** in the group from {members_in} agents. **{x} more pledged units** bring in {k} waiting agents and drop the price to **{next}**."
7. Otherwise: "**{units} units** in the group from {members_in} agents. **{x} more units** drop the price to **{next}**."

Accessibility: the ladder body is `role="img"` with an `aria-label` that reads every tier and the current state (see `pool.html`). The price value is `aria-live="polite" aria-atomic="true"`.

### 7.9 Mini tier bar (`.tierbar`)

Horizontal version for list rows and the receipt: top line "27 of 60 units" (left) and "+15 waiting" in cobalt (right, only when pending > 0); a 6px track of equal-width segments (`--n`), each with `--in`, `--pend`, `--seg-color` from the same `ladderModel`; bottom line: each segment's starting price, current one `data-current` (primary, 500). Below-minimum segment label: "min {N}".

### 7.10 Member row (`.member`)

Grid: glyph 28 · main (id + memo) · units · state pill. Under 560px **container** width (container query on `.members`, not viewport) it becomes: glyph · main · units, with the pill on a second line under the text.

- **Glyph**: archetype initial in mono: E (Eager), B (Bargain), S (Switcher), or the first letter of the label for spawned/custom agents. Archetype comes from `/api/agents` (`archetype`) when the agent is listed there, else from the label prefix (`eager-`, `bargain-`, `switcher-`).
- **Id**: label (part before the first dot) in mono 13/500, then the rest (`.operator.testnet`) in tertiary, ellipsized; full id in `title`.
- **Memo**: `memo` verbatim, 13px secondary, clamped to 2 lines. Empty memo: render nothing (row gets shorter).
- **Units**: mono, with "u".
- **Grouping**: two groups with headers: "In the group · {n} agents · {u} units" and "Waiting on a condition" (cobalt label). Within a group keep join order (`joined_at_ns`). After settlement group by outcome: "Filled", "Excluded".

State derivation (`memberState(m)`):

| condition | `data-state` (row) | pill | pill text |
|---|---|---|---|
| `outcome == "Filled"` | `committed` | jade, `check` icon | Filled |
| `outcome == "Excluded"` | `excluded` | neutral, hollow ring | Excluded |
| `outcome == "Refunded"` | `excluded` | neutral (`data-state="refunded"`) | Refunded |
| `threshold_units == null` | `committed` | jade, solid ring | Committed |
| `projected_in` | `in` | jade, solid ring (identical to committed: this is the flip) | In at {T} |
| else | `waiting` | cobalt, **dashed** border, dashed ring; glyph dashed | Waiting for {T} |

Committed and conditional are distinguished by solid vs dashed and by text, never by hue alone. The flip animation is in section 5.

### 7.11 Activity feed entry (`.feed-entry`)

Anatomy: 24px round icon on a 1px thread line · message (13/20, agent labels as `<b class="agent">` in mono) · optional reason as an indented quote with a 2px left rule · meta line: time `HH:MM:SS` (UTC, `<time datetime>`) and a tx chip with the method name.

Source: `GET /api/activity?pool_id=N&limit=20` on load, then `GET /api/stream` (SSE) filtered by `pool_id`. Newest first. Show 8, then "Show earlier" (ghost button) loads 20 more. Footer text "Showing {shown} of {total}".

| `kind` | `data-kind` | icon | message (use server `message`, but these are the target phrasings) |
|---|---|---|---|
| `pool_joined`, member has no threshold | `joined` | `user-plus` | "{agent} joined: {u} units at the entry price." |
| `pool_joined`, member has a threshold | `joined-conditional` | `dashed` | "{agent} joined on a condition: {u} units if the group reaches {T}." Append " In right away." when it was projected in at once |
| `pool_left` | `left` | `user-minus` | "{agent} left and got {released} NEAR back." |
| `decision` | `decision` | `route` | "{agent} skipped this pool." / "{agent} is waiting for a better pool." |
| `settle` | `settle` | `receipt` | "Settlement processed members {a} to {b}." |
| `pool_settled` | `settled` | `check` on ink | "Settled at {price}. {n} agents filled, seller paid {payout} NEAR." |
| `pool_refunded` | `refunded` | `undo` | "No tier reached. Everyone was refunded in full." |
| `spawned` | `spawned` | `bot` | "{agent} was spawned from the web form." |
| `offer_created` | `offer` | `store` | "{seller} opened this pool with {n} tiers." |
| `error` | `error` | `alert` | server message |
| *client-derived* `tier` | `tier` (accent background) | `trending-down` on accent | "Group reached **{min} units**. Projected price drops to **{price}**. {agents} are now in." |
| *client-derived* `tier-lost` | `left` | `user-minus` | "Group fell below {min} units. Projected price is back to {price}." |

Join kind resolution: look up the member's `threshold_units` from `get_pool_members`. The two client-derived entries are created by the web app when consecutive pool polls show `projected.tier_index` changing; they have no tx chip and are not persisted. Agent ids inside server messages: replace any `[a-z0-9-_]+(\.[a-z0-9-_]+)*\.testnet` match with `<b class="agent" title="{full id}">{label}</b>`. Reason text: `reason` field verbatim; omit the quote when absent.

### 7.12 Tx chip and account link (`.tx`, `.account-link`)

`<a class="tx" href="{explorerTxBase}{hash}" target="_blank" rel="noopener" aria-label="Transaction {short} on NearBlocks, opens in a new tab">`: optional method (`.tx__method`, tertiary, divided by a hairline), short hash `first4…last4` (real ellipsis U+2026), `arrow-up-right`. Use `TxRef.explorer_url` when present, else `explorerTxBase` from `/api/config`, else `https://testnet.nearblocks.io/txns/`. Height 22px; on touch devices extend the hit area to 40px with a transparent `::after` (inset −9px). Account links go to `explorerAccountBase` (fallback `https://testnet.nearblocks.io/address/`). Optional copy button: `copy` icon, toast "Copied".

### 7.13 Receipt ledger (`.ledger`) and headroom meter (`.headroom`)

Columns: Agent (glyph 22px, id, condition tag "if ≥ 20") · Units · **Paid per unit / limit** · Paid · Refund · Delivery · Joined in (tx). Figures right-aligned mono. Footer row on `--bg-sunken`: "12 agents", total units, "0.50 for all", total paid, total refunded, "55 of 55" delivered.

- **Paid per unit** = `result.unit_price` (equals `paid / units`).
- **Limit** = `get_agent(agent_id).limits.max_unit_price`. `MemberView` has no limit field: fetch every member's `AgentView` (batch, cache per page load). If `update_limits` could have changed it after joining, the honest label is still the agent's current limit; the contract guarantees the charge never exceeds the lock, which is the stronger statement.
- **Headroom meter**: text "**0.50** / 0.90" then a 72px bar whose track is the limit, fill `--positive` to `paid/limit`, and a 2px ink tick at the end marking the limit. The fill must never reach past the tick; `data-over` (red) exists only as a dev assertion and should throw in development if it would ever render.
- Refund 0.00 renders tertiary.
- Delivery: `Delivered` → jade `check-circle` "{u} delivered"; `Claimable` → amber `alert` "Claimable" plus a "Claim" ghost button only if the viewer can act (never in the read-only dashboard: just the label); `Pending` → tertiary `clock` "Pending".
- Under 900px each row becomes a card: agent (full width), headroom (full width, bar stretches), Units / Paid / Refund in three columns with small labels, then delivery left and tx right. Header row hidden; labels come from `data-label` attributes.

### 7.14 Invariant proof (`.proof`) and reconciliation (`.equation`)

Proof block (jade-subtle, jade border, 40px jade seal with `check`): title in Newsreader 32 with the count in mono jade: "**12 of 12** agents paid at or below their limit." Sub: "The tightest limit in the group was {min limit}. Everyone paid {price}." Checks (13px, jade check icons): "Seller paid because the group reached a tier", "No agent paid more than it locked", "Sum of payments equals the seller payout". Compute every one of these from data; if any is false, do not render the proof block, render a negative banner "Receipt does not reconcile: {which check}". (It should never happen; showing it honestly is the point.)

For a Refunded pool the title becomes "**{n} of {n}** agents refunded in full." and checks become "Seller was not paid", "Every lock returned".

Equation: `Locked = Paid to seller + Refunded + Storage`, terms in sunken pills, total in ink. Values with BigInt math from members: `Σ locked`, `Σ paid`, `Σ refunded`, `members_filled × STORAGE_RESERVE (0.00125)`. Show 3 decimals (more if needed to be exact).

### 7.15 Form fields (`.field`, `.input`)

Label (15/500) with optional right side (counter "47 / 140" mono, or "testnet NEAR"). Input 44px, elevated, strong border, hairline shadow; focus: accent border + 3px accent ring at 18%. Affix (`.input__affix`) for suffix/prefix in mono tertiary (".operator.testnet", "NEAR"). Hint 13 tertiary below. States: `data-valid` (jade border + `.field__msg--ok` with `check-circle`), `data-invalid` + `aria-invalid="true"` (red border + `.field__msg--error` with `alert`, message linked by `aria-describedby`), `data-disabled`. Validate on blur and on submit, then live while the field is invalid. Range slider: 4px track filled in ink to `--pct`, 20px thumb; always paired with a number input that accepts typing. Example chips (`.chip`) fill the brief on click.

### 7.16 Segmented control and tabs

`.seg` for filters (buttons with `aria-pressed`, counts in mono). `.tabs` for views of one pool (`role="tablist"`, `aria-selected`, 2px ink indicator). Both scroll horizontally if they overflow; never wrap.

### 7.17 Banners and the RPC error state

`.banner` variants warning / info / negative / positive: icon, bold title, secondary body, optional actions. Page-level RPC failure uses the full-bleed `.rpc-banner` directly under the header:

> `wifi-off` **Can't reach testnet RPC.** Showing data from 14:09:12. Retrying in 8s with near-testnet.drpc.org. [Retry now]

Rules: keep showing the last good data (never blank the screen); stop the live dots (`data-state="paused"`); the network chip goes `down`; retry with backoff 2s, 4s, 8s, max 30s, rotating through `PUBLIC_RPC_URL` then the fallbacks `https://near-testnet.drpc.org`, `https://testnet-rpc.intea.rs`. If there is no cached data at all, show the empty-state layout with title "Can't reach testnet right now" and the same retry. If only the server (`/api/*`) is down: inline negative banner in the feed card, "Activity feed offline. Pool state still comes from RPC. Tx links will return with the server."; spawn page shows "Spawning is unavailable right now. The pools are still live to watch."

### 7.18 Toasts (`.toast-region`, `.toast`)

Bottom-right, max 380px, stacked with 8px gaps; full width at the bottom on phones. 6s auto-dismiss for positive, sticky for negative. Region `aria-live="polite"`; negative toasts `role="alert"`. Used for: copy confirmations, "rin joined pool #7", spawn failures. Never toast routine feed events.

### 7.19 Empty states (`.empty`)

Dashed three-bar ladder illustration (in `kit.html`), Newsreader 24 title, one sentence, one action. Copy:
- No pools at all: "No pools yet" · "The demo seller opens a pool every hour. Spawn an agent now and it will join the next one." · [Spawn an agent]
- Filter empty: "No {status} pools" · "Try another filter." (no button)
- No open pools: "No open pools right now" · "The next demo offer opens on the hour. Settled pools and their receipts are below."
- Pool not found (`get_pool` returns null): "Pool #{id} doesn't exist" · "Pool ids start at 1." · [All pools]
- No activity yet: "Nothing has happened in this pool yet."

### 7.20 Loading skeletons (`.skeleton`)

Shimmer bars in the exact shape of the content (eyebrow, hero number, 2 summary lines, 3 rung blocks; member rows as glyph + 2 lines + pill). Show only on first load; subsequent polls update in place silently. Set `aria-busy="true"` on the region. No spinners for page loads.

---

## 8. Screens

Global data plumbing: a single `poll` store fetches `list_pools` (overview) or `get_pool` + `get_pool_members` (pool page) from RPC every 3s while the tab is visible (every 15s when hidden), plus `/api/config` and `/api/health` once. The server is optional: every screen must render from RPC alone, with feed, tx links and spawn degrading as in 7.17.

### 8.1 Overview `/` (mockup `overview.html`)

Hierarchy: hero → contract totals → pools.

1. **Hero** (2 columns ≥1024, stacked below): eyebrow live-dot "Live on NEAR testnet"; H1 `.t-display-xl` "Small buyers.<br><em>Bulk price.</em>"; lede (PRD one-liner, second clause bold): "Co-op lets AI buying agents pool their orders on NEAR so a group of small buyers gets the bulk price, **with the contract guaranteeing no agent ever pays more than its own limit.**"; actions: primary "Watch pool #{id} live →" (newest `Open` pool; if none, newest pool, label "See pool #{id}"), secondary "Spawn an agent".
   Right: **invariant clause card** (`.clause`): eyebrow "The invariant", tag "enforced by the contract"; two serif clauses numbered with italic jade roman numerals: "i. No agent pays more than its own limit." "ii. The seller is paid only if the group reaches a price tier." Dashed rule, then the live proof from the most recent settled pool: `check-circle` "Last settlement: {k} of {n} agents at or below their limit." + link "Pool #{id} receipt". If nothing has settled yet: "No settlements yet. The first receipt will appear here."
2. **Contract totals** from `get_stats()`, 6-tile strip: Offers ("since deploy"), Pools settled ("a tier was reached"), Pools refunded ("no tier, all money back"), Agents ("registered on the contract"), Volume `{volume} NEAR` ("paid to sellers"), Units delivered ("vouchers to agents").
3. **Pools**: title "Pools" + live-dot "Updated {n}s ago"; filter `.seg`: All / Open / Locked / Settled / Refunded with counts (Locked includes Expired and Settling). List rows (`.pool-row`, whole row is a link to `/pool?id=N`): `#id` · title + "{n} tiers · max {max} units" · status pill · mini tier bar · price (`num-m`) with caption "projected" / "final" / "None"+"no tier reached" · agents count · time (mono) with caption: "to lock" (Open), "to settle" (Locked/Expired), time of day + "today"/"yesterday"/date (Settled/Refunded) · chevron. Sort: newest first (as `list_pools` returns). Load 20, "Show more" if `list_pools` returned a full page. Titles are shown exactly as stored.

### 8.2 Live pool `/pool?id=N` (mockup `pool.html`)

Body class `is-wide`. Page head: breadcrumb "Pools › #N"; H1 offer title (`.t-display-l`) + large status pill; meta line: `store` seller account link, `package` item token link, `layers` "{inventory_held / unit_amount} units held in escrow". Right of the head: countdown (7.7).

Grid areas (see CSS): ≥1280 `ladder | facts + members | feed` (360 / fluid / 340, ladder and feed sticky); 900 to 1279 `ladder | facts, feed, members`; under 900 single column in the order **ladder, facts, feed, members** (the feed comes before the long member list on phones so the live action stays near the top).

- **Ladder card**: 7.8.
- **Facts** (`.pool-facts`): Units in "{in} / {max}", meta "{pledged} pledged" · Agents "{member_count}", meta "{in} in, {waiting} waiting" · Escrowed "{Σ locked, 2dp} NEAR", meta "locked by {n} agents" · Saved vs list "{in × (tiers[0].price − current price)} NEAR" in jade, meta "if settled now"; when tier 0 is current the value is "0.00" with meta "at list price".
- **Members card**: title "Members {n}", right meta "Join order"; groups per 7.10; foot: "A conditional agent counts only once the group reaches its number. Agents can leave until {lock time} UTC." (after lock: "Membership is frozen.").
- **Activity card**: title "Activity", live-dot "Live" (paused state "Paused" when SSE is disconnected); feed per 7.11; foot "Showing 8 of {n}" + "Show earlier".
- When status becomes `Locked`, show a warning banner above the grid: "Pool locked. Membership is frozen. Settlement can run from {deadline} UTC." When `Expired`: info banner "Deadline passed. Anyone can call settle. Our settler usually does it within a minute." When `Settling`: pill shows progress; members show outcomes as they arrive.
- When status becomes `Settled` or `Refunded`, the same route renders the receipt (8.3) with tabs; the transition happens in place with a toast "Pool #{N} settled at {price}." (or "Pool #{N} refunded.").

### 8.3 Settlement receipt (same route, status `Settled` or `Refunded`; mockup `receipt.html`)

Page head as 8.2 with pill "Settled" and meta `clock` "Settled {Mon D}, {HH:MM} UTC" (from `result.resolved_at_ns`). Tabs: "Receipt" (default), "Ladder" (the 8.2 ladder + members in final state), "Activity" (full feed). Sync the tab to `?tab=` so links can deep-link.

Receipt tab, top to bottom:
1. **Final price card** (left, fluid) + **Seller card** (right, 360px; stacks under 1024px).
   - Final price: eyebrow "Final price", hero "0.50 NEAR per unit", sentence variant 1 from 7.8, mini tier bar on the right; figures strip: Units delivered "{units}" ("to {members_in} agents") · Seller payout "{seller_payout} NEAR" ("{units} × {price}") · Refunded "{Σ refunded} NEAR" ("back to agent budgets") · Saved vs list "{units × (list − price)} NEAR" in jade ("against {list} per unit").
   - Seller card: head `coins` "Seller" + account; rows "Paid for {units} units / {payout} NEAR", "Unsold units returned / {max − units}", "Inventory held before / {max}"; tx chips for `seller_paid` and the unsold `ft_transfer` when the server has them; note: "Had the group missed every tier, the seller would have been paid nothing and got all {max} units back."
2. **Proof block** (7.14).
3. **Per agent ledger** (7.13), card title "Per agent {n}", right meta "All amounts in NEAR"; card foot: "Every lock reconciles: what an agent locked is what it paid, plus its refund, plus 0.00125 NEAR to register it on the voucher token." + equation.
4. **Settlement transactions**: card listing each `settle` call (from activity entries of kind `settle`/`pool_settled` with tx): time, plain description ("Resolved the group: 55 units, tier 3, 0.50 per unit. Filled members 1 to 6." / "Filled members 7 to 12." / "Paid the seller 27.50 NEAR and returned 5 unsold units."), signer in mono, tx chip with method "settle". Right meta: "Anyone can call settle after the deadline". The contract settles about 6 members per call (SPEC section 4), so a 12-member pool shows 3 calls. Without the server, show "Transaction links need the Co-op server. The numbers above come straight from the contract."

Refunded variant: hero "None", sentence variant 2, figures: Units pledged / Seller payout "0.00" / Refunded "{Σ locked}" / Agents refunded; ledger columns Paid and Headroom show "0.00" and the meter empty; proof per 7.14.

### 8.4 Spawn your agent `/spawn` (mockup `spawn.html`)

Page head: H1 "Spawn an agent"; lede "Give it a name, a one-line brief and a budget. It gets its own testnet account and a key that can only join or leave pools."; right meta: parser tag ("LLM off · rules parser") and "{remaining} of {max} slots left" (from `/api/config.spawn`).

The `<form>` is the layout grid: fields (left, fluid) and the policy preview (right, 420px, sticky) ≥1024; under 1024 the order is **fields, preview, submit** so the preview is visible before pressing the button.

Fields:
1. **Agent name**: mono input with suffix affix `.{operator}.testnet` (operator from `contractId`'s parent or config). Lowercase on input. Rules: `^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$` (2 to 24 chars). Messages: hint "Lowercase letters, digits and hyphens. 2 to 24 characters."; ok "{name}.operator.testnet is available" (checked on blur with `get_agent` returning null; RPC `view_account` can also be used); errors "Use lowercase letters, digits and hyphens only." · "That name is taken. Try {name}-2." · "Names are 2 to 24 characters."
2. **Brief**: text input, max 140, counter. Hint "Say how many units and the most you will pay per unit, in plain words." Three example chips: "buy 2 now if under 1.00", "buy 5 only at the 50-unit price", "buy 3 if it drops below 0.6".
3. **Budget**: slider 0.10 to `maxBudgetNear` step 0.05 + number input with "NEAR" affix, default = max. Scale labels "0.10", midpoint, "{max} max". Hint "Paid from our operator account and capped at {max}. The contract never lets the agent spend more than this." Error: "Budget is capped at {max} NEAR."
4. **Submit**: primary lg "Spawn agent →" + note "Creates the account, adds a key limited to `join_pool` and `leave_pool`, then registers and funds the agent. About 10 seconds." Busy label "Spawning" with spinner; disable the form while busy.

**Parsed policy preview** (card "Parsed policy", head meta live-dot paused "Updates as you type"): recomputed on every input (debounce 150ms) by the shared rules parser module (the same code the server uses, imported from `@coop/agents` if exposed, otherwise duplicated and noted). Content: a Newsreader sentence with mono jade figures, e.g. "rin buys **3** units at **0.60** or less, so it waits for the group to reach **50**." (Eager: "rin buys 2 units now, at up to 1.00 per unit."), then rows: Archetype (tag), Max price per unit, Units, Joins ("now" or "if group ≥ T"), Locks at most (units × lock price), Best match now (link "Pool #7 at 0.50", or "No open pool fits yet"). Foot note with `info`: "Read by the rules parser because no LLM is configured. The contract enforces the limits; the parser only proposes them." (LLM on: "Read by {model}. The contract enforces the limits; the model only proposes them.") Unparsed fields render "Not found" in disabled color, never a guessed value.

States (all shown in the mockup's "Other states" gallery):
- **Success** (POST 200): replace the form area with a card: `check-circle` "{name} is live", the full account id in mono, rows "Create account", "Add limited key", "Register, fund {budget}" each with a tx chip from `txs`, primary "Watch it in pool #{best match}" (or "See all pools"). Keep the policy card. Toast "{name} is live".
- **Parse failure** (client): brief field invalid, message "Add the most you will pay per unit, like “below 0.6”." Submit disabled.
- **Rate limited** (429): card "Hourly limit reached", body "Each network can spawn 3 agents per hour. You can spawn the next one at {time} UTC. Your agents keep running." Disabled button "Spawn agent · in {n} min".
- **Paused** (503 or `spawn.enabled == false` or `remaining == 0`): "Spawning is paused", "All {max} demo slots are in use. The pools are still live, and you can watch them settle." Secondary button "Watch pool #{id}". Form fields disabled.
- **Server error** (400 other / network): negative banner above the submit with the server's `error` string, form stays filled.

### 8.5 How it works `/how` (mockup `how.html`)

1. Intro (2 columns ≥1024): eyebrow "How it works", H1 "One price for the group, and a ceiling for every agent."; right: the PRD section 3 mechanism paragraph verbatim (minus the parenthetical).
2. **Diagram pair** (side by side ≥1024, stacked below), each in a `.diagram-panel` with an eyebrow, an inline SVG (`.dg`, `viewBox="0 0 360 410"`, max 440px wide) and a caption. Copy the SVG markup from `how.html`; it is themed entirely by CSS classes (`.dg-box`, `.dg-box--ink`, `--committed`, `--waiting`, `--excluded`, `.dg-line--accent|cond|muted`, `.dg-head*`, `.dg-label*`) so it flips with the theme. Structure: seller node (top), contract node in ink (middle), three agent nodes (bottom: committed, committed-conditional, waiting-dashed); panel 1 arrows point into the contract ("deposits 60 units up front", "locks 3.00", "locks 2.10", dashed cobalt "2.50"); panel 2 arrows point out ("units × 0.70 + unsold units back", "3 units / 0.90 back", "3 units / 0.00 back", dotted grey "2.50 back" to an excluded node). Each SVG has `role="img"` and a `<title>` describing the flow in words.
3. **Five steps** (`.steps`, ink top rule): 01 "A seller posts tiers", 02 "Owners fund agents with limits", 03 "Agents join, outright or on a condition", 04 "The contract resolves the group", 05 "Everyone settles at one price", body copy as in the mockup.
4. **Worked example**: two cards running the resolve algorithm step by step (42 pledged → 0.70; 8 more units → 0.50). If you can, compute these from the live pool #7 data; otherwise keep them static and labeled as an example.
5. **Security model** (`.trio`): Sub-accounts (`fork`), Function-call keys (`key`), Contract escrow (`shield`), copy as in the mockup.
6. **What is mocked or not built** (`id="not-built"`, `.honesty`): six items as in the mockup. Keep this list true: when a P1 item ships, remove it from "Not built yet"; never claim something that is not running.

---

## 9. Responsive behaviour

Breakpoints (max-width queries in components.css): **640** (phone), **768** (nav moves to second row), **900** (pool single column, ledger to cards), **1024** (hero, spawn, receipt-top, How stack), **1280** (pool drops the third column). Container query: member rows at **560px** container width.

Must hold at 375px wide: no horizontal page scroll (only `.seg`, `.tabs` and `.nav-row` may scroll internally); 16px gutters; hero H1 42px; hero buttons full width side by side; stats 2 columns; pool rows become title/price, status/time, full-width tier bar; ladder keeps its vertical form (it is the product); members, feed, ledger cards as specified; spawn slider stacks above the number input; How diagrams scale (they are designed at 360 wide). Touch targets ≥ 40px for every button and link-like control.

---

## 10. Accessibility

- Contrast: AA everywhere (values in section 3). Do not place tertiary text on sunken fills smaller than 13px.
- Focus: `:focus-visible` ring = 2px `--bg` gap + 2px `--accent` (`--focus-ring`). Never remove outlines without this replacement. Inputs show the accent border + soft ring.
- Live regions:
  - Projected price: `aria-live="polite" aria-atomic="true"`.
  - Feed list: `aria-live="polite" aria-relevant="additions"` (announce new entries only, not the initial load: attach the live attribute after the first render).
  - One visually hidden polite region in the pool page for state announcements: "Group reached 50 units. Price is now 0.50.", "bargain-04 is now in.", "Pool locked.", "Pool settled at 0.50." Countdowns are never announced each second.
  - Toast region polite; errors `role="alert"`.
- Ladder: `role="img"` + full `aria-label`; also render a visually hidden table of tiers (price, from units, state) after it.
- Color is never the only signal: conditional = dashed + "Waiting for 50"; committed = solid + "Committed"; tiers carry labels; delivery states carry icons + text.
- Tables: real `<table>` with `<th scope="col">`; on phones the card layout keeps semantics via `data-label` (screen readers still read the table).
- Links that open NearBlocks say so in `aria-label`.
- Respect `prefers-reduced-motion` (section 5) and `prefers-color-scheme`.
- `lang="en"`; page titles "Pool #7 · Co-op", "Spawn an agent · Co-op".

---

## 11. Formatting rules (put these in `web/src/lib/format.ts`)

- **NEAR from yocto**: BigInt only, never `Number(yocto)`. `formatNear(yocto, { min: 2, max: 5 })` → at least 2 decimals, up to 5 when needed to be exact (`0.00125`), trailing zeros beyond 2 trimmed. Summary tiles use `{ min: 2, max: 2 }` (round half up) with the exact value in `title`. Ledger cells and the equation use exact values. Thousands separator: thin space (U+2009) above 9 999.
- **Prices** per unit: `formatNear(unit_price)` (2 dp for demo tiers).
- **Discount**: `−{round((1 − price / tiers[0].unit_price) × 100)}%`; tier 0 shows "list".
- **Units**: integers; "1 unit", "n units"; compact "u" suffix only inside member rows.
- **Account ids**: label = text before the first dot (bold mono), remainder tertiary. Never truncate the label; truncate the remainder with an ellipsis.
- **Tx hash**: `hash.slice(0, 4) + "…" + hash.slice(-4)`.
- **Times**: ns → ms (`Number(BigInt(ns) / 1_000_000n)`). Absolute times in UTC with "UTC" suffix on headers ("14:15 UTC"); feed times `HH:MM:SS` UTC. Dates "Nov 12".
- **Counts** in prose: numerals always ("3 agents"), never words.

---

## 12. SvelteKit implementation notes

Suggested files: `lib/styles/{tokens,components}.css`; `lib/components/` `Icon`, `Logo`, `SiteHeader`, `SiteFooter`, `StatusPill`, `Tag`, `StatStrip`, `Countdown`, `TierLadder`, `TierBar`, `MemberRow`, `MemberList`, `FeedEntry`, `ActivityFeed`, `TxChip`, `AccountLink`, `Ledger`, `Headroom`, `Proof`, `Equation`, `Field`, `BudgetInput`, `PolicyPreview`, `Banner`, `RpcBanner`, `Toasts`, `EmptyState`, `Skeleton`; `lib/model/` `ladder.ts` (`ladderModel`, `resolve`, `unitsToNextTier`), `members.ts` (`memberState`, archetype), `format.ts`; `lib/stores/` `clock.svelte.ts` (one `$state` now, 1s), `poll.svelte.ts`, `theme.svelte.ts`.

- Svelte 5 runes: derive everything visual with `$derived` from raw view data (`$derived(ladderModel(pool, members))`). Keep previous snapshots in a plain variable to detect flips and tier changes; set `data-flipped` / `data-just-reached` for 1200ms with `setTimeout`.
- Style hooks are CSS custom properties set inline (`style:--in={seg.in}`), exactly as in the mockups. Do not compute pixel positions in JS.
- Keyed `{#each members as m (m.agent_id)}` with `animate:flip` so flipped members slide between groups.
- Unit-test `resolve`, `unitsToNextTier`, `ladderModel` and `formatNear` against the mockup numbers: pool #7 (pledged 42, in 27, price 0.70, x = 8, k = 3, marker 41.1%) and pool #6 (55 units, 0.50, Σ locked 43.915 = 27.5 + 16.4 + 0.015).

---

## 13. The five things not to get wrong

1. **Money math in BigInt and exact.** yocto strings → BigInt; never floats. The receipt's proof, headroom bars and equation are computed from data, and the proof is withheld (with an honest error) if any check fails.
2. **The limit comes from `get_agent`, not `MemberView`.** `MemberView` has no limit; fetch `AgentView.limits.max_unit_price` for every member of a settled pool, or the headline "12 of 12 agents paid at or below their limit" is unproven.
3. **Ladder geometry is ordinal, piecewise linear, and `x` is simulated.** Equal-height segments, linear within a segment, marker `(k + frac) / n`. "N more pledged units" comes from re-running the SPEC 1.5 resolve with extra units, because waiting conditionals join the moment their threshold holds.
4. **Committed vs conditional is solid vs dashed plus words, and the flip is the moment.** A conditional member whose `projected_in` is true renders exactly like a committed one ("In at 20"); the waiting state is dashed cobalt ("Waiting for 50"). Animate the flip (and respect reduced motion), announce it in the live region.
5. **Tokens and classes ported verbatim, themes via `[data-theme]`.** No hard-coded colors, no Tailwind, no default-blue anything; every surface, border and text uses semantic tokens so dark mode and the tier palette just work. Tabular mono for every live number, and no em-dashes in any copy.
