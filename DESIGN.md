---
name: Exam Scheduler
description: A matte campus-wayfinding system for an auditable Thai/English exam scheduler — dark signage rail, white ruled work surfaces, one green action.
colors:
  ground: "#f5f6f2"
  nav: "#182c29"
  nav-ink: "#e3eae5"
  nav-muted: "#9db2a8"
  surface: "#ffffff"
  surface-alt: "#fbfbf8"
  ink: "#1d2a26"
  ink-muted: "#5c6b63"
  rule: "#daded3"
  rule-strong: "#c2cabf"
  action: "#26624e"
  action-hover: "#1e5140"
  action-soft: "#e6efe9"
  success: "#26624e"
  success-ink: "#174436"
  success-soft: "#e6efe9"
  success-border: "#bfd6cb"
  accent-warm: "#d18a35"
  warning: "#7a5200"
  warning-soft: "#f7efdb"
  error: "#a32c21"
  error-soft: "#f9ebe9"
  error-border: "#e5c0bb"
  selection: "#cfe2d9"
  selection-ink: "#10312a"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', 'Noto Sans Thai', 'Leelawadee UI', 'Sukhumvit Set', Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', 'Noto Sans Thai', 'Leelawadee UI', 'Sukhumvit Set', Arial, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', 'Noto Sans Thai', 'Leelawadee UI', 'Sukhumvit Set', Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', 'Noto Sans Thai', 'Leelawadee UI', 'Sukhumvit Set', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', 'Noto Sans Thai', 'Leelawadee UI', 'Sukhumvit Set', Arial, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 600
    lineHeight: 1.5
  scale:
    display-compact: "1.2rem"
    stat-suffix: "1.25rem"
    lede: "0.95rem"
    body: "0.9375rem"
    body-strong: "0.9rem"
    emphasis: "0.875rem"
    secondary: "0.85rem"
    label: "0.82rem"
    control-compact: "0.8rem"
    label-small: "0.78rem"
    label-micro: "0.72rem"
rounded:
  sm: "8px"
  md: "12px"
  pill: "999px"
  circle: "50%"
  focus: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "28px"
  view: "1160px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0.6rem 1.05rem"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.action}"
    rounded: "{rounded.pill}"
    padding: "0.6rem 1.05rem"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
  status-chip:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "0.18rem 0.6rem"
  status-chip-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.6rem"
  nav-item-current:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0.55rem 0.65rem"
  group-chip-selected:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0.28rem 0.7rem"
---

# Design System: Exam Scheduler

## Overview

**Creative North Star: "Campus Wayfinding"**

The interface behaves like a university's physical signage system: a dark, always-present wayfinding rail (like painted directional signage) alongside matte white work surfaces that read as printed forms spread on a desk. The page ground is a matte warm off-green (#f5f6f2) that never competes with the work; structure comes from crisp 1px hairline rules rather than shadows, gradients, or glass. Every surface states its elevation exactly once with a hairline border, and depth is spent on one place only: the modal edit dialog, which floats above a scrim.

Color discipline is severe. One saturated green (#26624e) owns every action, active state, and link; everything else is ink, muted ink, hairline gray-green, or a soft tint of a state color. The amber (#d18a35) is a fence paint, not a voice — it appears only as a border or marker on warnings and avoided days, never as text. Density is high and utility-grade: tables, registers, and evidence lists carry the product, with a compressed type ramp, tabular numerals, and bilingual system sans that renders Thai (the default interface language) and English with equal fluency.

Motion is signage-grade too: 150ms ease-out color and border transitions at rest, and short 180–200ms fade-rise entrances for notices and expanded evidence — nothing bounces, nothing travels more than a few pixels.

**Key Characteristics:**
- Matte #f5f6f2 ground, #182c29 dark nav rail, white panels — a signage-and-paper metaphor
- One green action color; soft tints and hairline rules carry all state
- Flat at rest; a single shadow vocabulary reserved for the modal dialog
- Crisp ruled tables with sticky uppercase headers and tabular numerals
- Pill-shaped actions and chips inside rectangular 8/12px-radius containment
- Single bilingual (Thai default / English) system sans stack; no display face
- 150ms ease-out state transitions; all motion respects `prefers-reduced-motion`

## Colors

A quiet green-gray institutional palette: warm off-green ground, near-black green signage ink, and one saturated green reserved for action.

### Primary
- **Campus Green** (#26624e): every action, active nav item, link, selected chip, focus outline, and the upload symbol. It is the only saturated fill in the resting UI; hover deepens to #1e5140, and its soft tint #e6efe9 serves hover backgrounds, secondary-button hover, and quiet highlights.
- **Campus Green Deep** (#1e5140): hover state of primary actions and selected navigation only.

### Secondary
- **Fence Amber** (#d18a35): strictly a border and marker accent for warnings and avoided calendar days — never a text color, never a fill.
- **Warning Ink** (#7a5200 on #f7efdb tint): the actual text and icon color for warning notices and warning status chips.

### Tertiary
- **Error Brick** (#a32c21 on #f9ebe9 tint, border #e5c0bb as `--error-border`): blocking errors, danger notices, unscheduled strips, unresolved table rows via a near-tint row background.
- **Success Ink** (#174436 on the #e6efe9 tint, border #bfd6cb as `--success-border`): success notices and passed-status chips. `--success`/`--success-soft` are defined as aliases of the action green and its tint — the system has one green, not two.
- **Selection** (#cfe2d9 background with #10312a ink): text selection (`::selection`) — a deeper tint of the action green with its dark ink, so even the browser's own surface stays on-system.

### Neutral
- **Matte Ground** (#f5f6f2): page background; never used for content surfaces.
- **Work Surface** (#ffffff): panels, tables, dialogs, the app header.
- **Counter Surface** (#fbfbf8): the quieter alternate — table headers, notices' resting state, upload areas, file register rows, evidence panels.
- **Ink** (#1d2a26) / **Muted Ink** (#5c6b63): primary and secondary text. Muted ink also labels footnotes, empty states, and stat captions.
- **Hairline** (#daded3) / **Strong Hairline** (#c2cabf): 1px rules and input borders. Dashed strong hairlines mark auxiliary containers (hints, rules rows, periods fieldsets).
- **Signage Dark** (#182c29) with **Signage Ink** (#e3eae5) and **Signage Muted** (#9db2a8): the navigation rail; its internal overlays are white at 6% (hover) and 12% (divider).

### Named Rules
**The Amber Fence Rule.** Amber (#d18a35) is fence paint: borders and markers on warnings and avoided days only. Warning text stays Warning Ink (#7a5200) on the pale #f7efdb tint. Amber is never text and never a fill.

**The Single Shadow Rule.** Panels, cards, chips, buttons, and every hover state declare elevation with a 1px hairline rule and (at most) a soft tint — no box-shadow. The one shadow in the system belongs to the edit dialog and the scrim behind it; spending it anywhere else dilutes the dialog's authority.

**The One Green Rule.** One green (#26624e) is the action color everywhere: buttons, links, active navigation, focus rings, selected chips. It is never joined by a second decorative hue; rarity of saturated color is what makes state legible.

## Typography

**Display Font:** System UI stack — `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', 'Noto Sans Thai', 'Leelawadee UI', 'Sukhumvit Set', Arial, sans-serif`
**Body Font:** same single stack
**Label/Mono Font:** none; numerals rely on `font-variant-numeric: tabular-nums`

**Character:** One bilingual workhorse family doing everything — the shared system stack is what makes Thai (the default UI language, with Buddhist-era Thai date formatting) and English render with equal weight and rhythm. Hierarchy is carried entirely by size and a semi-bold-plus weight of 650, never by a second face.

### Hierarchy
- **Display** (650, 1.5rem, line-height 1.25, -0.01em): the one h1 per view; drops to 1.2rem under 880px. Deliberately modest — this is a tool, not a landing page.
- **Headline** (700, 2rem, line-height 1.1, -0.02em): the overview stat numeral only, with tabular-nums; its unit suffix sits at 1.25rem muted.
- **Title** (650, 1.0625rem, line-height 1.25): panel headings (h2) and dialog headings; h3 sub-headings run at 0.9375rem.
- **Body** (400, 0.9375rem, line-height 1.55): base body size. Lede paragraphs run 0.95rem muted at max 66ch; dialog intro text runs 0.9rem; secondary text steps down 0.875 → 0.85rem.
- **Label** (600, 0.82rem): form labels and legends. The dense register ramp under it: 0.8rem for compact controls and filter selects, 0.78rem for small labels (count chips, footnotes, file meta, calendar notices, stat captions), and 0.72rem for the system's one uppercase voice — table column headers (600, uppercase, +0.04em letter-spacing, muted ink on counter surface) plus nav footnotes and calendar-time micro text. These dense steps are enumerated in the typographic `scale` and are the floor: no text ships below 0.72rem.

### Named Rules
**The One Family Rule.** No additional font family enters the system — not for numerals, not for code, not for emphasis. Weight (650 for headings, 600 for labels), size, and muted ink do all differentiating. Any surface needs Thai glyphs first, which the single stack already guarantees.

**The Tabular Digits Rule.** Dates, times, course codes, counts, and scores always set `font-variant-numeric: tabular-nums` — ruled tables and stat numerals must align in columns.

**The Bilingual Swap Rule.** Every string ships as a Thai/English pair rendered through one switcher; only one language is visible at a time (`<html lang>` follows the choice). Never mix languages on a surface; preserve original course names and identifiers from the source data as-is.

## Layout

A fixed wayfinding rail beside fluid work surfaces, built on a 4px rhythm.

- **App shell:** CSS grid of a 236px navigation rail (dark, sticky, full height, own scroll) plus `minmax(0, 1fr)` body. At 880px the rail is hidden and replaced by a fixed dark bottom tab bar (five thumb-reach destinations plus a More bottom sheet for the rest); the work area gains bottom padding so content clears the bar.
- **Work area:** the app header is a white bar with a hairline bottom border, controls right-aligned, the status chip pushed left by `margin-right: auto`. Main content pads 1.75rem (1rem under 880px) and centers views at max-width 1160px.
- **Working two-column layout:** content registers take `minmax(0, 1fr)` with a 340px sidebar (calendar settings); the sidebar is sticky below the header. Collapses to one column at 960px, when the sidebar also unsticks.
- **Forms:** labels stack above controls with a 0.3rem gap; fieldsets render borderless inside titled sub-panels; period date inputs pair in two columns; advanced settings fold into a `<details>` behind a hairline top rule rather than crowding the form.
- **Density:** table cells pad 0.55rem 0.75rem with a sticky uppercase header row; list rows and chips keep to 0.4–0.75rem gaps; spacing steps are 4/8/12/20/28px (panel padding 1.25rem, stack gaps 0.9rem, section spacing 1.5rem).
- **Breakpoints:** 960px (sidebar collapse), 880px (rail to bottom tab bar + More sheet; brand and status chip compact into the header; type and paddings tighten), 560px (stat grid and heading rows go single column; data registers become labeled cards and the calendar renders as an agenda list of intact weeks).

## Elevation & Depth

The system is flat by declaration. Panels, tables, chips, notices, and every hover state convey structure with a 1px hairline rule plus, at most, a tint shift — never a shadow, never a gradient. Depth exists in exactly one place: the native edit dialog (`<dialog>`), which carries the system's only box-shadow and a scrim.

### Shadow Vocabulary
- **Dialog shadow** (`box-shadow: 0 12px 40px rgb(24 44 41 / 0.22)`): the modal edit dialog only — a soft shadow tinted with the signage dark, not black.
- **Dialog scrim** (`rgb(24 44 41 / 0.45)` backdrop): the single overlay in the system.
- **Rail overlays:** inside the dark rail, separation uses white at 6% (item hover) and 12% (footer divider) rather than rules.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. The hover response is a border-color and background-color tint change over 150ms ease-out — never a lift, never a shadow.

## Shapes

Rectangular paper with soft corners; pills reserved for things you act on. Containment surfaces (panels, tables, dialogs, day cards) use 8px and 12px radii — 12px on outer containers, 8px on elements nested inside them (rows, notices, inputs, fieldsets, evidence panels, calendar event chips). Anything clickable-as-a-whole — buttons, status chips, count labels, group chips, holiday chips, segmented switches — is a full 999px pill; the icon button and upload symbol are perfect 50% circles. Borders are 1px solid hairlines; dashed strong hairlines consistently mean "auxiliary or informational container" (hints, rules rows, period fieldsets, avoided days). Focus rings are 2px action-green outlines offset 2px with a 4px corner radius (signage-ink colored when focus lands inside the dark rail, where green-on-dark fails contrast).

## Components

### Buttons
- **Shape:** full pill (999px); prominent weight (600, 0.875rem); 0.6rem 1.05rem padding.
- **Primary:** Campus Green fill, white text; hover darkens to #1e5140; disabled at 50% opacity.
- **Secondary:** white surface, green text and border; hover fills the soft green tint #e6efe9.
- **Compact:** 0.35rem 0.8rem at 0.8rem for table/toolbars.
- **Icon button:** 2rem transparent circle, muted ink; hover soft green tint with green icon.
- **Text button:** borderless green 600-weight text that underlines on hover.
- **Hover / Focus:** all state changes are 150ms ease-out color/border transitions; focus-visible is the standard 2px green outline.

### Chips
- **Status chip:** pill, strong-hairline border, counter-surface fill, muted ink — colored per state with tint fill, state-ink text, and a tinted border (warning: #f7efdb / #7a5200 / amber border; error: #f9ebe9 / #a32c21; success: #e6efe9 / #174436 / #bfd6cb lock-up).
- **Group chip / holiday chip:** pill with strong hairline; hover moves the border to green; selected fills green with white 650 text.
- **Segmented switch (type/language):** pill container with internal strong-hairline dividers; the active segment fills green with white text.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** white surface over the matte ground; 1.25rem padding; 1.25rem stack between panels.
- **Shadow Strategy:** none — see The Single Shadow Rule.
- **Border:** 1px solid hairline; the nested-step rule drops nested content to 8px radii.
- **Stat card:** panel with an h2 label, the 2rem tabular stat numeral, and muted captions.

### Inputs / Fields
- **Style:** 1px strong hairline border, 8px radius, white fill, 0.45rem 0.6rem padding; labels (0.82rem, 600) stacked above.
- **Focus / hover:** hover border goes green; focus-visible uses the 2px green outline; the search field (icon + borderless input) focuses as a whole via `:focus-within` border color.
- **Error / Disabled:** errors are inline text in Error Brick below the field; disabled fieldsets dim to 60%.

### Navigation
- **Style:** the 236px dark rail with a 26px calendar brand mark; nav items are transparent 8px-radius buttons with muted-ink icon + label; current item fills green with white text; unavailable items dim to 45% and carry a tooltip explaining the gate (import first / generate first), with a one-line hint under the list until results exist. Focus inside the rail switches the outline to signage ink.
- **Below 880px:** the rail is hidden; a fixed dark bottom tab bar carries the five most-used destinations (Sources, Overview, Exams, Calendar, Issues) with a **More** button that opens a bottom sheet listing the remaining views (Review, Groups, Rooms, Proctors, Cloud, Audit, Help). The current destination fills green on the tab; the More tab fills green when the current view lives in the sheet, and the sheet shows the unlock hint when results do not yet exist.

### Notices
- **Style:** 8px-radius rows with an icon and one sentence; success/danger/warning variants reuse the tint-fill + state-ink-text + tinted-border lock-up; a neutral variant uses hairline + counter surface.
- **Behavior:** announcements live in persistent visually-hidden `role="status"` / `role="alert"` regions so screen readers hear every swap (the visible rows mirror them aria-hidden); tone derives from the outcome — unfinished work (unscheduled exams, non-valid status) takes the warning tint, only clean completions earn the success green; entrance is the 180ms fade-rise; one notice per role at the top of the work area, never a stack.

### Tables (ruled registers)
- **Style:** collapsed borders, hairline row rules with a strong-hairline rule under the sticky uppercase header; white cells on counter-surface headers; row hover #fafbf7; unresolved rows tint #fdf6f5. Course codes act as green tabular-numeral links, with the course name clamped to 34ch beneath. Registers wear an 8px-radius hairline container of their own so tables can scroll horizontally. At 560px they drop the container and the header and reflow into labeled cards (one record per hairline card, `data-label` for the value labels) so no sideways pan is needed.

### Calendar Day (signature)
- **Style:** 8px-radius hairline day card, min-height 8rem, date header with muted weekday; fixed events are 8px-radius strong-hairline chips that border-green and tint on hover. Avoided days switch to a dashed amber border over the counter surface with a small warning-ink caption — the amber fence in its purest form. At 560px each week renders as an intact agenda group under a `สัปดาห์`/week label: the day cards stack full-width (blank spacers skipped, min-height released) so no horizontal pan is needed, and course names wrap instead of truncating.

### Issue Row (signature)
- **Style:** `<details>` summary row in an 8px-radius hairline container: icon, title, origin tag, chevron. Expanding reveals the evidence panel (counter surface, hairline top rule, 200ms fade-rise) containing a ruled evidence list of source rows — the "select a finding, see its original row" interaction the product is built around.

### Icons
- **Set:** one inline stroke-SVG component, 24px viewBox, 1.6px round-cap stroke, currentColor, default 20px.

## Institutional Brand

The system carries the institution's marks as the only sanctioned non-palette color: the FITM faculty logo (mountain-and-FITM lockup) and the KMUTNB parent mark. They are official logos, used **intact** — never recolored to fit the UI, never cropped to a fragment.

- **Navigation rail:** the FITM logo rendered monochrome white (`filter: brightness(0) invert(1)`) as the rail brand mark, beside the product wordmark — signage that stays legible on #182c29.
- **Source / landing masthead:** both full-color logos on a white work surface (`.institution-masthead`), the way a printed exam form carries its department masthead, with a muted institution line.
- **Help / guardrail attribution:** both logos small in muted ink (`.help-institution`).

Logos are an explicit exception to the One Green Rule — a brand mark is not UI chrome. They appear on white or white-on-dark only and never substitute for an action color.

## Do's and Don'ts

### Do:
- **Do** declare every resting surface with a 1px hairline rule (and at most a tint) — The Single Shadow Rule leaves the one box-shadow to the edit dialog.
- **Do** render warning text in Warning Ink (#7a5200) on the #f7efdb tint, with amber only as the border; state colors always pair a tint fill with their own dark ink, never the raw hue.
- **Do** keep clickable-whole elements as 999px pills, and containment at 12px outer / 8px nested radii.
- **Do** set `font-variant-numeric: tabular-nums` on all dates, times, codes, and counts.
- **Do** use dashed strong hairlines for auxiliary containers (hints, advanced settings, avoided days) and reserved-but-empty states.
- **Do** give every entrance animation a `prefers-reduced-motion` path — the global reduce kill-switch sets animation and transition durations to 0.01ms.
- **Do** ship every string as a Thai/English pair through the single switcher, Thai first; check the Thai stack renders before adding any font.
- **Do** mark informational disabled/hint content at 45–60% opacity or muted ink rather than removing it (unavailable nav stays visible; unrun checks label "Not checked").

### Don't:
- **Don't** put shadows on panels, cards, buttons, chips, hover states, or the nav — flat is the system.
- **Don't** use amber (#d18a35), error red (#a32c21), or any saturated color as body or label text.
- **Don't** introduce a second decorative hue, gradient, or glass/blur surface; the palette is green, ink, hairline, and state tints.
- **Don't** add a display or serif face, icon font, or emoji glyphs — icons are the inline 1.6px stroke SVG set only.
- **Don't** use a radius outside the 12/8/pill/circle scale (the former 6px radius on calendar event chips was corrected to 8px; don't reintroduce it).
- **Don't** write success (#bfd6cb) or error (#e5c0bb) chip borders as raw literals — they are tokens (`--success-border` / `--error-border`), and new state classes must use them.
- **Don't** stack notices into a feed — one notice per role, animated in, replaced not accumulated.
- **Don't** mix languages or translate source data; original course names and identifiers stay verbatim from the source files.
