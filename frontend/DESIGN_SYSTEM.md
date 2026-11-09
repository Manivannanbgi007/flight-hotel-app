# FlightHotel design system v2 (v3 visual refresh, 2026-11-08)

The shared layer every page is built from (IMPLEMENTATION_PLAN.md, Phase 11 §11.1). Read this before you build or
restyle a page. Use the parts below instead of writing new ones; if something is missing, add it here (component and
section) rather than inside a page.

**See it live:** `npm run dev`, then open **`/dev/design-system`**. The component gallery only exists in development
builds. Its figures are made-up samples, so never copy them into a page.

| What | Where |
|------|-------|
| Tokens (colours, font, radii, shadows, gradients, motion) and utilities | `src/index.css` |
| Primitives | `src/components/ui/` |
| Motion helpers | `src/components/motion/` (`Reveal`, `AnimatedNumber`), `src/lib/useReducedMotion.ts` |
| Illustrations | `src/components/illustrations/` |
| Layouts | `src/components/layout/` (`PublicLayout`, `PageHero`, `PageContainer`, `SiteFooter`, `UserMenu`, `Logo`, `MinimalFrame`, `staff/StaffShell`) |
| Chart kit | `src/components/charts/` |
| Analytics dashboards (ranges, intervals, growth, filter bar) | `src/components/analytics/` |
| Portals, sign-in paths, guards | `src/lib/auth/portals.ts`, `src/lib/auth/redirects.ts`, `src/app/guards.tsx` |
| Sign-in and account screens (one layout: `AuthShell`) | `src/features/auth/AuthShell.tsx`, `authStories.ts`, `src/features/auth/signin/` |
| AI assistant (launcher, chat panel, voice) | `src/features/assistant/` (§11) |

---

## 1. Principles

- **Light theme only.** Deep ocean-blue brand, warm sunset accent, a soft sky gradient, white cards (10 px corners) with
  layered soft shadows.
- **Real data only.** No number, count, rating or "trusted by" claim is ever written in the code. Figures come from the
  API. Empty data gets an empty state, not a sample.
- **Accessible by default (WCAG 2.1 AA).** axe must report 0 serious or critical issues. Text has 4.5:1 contrast,
  everything works with the keyboard, focus is always visible, and illustrations and animation are decoration only.
- **Phones first.** Nothing may scroll sideways at 390 px. Tables scroll inside their own box.
- **CSP `'self'`.** No CDN fonts, images or scripts. The font is self-hosted and the illustrations are inline SVG.
- **Keep labels stable.** Tests and the e2e journeys find elements by their accessible names ("Log in",
  "Account menu for …", nav names such as "Main", "Admin", "Hotel sections"). Change a label only together with its
  tests.

---

## 2. Tokens (`src/index.css`)

All tokens live in Tailwind 4 `@theme static`. Every token is also a CSS variable (`var(--color-brand-600)`).

### Colour

| Scale | Use | Text rule |
|-------|-----|-----------|
| `brand-50 … 950` (vivid azure since v3, `#1f5ce8` at 600: white text 5.6:1; 700 `#1a4bc8` 7.3:1) | primary actions, links, focus, active navigation | white text on **600** or darker; links use **700** |
| `accent-50 … 900` (sunset, `#f26b1d` at 500) | highlights, illustrations, the `accent` button | white text on **600** or darker only; 300–500 for decoration |
| `success-*`, `warning-*`, `danger-*`, `info-*` | status: alerts, badges, trend chips | text and icons on the **600/700** step; backgrounds 50, borders 200 |
| `slate-*` (Tailwind) | neutrals: text 900 (headings), 700 (body), 600 (secondary), 500 (muted, minimum for text), borders 200 | never use 400 for text |
| `canvas` (`#f8fafc`, as light as slate-50 so slate-500 text on it keeps 4.5:1) and `bg-app` | the page canvas behind white cards; `bg-app` adds a faint wash of the portal colour at the top (staff portals) | text sits on cards, not on the canvas |
| `role-50 … 950` | the accent of the portal the page is shown in (see below) | white text on **600** |

**Role accent.** `bg-role-600`, `text-role-700`, `ring-role-200` and the other `role` steps follow the portal:

| Class on an ancestor | Role colour |
|----------------------|-------------|
| none (public and customer pages) | brand |
| `.role-admin` | indigo |
| `.role-manager` | teal (its "600" is teal-700, so white text passes AA) |
| `.role-support` | violet |

`StaffShell` and the sign-in pages set the class. In a portal page, write `text-role-700` instead of a fixed colour, so
the page works in every portal.

### Typography

- **One font: Inter** (variable, weights 100–900 with the optical-size axis), self-hosted through
  `@fontsource-variable/inter/opsz.css`, so the CSP's `font-src 'self'` needs no change.
  - `font-sans` and `font-display` are the same family (`'Inter Variable'`, then system fonts).
  - `font-optical-sizing: auto` gives large headings Inter's tighter display design and small text its open text
    design.
  - Only the Latin subset loads up front. The `latin-ext` file, which also has ₹, loads on pages that show it.
- **Documents use the same font.** The PDFs (confirmations, e-tickets, invoices, receipts, report exports) embed
  Inter's static TTFs: regular and bold, with ₹. E-mails ask for Inter first and fall back to Segoe UI or Arial, since
  most mail apps cannot load web fonts.
- Headings `h1`–`h3` get a slight negative letter-spacing (`-0.01em`). Body text needs no extra word spacing.
- Scale: page `h1` is `text-2xl sm:text-3xl font-bold` (PageHeader does this), sections are `text-lg/xl font-bold`, card
  titles `text-base font-bold`, body `text-sm`/`text-base`, and meta text `text-xs`.
- Numbers in tables use `tabular-nums` (set on every `<table>`). Large standalone figures, such as a KPI value, use
  proportional digits.

### Colourful canvas and icons (Phase 12)

- **Canvas.** The staff portals and the customer area sit on `<AppBackdrop />` (`components/layout`): a pale canvas
  (`bg-app`) with a fixed mesh of sky blue, violet, coral, mint and sun (`app-aurora-mesh`) and three blurred blobs that
  drift slowly (`aurora-a/b/c`, off under `prefers-reduced-motion`). It is decorative (aria-hidden); the cards on top stay
  white, so text keeps its contrast. In the customer area it fills the area (`within`), so the footer stays untouched.
- **Icons carry a colour of their own.** `src/icon-colors.css` is generated by `node scripts/gen-icon-colors.mjs`: every
  lucide icon the app uses gets a colour by what it means (money and success green, travel blue, stays teal, time and
  warnings orange, cancellations and danger red, people and settings violet, messages cyan, charts indigo, ratings and
  notifications amber, editing fuchsia). It applies where an icon was neutral (grey, the portal accent, or inheriting
  muted text) and to the soft tile that holds only an icon (`bg-role-50`, `bg-brand-50` …), which takes a light tint of the
  icon's colour. Icons on a colour of their own (buttons, gradient tiles, alerts, badges) are left alone. Navigation chrome
  (chevrons, arrows, close, menu, loaders, search) stays neutral. To colour a new icon, add it to a group in the script and
  run it again; an unlisted icon keeps its normal colour.
  **Pitfall:** the tile selectors match by substring, so a strong tile written `from-brand-500` (or `from-role-500`,
  `bg-brand-500`) is taken for a soft `from-brand-50` tile and turned pale. For a strong gradient tile that holds only an
  icon, use `bg-gradient-brand` or a default palette pair (`from-blue-500 to-indigo-600`).

### Radii, shadows and gradients

- Radii: **no box is rounder than 10 px** (2026-11-08). `rounded-lg`, `rounded-xl`, `rounded-2xl` and `rounded-3xl` are all
  0.625rem (10 px), so controls, inputs, buttons, cards, dialogs and bands share one corner; `rounded-md` (8 px) and
  `rounded-sm` (6 px) remain for small parts. Keep writing the steps by role (`rounded-xl` controls, `rounded-2xl` cards,
  `rounded-3xl` dialogs and bands) so a later change stays in `index.css`, and never write `rounded-[2rem]`.
  `rounded-full` is the one exception: circles (avatars, dots, round icon buttons, radio buttons) and pills (badges,
  chips, segmented controls).
- Shadows are layered (a contact shadow plus an ambient one): `shadow-xs`, `-sm`, `-card` (the default card), `-md`,
  `-lg` (hover), `-xl`, `-2xl` (dialogs). There are also coloured glows: `shadow-glow` (brand) and
  `shadow-glow-accent`.
- Gradient utilities:

  | Utility | Use |
  |---------|-----|
  | `bg-gradient-sky` | soft pages and panels |
  | `bg-gradient-ocean` | dark brand panels (the newsletter band) |
  | `bg-gradient-dusk` | heroes |
  | `bg-gradient-sunset` | warm highlights |
  | `bg-gradient-brand` | logo tile, small accents |
  | `bg-gradient-mesh` | two soft colour glows behind a section |
  | `text-gradient-brand` | gradient text, for one hero word at most |
- `glass` gives a frosted white surface (the sticky headers).
- `bg-grid-faint` (white lines, for dark gradient panels: heroes, the sign-in story) and `bg-grid-light` (slate lines,
  for light surfaces) draw a faint 1 px grid that fades out towards the edges. Put them on an `aria-hidden` layer.
- `PageHero` (ocean tone) layers the grid, the brand and sunset glows, and violet and cyan depth glows on its right
  half (never behind the text).

### Motion

| Token or utility | Value and use |
|------------------|---------------|
| `--duration-fast` | 150 ms (hover, colour changes); use as `duration-(--duration-fast)` |
| `--duration-base` | 220 ms (most transitions) |
| `--duration-slow` | 420 ms (panels) |
| `--duration-slower` | 700 ms (reveal on scroll) |
| `ease-out-soft`, `ease-in-out-soft`, `ease-spring` | easings |
| `animate-fade-in`, `animate-fade-up`, `animate-scale-in`, `animate-slide-down`, `animate-slide-in-left` | entrance animations (once) |
| `animate-shimmer`, `animate-float`, `animate-drift`, `animate-pulse-ring` | ambient loops (skeletons, illustration details, live dot) |
| `hover-lift` | cards rise 3 px and gain `shadow-lg` on hover |
| `stagger` | the direct children fade up one after another (60 ms apart) |
| `skeleton` | grey block with a moving shimmer (use `<Skeleton>`) |
| `.reveal` + `data-revealed` | fade and lift on scroll (use `<Reveal>`) |
| `sheen-sweep` | a band of light crosses the element every few seconds (a pseudo-element: no change to the accessible name). Only on the one main action or total of a page |
| `animate-gradient-pan` | a 200 %-wide gradient drifts (16 s); needs `bg-[length:220%_220%]` |
| `animate-draw-x` | a line draws itself (with `origin-left`: left to right) |
| `animate-pop` | an icon or badge arrives with a small spring |
| `animate-halo` | a soft ring grows out of an icon and fades. **Give the ring `opacity-0`**, so it is invisible when it is not animating |
| `animate-indeterminate` | the moving part of a progress bar without a known end |
| `animate-draw-path` | an SVG path with `pathLength="1"` and `[stroke-dasharray:1]` draws itself; put it on a **mask** path to reveal a dashed line (the profile's flight path) |
| `animate-ring-fill` | a progress ring with `pathLength="100"` fills from empty to its own `stroke-dashoffset` (fill mode `backwards`, so a later change of the value is a transition) |
| `animate-fly-route` | an element on a CSS motion path (`offset-path: path(…)`, set in `style`) flies from the start of the path to its own `offset-distance` (fill `backwards`); the path is in the pixels of a fixed-size box (the flight results band) |
| `animate-fly-loop` | the same, but the whole path again and again, fading out at the end (7 s; set `animation-duration`/`-delay` per plane). No fill mode: under reduced motion the plane rests at its own `offset-distance` (the home page's route map and closing band) |

**Reduced motion.** Under `prefers-reduced-motion: reduce`, every animation and transition runs in 0.01 ms, loops stop,
revealed content is simply visible, `hover-lift` does not move, `AnimatedNumber` shows the final value, and charts do not
animate. Do not add motion that bypasses this (no JS-driven position animation). A looping animation without a fill
mode returns to the element's own styles after its single short run, so those styles must be the resting look: the
`sheen-sweep` band rests off the element, a halo rests at `opacity-0`.

**Cursor.** Everything clickable shows the hand cursor, and disabled controls show "not allowed". This is one rule in `index.css` (base layer) covering buttons, `role="button"`, selects, checkboxes, radios, file and range inputs, labels of controls, options, tabs, menu items and switches. Tailwind v4's preflight otherwise leaves buttons on the arrow. A `cursor-*` utility on an element still wins.

**Motion rules.** Motion confirms an action or guides the eye; it never delays content. Forms, errors and anything above
the fold appear at once. Use `Reveal` only for sections below the fold.

---

## 3. Components (`src/components/ui`)

| Component | Notes |
|-----------|-------|
| `Button` | Solid variants (`primary`, `role`, `accent`, `danger`) carry a soft sheen (at most 10 % white at the top edge, where there is no text) and a 1 px inner highlight. `variant`: `primary` (default: the portal's accent, so brand blue outside the staff portals and indigo, teal or violet inside them; every main action in a portal matches), `accent`, `secondary`, `ghost`, `danger`, `role` (the same as `primary`), `link`. `size`: `sm`, `md`, `lg`, `icon`. `loading` disables it and sets `aria-busy`. Defaults to `type="button"`. |
| `ButtonLink`, `buttonClass()` | A router link that looks like a button (`buttonStyles.ts`). Navigation is a link; an action is a button. |
| `Card`, `CardHeader` | `variant`: `default` (white, shadow-card), `elevated`, `outline`, `glass`, `tinted` (role-50). `interactive` adds `hover-lift`; use it only on cards that are links or have one main action. |
| `TextField`, `PasswordField`, `SelectField`, `TextAreaField`, `CheckboxField` (`Field.tsx`) | Label, hint, error (with icon, linked by `aria-describedby`, `aria-invalid`) and "(optional)". `controlClass()` (`fieldStyles.ts`) styles a custom control the same way; `FieldChrome` (label, hint, error) wraps one. `TextField` and `PasswordField` take a decorative leading `icon` (a lucide component: `icon={Mail}`): grey, the portal colour while the field has focus, danger red with an error; it never replaces the label. Controls focus in the portal colour (`focus:border-role-600`, a 4 px `role-600/15` ring). |
| `DateField` | A date with a calendar (see *Form controls* below). `value`/`onChange` are ISO dates (`'2026-12-12'`, `''`). `min`, `max`, `rangeStart`/`rangeEnd` (the other end of a stay or From/To pair: shaded), `months={2}` for travel dates, `optional` (adds "Clear"). |
| `TimeField` | A time (`'14:30'`, 24-hour) with a list of suggested times (`step`, default 30 min; `min`, `max`), each also shown as "2:30 PM". |
| `SuggestField` | Free text with a list of suggestions under it (`suggestions: { value, description }[]`), e.g. a destination. |
| `selectClass()`, `checkboxClass`, `radioClass` (`fieldStyles.ts`) | The look of a native `<select>`, checkbox and radio outside a `SelectField`/`CheckboxField`. `selectClass(invalid, { inline: true, size: 'sm' })` for a select as wide as its options or a compact one. |
| `Calendar`, `FloatingPanel` | The styled DayPicker and the floating panel the pickers share (top layer, follows its field, opens upwards when there is no room). You rarely use them directly. |
| `Badge` | Tones: `neutral`, `info`, `success`, `warning`, `danger`, `brand`, `accent`, `role`. `dot` adds a dot. The text always states the status. An icon next to bare text is wrapped in a `display: contents` span, so `icon-colors.css` (which cannot see text nodes) does not take a `bg-brand-50`/`bg-role-50` badge for an icon tile and recolour its text below 4.5:1. Do the same in any other tinted box that holds an icon and bare text. |
| `Alert` | Tones: `info`, `success`, `warning`, `danger`. Danger and warning use `role="alert"`, the others `role="status"`. Optional `title`. |
| `Dialog` | A modal: focus moves in, Tab stays inside, Escape closes, focus returns to the opener. `title` and `description` are required for a good name and description. `icon` puts a tile before the title. `scroll="body"` is for long tables and comparisons: the title row stays, only the content scrolls (one box for both directions, slim scrollbar; the content brings its own padding), and on phones the dialog is a full-width sheet from the bottom. Inside it, sticky table headers (`top-0`), footers (`bottom-0`) and first columns (`left-0`) keep the context in view. |
| `Skeleton`, `SkeletonText` | Shimmer placeholders (`data-skeleton`, `aria-hidden`). Always pair them with a status text (`LoadingState` does). |
| `EmptyState`, `ErrorState`, `LoadingState` (`StateViews.tsx`) | `illustration`: `inbox` (default for empty), `search`, `lost`, `error` (default for errors), `locked`, `none`, or your own node. `compact` for use inside cards. ErrorState shows a support reference and "Try again". |
| `FullPageLoader` | A whole-page loading state (`role="status"`, label). |
| `Switch` | An on/off setting that applies at once. Name it with `aria-label`/`aria-labelledby`. |
| `LiveIndicator` | The realtime status dot (in the headers). |
| `StarRatingInput`, `StarScore` | A radio group of 5 stars; read-only score with a text alternative. |
| `Tabs`, `TabLinks` | WAI-ARIA tabs (arrow keys, Home, End). `variant`: `underline` or `pills`. Use `TabLinks` when each tab is a URL. |
| `Tooltip` | A short hint on hover and focus; Escape hides it; `aria-describedby` on the trigger. Never put essential information only in a tooltip. |
| `Avatar` | Photo or initials, sizes `xs`–`xl`, tint from the name, `ring`, `status` dot. Decorative unless you pass `label`. `features/account/Avatar` wraps it with the signed-in user's photo. |
| `StatCard`, `TrendChip` | A KPI card: `label`, `value` (a number counts up and is formatted with `format`), `change {percent, period, upIsGood}`, `icon`, a `sparkline` slot, `footer`, `to` (the whole card becomes a link), `loading`. The chip says "Up 12.5%" or "Down" to screen readers; green or red follows `upIsGood`. `percent: null` gives "No earlier figures to compare"; with `isNew` it gives a "New" chip instead (nothing in the previous period). `neutral` keeps the chip grey when neither direction is good or bad (a customer's own spending). `unit: 'points'` shows a rate's change in percentage points ("+2.1 pp"). |
| `PageHeader`, `Section` | The page `h1` (eyebrow, description, actions, icon, extra children such as filters) and a titled `h2` block (`id` makes it a labelled region; `as="h3"` inside a page whose layout owns the h1 and h2, e.g. hotel sections). |
| `Stepper` | Booking steps: an ordered list with `aria-current="step"` and "(completed)" for screen readers. On phones it becomes "Step 2 of 4: …" with a bar. |
| `DataTable`, `TableCard`, `Th`, `Td`, `Tr`, `tableStyles` | Every table looks the same (`dataTableStyles.ts`); use `tableStyles` on hand-written tables. Admin's `TableShell` and `SortHeader` follow it.<br>• **Card:** a rounded card with a caption.<br>• **Header row:** highlighted in the portal colour: a `role-100` band with a `role-200` hairline, bold small caps in `role-800` (`text-[0.6875rem]`, wide tracking, no wrapping), and the card's radius on the outer cells. Text placed on the band uses `role-800`/`role-950`, never slate-500, which is below 4.5:1 there. `thCompact` for chart tables; `headSurface` and `headType` for special grids (flight comparison, inventory calendar).<br>• **Sticky header:** from `xl` it sticks under the app header (`--app-header-height`). Tables wider than their card (some reports, reservations, the attention queue) set `scroll` and scroll sideways instead; a guard switches any other table to scrolling if it is wider than its card.<br>• **Sorting:** `SortHeader` puts the label and icon in a small pill (white on hover). The sorted column is a white chip with an arrow in the portal colour; the others show a faint `role-300` `ChevronsUpDown`. `aria-sort` and "first click descending" are unchanged.<br>• **Motion:** the card fades up, and the first ten rows come in 20 ms apart (`stagger-rows`; off under reduced motion).<br>• **Rows and cells:** on hover, a row gets a `role-50` tint and a 3 px accent bar on the left. `numeric` cells and headers are right-aligned with tabular digits; `primary` cells are bold (one text colour per cell: `tableStyles.cell` has no colour). |
| `Pagination` (+ `paginationItems.ts`) | Under every paged table and list: `<Pagination data={page} onPageChange onPageSizeChange pageSizes noun />`. Shows "Showing 26–50 of 927 bookings · Page 2 of 38", Previous/Next (disabled at the ends), page numbers with "…" (first, last and the neighbours of the current page; fewer on phones; the number of slots does not change while paging), and "Rows per page" (`sizeLabel="Per page"` for card lists). `data` is the API page, so the figures are the server's. Staff tables default to 25 rows, customer lists to 10. The menu offers only what the endpoint accepts: `PAGE_SIZES` (10, 25, 50, 100) or `PAGE_SIZES_UP_TO_50`. The size lives in `?size=` (`readPageSize`) or in state, and a new size starts at page 1. It renders nothing for an empty list, and no page buttons for one page. The navigation is named "Pages", the buttons "Previous", "Next" and "Page 3", and the current page has `aria-current="page"`; "Page 2 of 38" is announced. Marked `data-assistant-avoid`. |
| `Breadcrumbs` | A trail: links for the way up, `aria-current="page"` on the last item. On phones only the last crumb shows. |
| Toasts | `sonner`, already mounted in `AppProviders`. Its look (radius, semantic colours, shadow) comes from `index.css`. Use `toast.success(…)` and `toast.error(…)` for short confirmations, never for errors that need an action. |

### Form controls

All of them keep the field's label, hint and error, and work with react-hook-form through `Controller`:

```tsx
<Controller control={control} name="validFrom" render={({ field }) => (
  <DateField label="Valid from" error={errors.validFrom?.message} {...field} />
)} />
<DateField label="From" value={from} onChange={setFrom} rangeEnd={to} />   {/* onChange gets the ISO string */}
<DateField label="To" value={to} min={from || undefined} onChange={setTo} rangeStart={from} />
```

- **Dates.** The field shows "Sat, 12 Dec 2026"; it can also be typed (12/12/2026 day first, 2026-12-12, 12 Dec 2026).
  - A click or ↓ opens the calendar. Inside it, the arrows move by day and week, Page Up/Down by month, Enter chooses,
    Escape closes and returns to the field, and Tab moves on to the next field.
  - Days before `min` and after `max` are struck through. Today is ringed and the chosen day is filled in the
    portal colour.
  - Month and year menus appear for far-off dates; two-month travel calendars page with arrows.
  - A day's name starts with its number ("12 December 2026, Saturday"), so speech input can say what it sees.
  - The calendar (react-day-picker, about 16 KB gzip) is a separate chunk. It loads when the pointer reaches a date
    field or the field gets focus. Unit tests load it once in `src/test/setup.ts`.
- **Hotel and flight search.** Check-in/out and departure/return use `months={2}` and shade the stay or trip, also
  while hovering a later day. Check-out cannot be on or before check-in, and a check-in moved past the check-out moves
  the check-out to the next day (the return date of a flight already did this).
- **Selects stay native `<select>` elements.** Keyboard, screen readers, phones' own pickers, react-hook-form and
  `selectOption` in tests behave as before.
  - Every browser gets our closed look with the chevron.
  - Browsers with customizable selects (`appearance: base-select`: Chrome and Edge 135+) also get our open list: a
    rounded panel, highlighted options, a check mark on the chosen one, group headings.
  - Firefox and Safari keep their own open list until they support it.
- **Checkboxes and radios** are drawn (`.ui-checkbox`, `.ui-radio`) in the portal colour, with a check or dot that pops in.
- **Panels** (calendar, time list, suggestions) open in the browser's top layer (Popover API), so a dialog or a scrolling
  card never clips them. They stay inside their field in the DOM, so a dialog's focus trap includes them. Escape closes
  only the panel, not the dialog around it. Each panel has its own name ("Choose date", "Suggested times",
  "Suggestions"), so `getByLabelText('From')` finds just the field.
- **In tests:** date fields are role `combobox`, show the formatted date (`toHaveValue('Sun, 1 Nov 2026')`) and keep
  the ISO value in `data-value`. Typing a full ISO date or `fill('2026-11-01')` still works; clear a filled field first.

**Motion components** (`src/components/motion`):

- `Reveal as="section" delay={80}` fades content in on scroll, once (IntersectionObserver).
- `AnimatedNumber value format` counts to a value. Screen readers only get the final value.
- `useReducedMotion()` (`src/lib`) tells your own code whether to animate.

---

## 4. Illustrations (`src/components/illustrations`)

These are hand-made inline SVG React components. They are decorative (`aria-hidden`, not focusable), scale to their box
(`className="w-48"`), and draw their colours from `palette.ts`, which mirrors the tokens; a unit test checks that they
match. Each instance has its own gradient ids.

| Group | Components |
|-------|------------|
| Scenes | `TravelHeroIllustration` (hero: plane, clouds, sunset sea), `HotelIllustration`, `BoardingPassIllustration`, `GlobeIllustration` (map pins), `SuitcaseIllustration` |
| States | `EmptyInboxIllustration`, `NoResultsIllustration`, `LostIllustration` (404), `StormIllustration` (error), `AccessDeniedIllustration`, `PaymentSuccessIllustration`, `PaymentFailedIllustration` |
| Sign-in (one per role, made for the dark role gradient) | `CustomerSignInIllustration` (travel), `AdminSignInIllustration` (analytics), `ManagerSignInIllustration` (hotel front desk), `SupportSignInIllustration` (headset and chat) |

Rules:
- Never put information in a drawing; the text next to it says everything.
- Use one illustration per view, at the top of an empty, error or success state, or in a hero.
- New drawings go in this folder, use only `P` colours, `useSvgIds` for gradient ids and the `Svg` wrapper, and stay
  small (simple shapes, no embedded images or text).
- Size a drawing with a width class (`className="w-40 sm:w-44"`, `w-auto`); without one it fills its box (`w-full`).
  `cn` does not merge Tailwind classes, so the wrapper adds `w-full` only when no `w-*`/`size-*` class is given.
- The same applies elsewhere: a class you pass that conflicts with a component's own (`bg-*` on a `Card`, `max-w-*` on
  `Dialog`, `h-*` on a `Button`) is not guaranteed to win. Wrap the component instead.

---

## 5. Layouts

**`PublicLayout`** is used for public and customer pages:
- A glassy sticky header: logo, the "Main" nav (Flights, Hotels, My Trips, Offers, Help & Support), the live dot, the
  notification bell and `UserMenu`.
- On phones, the "Open menu" button shows the "Main mobile" nav, with "Login / Register" for visitors.
- `SiteFooter`: brand and support contacts (from the site settings), the "Footer" nav (travel, company, and partner and
  staff sign-in links), a newsletter band and the copyright line.

**`PageHero`** (`components/layout/PageHero.tsx`) is the illustrated band at the top of a public or customer landing
page (home, flights, hotels, offers, help, about, contact). It holds the page's only `h1`:
- `tone="ocean"` (dusk gradient, white text) or `"sky"` (light gradient, slate text); `size` `sm | md | lg`.
- `eyebrow`, `description`, `actions`, and a decorative `illustration` on the right from `md` up (floats gently).
- `children` overlap the band's lower edge: the search card on home, `/flights` and `/hotels`.

**`PageContainer`** (`components/layout/PageContainer.tsx`) frames every other public and customer page: the width
(`md` forms and booking steps, `lg` detail pages and lists, `xl` pages with a sidebar and the dashboard), 16 px side
gutters on phones, the vertical rhythm and a soft mesh glow behind the top of the page. Inside the customer area
(`InContentFrameContext`) it only holds the page's content (forms keep their `md` width); pages need no change.

**`CustomerAreaLayout`** (`features/account`, route layout) is the signed-in customer's area inside `PublicLayout`:
`/customer/dashboard`, `/my-trips`, a trip, and every `/account/*` page.
- **Sidebar.** A sticky card on the left, with who is signed in (name and role) and the "My account" nav
  (`customerNav.ts`): Overview (Dashboard, My trips), Activity (payments; Notifications and Support tickets as
  submenus), and Account (profile, passengers, preferences, security).
- **Collapsing.** "Collapse sidebar" shrinks it to icons with tooltips (`fh.customer.sidebarCollapsed`).
- **Phones and tablets.** Below `lg`, "My account menu" opens the same links in a drawer ("My account navigation").
- **Outside it.** Booking and payment steps stay outside the area, as single-column flows. Above the guards, it shows
  only the page until someone is signed in.
- **`AccountLayout`** is now just the "My account" card (a calm white card with a brand edge) above the section.

**`UserMenu`** is the account menu:
- **Button.** The avatar and, from `lg`, the first name and role ("Administrator", "Hotel manager", "Support agent",
  "Customer": `primaryRoleLabel`).
- **Menu.**
  - At the top: the name, e-mail and a role chip.
  - Customers get "My dashboard", "My Trips", "Payment history" and "Support tickets".
  - Everyone gets "My profile" and "Settings" (travel preferences for customers, security for staff); admins also
    get "System settings".
  - "Work portals" lists the staff portals the user's role allows (`portalLinks`), and "Log out" ends the session.

**`StaffShell`** (`components/layout/staff`) is the one layout of the admin, hotel manager and support portals:

```tsx
<StaffShell
  role="admin"                       // admin | manager | support → indigo | teal | violet
  title="Admin portal"
  icon={<ShieldCheck className="size-5" />}
  home="/admin"
  sections={[{ label: 'Admin', groups: [{ title: 'Overview', items: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/reports', label: 'Reports', icon: BarChart3, children: [/* a submenu */] },
  ] }] }]}
  breadcrumbs={crumbsFromNav(pathname, { label: 'Admin portal', to: '/admin' }, sections)}
  searchSlot={<GlobalSearch placeholder="Search bookings, users, pages..." />}
>
  <Outlet />
</StaffShell>
```

- **Sidebar** (from `lg`). It is fixed on the left, white with a hairline border, and 272 px wide.
  - The brand tile (role gradient, site and portal name) sits at the top and "View website" at the bottom.
  - It holds one `<nav>` per section; the section `label` is the accessible name, so keep "Admin", "Hotel manager",
    "Hotel sections" and "Support".
  - Groups have small caps titles, and every link has an icon. The current page is `role-50` / `role-700` with a role
    bar on its left.
  - Submenus (`children`) open with a chevron button, and by themselves on one of their pages.
  - Built from the shared `components/layout/nav` parts: `SidebarNav`, `NavTooltip`, `NavDrawer` and `navModel.ts`
    (`isItemActive`, `isTreeActive`, `crumbsFromNav`). `staffNav.ts` keeps the old type names.
- **Collapsing.** The header's toggle ("Collapse sidebar" / "Expand sidebar") shrinks it to 76 px of icons.
  - Names show as tooltips on hover and focus, and stay for screen readers; groups become thin lines, and a submenu
    becomes a link to its first page.
  - The width animates, and the page follows through `--sidebar-width`, the page's left padding.
  - The choice is remembered on the device (`fh.staff.sidebarCollapsed`).
- **Header.** Sticky, white and slightly translucent, 64 px tall (`--app-header-height: 4rem`; sticky table headers
  stop under it). It holds:
  - the toggle, or below `lg` "Open navigation" and the portal tile;
  - the breadcrumbs;
  - the global search (`searchSlot`, `features/search/GlobalSearch`), the same box in every portal and on the public
    site (docs/GLOBAL_SEARCH_IMPLEMENTATION.md):
    - grouped, highlighted suggestions while typing, built for the signed-in role;
    - "/" or Ctrl/⌘+K focuses it;
    - Enter opens the results page of the portal (`/admin/search`, `/support/search`, `/hotel-manager/search`;
      `/search` on the public site);
    - a field from `md`, a button below it;
  - the live dot (from `2xl`, since most pages show their own), the bell, and the user menu with name and role.
- **Phones and tablets.** Below `lg`, "Open navigation" opens the sidebar as a modal drawer: focus is trapped, Escape
  closes it, and choosing a page closes it.
- **Pages** render inside `<main id="main">` (fluid width beside the sidebar, capped at 120rem / 1920 px; 7rem bottom
  padding for the assistant's button) on the `bg-app`
  canvas, and bring their own `h1`, usually `PageHeader`.
- **Page transitions.** Sidebar and main navigation links use React Router's `viewTransition`. The page cross-fades
  in 180 ms while the header and sidebar (named `app-header`, `app-sidebar`) stay put; browsers without the View
  Transitions API just navigate, and reduced motion turns it off.

The three layouts (`AdminLayout`, `HotelManagerLayout`, `SupportLayout`) only build their navigation (permissions
included) and breadcrumbs.

Other layout pieces:
- **`MinimalFrame` and `InLayoutContext`.** A page that can also appear on its own (access denied, 404, a route error
  that replaced its layout) wraps itself in `MinimalFrame`. That adds a logo bar and `<main>` only when no layout is
  around it.
- **`AuthShell`** (`features/auth/AuthShell.tsx`, v3) is the one layout of every sign-in and account screen: the four
  sign-in pages, register (+ "Check your inbox"), forgot password, reset password / set password (invitations) and
  verify e-mail. These routes sit outside `PublicLayout` (no site header or footer), so nothing competes with the form.
  - **Large screens:** the story panel fills the left half on the role gradient (`roleClass`: none = brand,
    `role-admin`, `role-manager`, `role-support`) with a faint grid (`bg-grid-faint`), soft glows, the portal's
    illustration, an `h2` that names the region, a short text and three value points. It stays in view
    (`sticky`, `h-dvh`) while a long form (register) scrolls. The form column is on the right: logo, "Back to home",
    the form (max 26.5 rem; `wide` = 32 rem for register), and "© year site · Help & Support" at the bottom.
  - **Phones and tablets:** only the form column, with a soft wash of the role colour and a light grid at the top. The
    story is left out (it only repeats what the portal is for), so the form starts right under the logo.
  - **Content:** `AuthHeader` (optional portal badge, gradient icon tile or a state illustration, the `h1`, a
    subtitle; `center` for state screens) and `AuthFootnote` (quiet links under the form, e.g. "Back to log in").
  - **Stories** (`features/auth/authStories.ts`): the sign-in pages use `PORTAL_CONTENT`; register uses
    `REGISTER_STORY`; the password and verification pages use `ACCOUNT_STORY`, and `accountStoryFor(portal)` gives it
    the illustration of the portal a password page was opened from (`?portal=admin`), together with that portal's
    `roleClass`. Stories state features only, never figures.
  - Fields carry leading icons (`icon={Mail}`, `LockKeyhole`, `Phone`, `UserRound`) and example placeholders; the
    customer sign-in has "Create an account" as a full-width secondary button under a "New to {site}?" divider; the
    development accounts panel is one compact row per account ("Use" button, accessible name "Use credentials of …").
- **`AuthCard`** remains only for the newsletter link pages (inside `PublicLayout`): a centred card on the sky
  gradient.

---

## 6. Sign-in, routes and guards

| Portal | Sign-in | Lands on | Area |
|--------|---------|----------|------|
| CUSTOMER | `/customer/login` (`/login` redirects here and keeps `?redirect=`, `?reason=` and `?email=`) | `/customer/dashboard` | customer pages |
| ADMIN | `/admin/login` | `/admin` | `/admin/**` |
| HOTEL_MANAGER | `/hotel-manager/login` (admins too) | `/hotel-manager` | `/hotel-manager/**` |
| SUPPORT | `/support/login` (admins too) | `/support` | `/support/**` |

Everything about portals lives in `lib/auth/portals.ts`, so never hard-code these paths:
- `PORTALS`, `PORTAL_ORDER`
- `canUsePortal(user, portal)`, `primaryPortal(user)`
- `areaOfPath(path)`, `portalOfArea(area)`, `parsePortal('admin' | 'ADMIN')`
- `signInPath(portal, { redirect, reason })`, `portalLinks(user)`

Redirect helpers live in `lib/auth/redirects.ts`:
- `safeRedirect` refuses other sites and the auth pages.
- `defaultLanding(user)` returns the user's own start page.
- `canOpenPath(user, path)`.
- `loginPath(currentPath)` returns the right sign-in page for that area.

**The login request.** The form sends `portal` with `POST /api/auth/login`.
- `403 PORTAL_NOT_ALLOWED` shows "This account can't sign in here" with links to the other sign-in pages. When the
  error's `details.suggestedPortal` (or `details.portal`) names a portal, the message links that page only.
- The UI also checks the role after a successful login. If the account does not belong to this portal, it calls
  `authApi.logout(accessToken)` and shows the same message. The session is never stored.
- After sign-in, the user goes to a safe `?redirect=` the account may open, or else to the portal's start page.

**Guards** (`app/guards.tsx`):
- `RequireAuth area` sends visitors to the area's sign-in page with `?redirect=`.
- `RequireRole roles area` shows `ForbiddenPage` for a logged-in user with the wrong role. That page has "Go to my
  dashboard" and a link to the area's sign-in, which comes back afterwards.

Related flows:
- `/forgot-password?portal=admin` sends "Back to log in" to that portal's page.
- `/reset-password?...&portal=HOTEL_MANAGER` (for example from a staff invitation) sends the user to that portal's
  sign-in after the password is set.
- Server-ended sessions (`session.revoked`, "log out everywhere") go to the user's own portal sign-in page with the
  reason.

---

## 7. Chart kit (`src/components/charts`)

The kit is built on **recharts**, which is loaded lazily: the recharts chunk downloads only when the first chart is
drawn, so public pages without charts don't pay for it.

```tsx
import { AreaChart, BarChart, ChartCard, DonutChart, LineChart, Sparkline, formatINR } from '@/components/charts';

const report = useQuery({ queryKey: [...], queryFn: ... });     // real API data only

<ChartCard title="Revenue" description="Paid bookings by day" actions={<IntervalTabs />}>
  <LineChart
    title="Revenue per day"                 // summary + table caption (screen readers)
    data={report.data?.points ?? []}        // rows: { date: '2026-10-07', hotel: 1200, flight: 800 }
    xKey="date"
    xFormat="DAY"                           // DAY | WEEK → "7 Oct", MONTH → "Oct 2026", YEAR → "2026", or a function
    valueFormat="inr"                       // inr → ₹2,00,000 (tooltip/table), ₹2L (axis) · count · number · percent · fn
    series={[{ key: 'hotel', label: 'Hotels' }, { key: 'flight', label: 'Flights' }]}
    loading={report.isPending}
    emptyMessage="No paid bookings in this period"
    height={260}
  />
</ChartCard>

<BarChart ... stacked />                    // grouped by default; stacked = parts of one total
<AreaChart ... stacked />
<DonutChart title="Cancellations by type" valueFormat="count" centerLabel="Cancelled"
  data={[{ label: 'By customer', value: n1 }, { label: 'By hotel', value: n2 }]} />
<StatCard label="Bookings" value={total} change={{ percent, period: 'vs previous period' }} sparkline={<Sparkline values={series} />} />
```

What every chart has:
- **Screen-reader summary.** The plot is `role="img"` with a one-sentence summary: "Revenue per day, 1 Oct to 7 Oct.
  Hotels: ₹… in total, highest ₹… on …".
- **Table view.** The same numbers are in a `<table>`. It is hidden until "Show as table" is pressed, and screen
  readers can always reach it.
- **Legend.** Two or more series get a legend whose swatch mirrors the mark (a line for line charts, a square
  otherwise). A single series needs none; the title names it.
- **Tooltip.** One HTML tooltip lists every series at the hovered category, with a crosshair on line and area charts.
  It is mouse-only, so keyboard and screen-reader users get the values from the table.
- **Loading and empty states.** `loading` shows a shimmer with "Loading <title>…"; empty data (no rows or all zero)
  shows "No data for this period" or your `emptyMessage`.
- **Responsive width.** The plot measures its container; `height` is fixed.
- **Reduced motion.** No animation.

Formatters (exported):
- `formatINR(200000)` → ₹2,00,000; `formatINR(5913.6, { paise: true })` → ₹5,913.60.
- `formatINRCompact` → ₹9,800 / ₹2L / ₹2.5Cr.
- `formatCount`, `formatNumber`, `formatCompact`, `formatPercent`.
- `formatDateCategory(value, 'MONTH')`, `resolveValueFormat`.

Colours (`palette.ts`):
- The validated categorical order is blue `#2a78d6`, orange `#eb6834`, aqua `#1baf7a`, yellow `#eda100`, then magenta,
  green, violet and red.
- Use at most four series; fold the rest into "Other".
- A series keeps its colour. Pass `color` only to keep it fixed across charts.
- Status colours are not series colours.
- One Y axis only: two measures on different scales need two charts.

**The older `components/ui/Chart.tsx` is retired** (Phase 11, wave 2): the admin dashboard, its last user, moved to the
kit. `ui/chartMath.ts` (`chartSummary`, `niceScale`) stays; the kit's summaries use it. The hotel manager's nightly
report chart (`features/hotel-manager/NightlyBarChart.tsx`) is a small dependency-free SVG with its own summary
("Overall 85%. Highest … lowest …"), which reads better for percentages than a total.

---

## 7a. Analytics dashboards (`src/components/analytics`)

The building blocks of the staff dashboards (admin, hotel manager, support) on the analytics endpoints
(api-analytics §0: ranges, intervals, growth).

```tsx
import { AnalyticsFilters, analyticsApiParams, KpiGrid, KpiItem, toStatChange, useAnalyticsQuery } from '@/components/analytics';

const [query, setQuery] = useAnalyticsQuery();                     // ?range=THIS_YEAR&interval=WEEK (URL)
const data = useQuery({ queryKey: [..., analyticsApiParams(query)], queryFn: () => api.get(query), placeholderData: keepPreviousData }).data;

<AnalyticsFilters key={JSON.stringify(query)} value={query} onChange={setQuery}
  served={data && { range: data.range, interval: data.interval, previousRange: data.previousRange }} busy={...} />
<KpiGrid label="Payment figures">
  <KpiItem><StatCard label="Failed payments" value={data.payments.failedCount} format={formatCount}
    change={toStatChange(data.comparison.failedPayments, { upIsGood: false })} /></KpiItem>
  <KpiItem><StatCard label="Cancellation rate" value={data.cancellations.rate} format={formatPercent}
    change={toStatChange(data.comparison.cancellationRate, { kind: 'rate', upIsGood: false })} /></KpiItem>
</KpiGrid>
<BarChart data={data.series} xKey="start" xFormat={categoryFormat(data.interval, data.range)} xLabel={categoryLabel(data.interval)} … />
```

| Part | What it does |
|------|--------------|
| `range.ts` | The presets (`TODAY` … `LAST_5_YEARS`, `CUSTOM`; grouped for the menu), India "today", the days of a preset, the number of points per interval (ISO weeks, calendar months and years, cut ends count), the server's own interval choice (≤ 31 days DAY, ≤ 92 WEEK, ≤ 731 MONTH, else YEAR), the point limits (366 / 262 / 120 / 20), URL read/write (`readAnalyticsQuery` drops broken ranges and refused intervals), API parameters (`interval` only when chosen), `withRange` (a new range keeps the interval only when the server accepts it), `describeDays`, `categoryFormat` / `categoryLabel` for chart axes and tables. |
| `growth.ts` | `toStatChange(change, { kind, upIsGood })`: the API's `Change` as a TrendChip change. `changePercent: null` (previous 0) → "New" chip, never ∞ or NaN; a rate → percentage points ("+2.1 pp"); no Change → no chip. `formatGrowth` gives the same as text. `rateChange` works out a rate's change from two count Changes (payment success rate). |
| `AnalyticsFilters` | "Date range" select (presets in groups, "Custom dates" with From/To/Apply, at most five years), the "Interval" switch (Day/Week/Month/Year; refused intervals disabled with the reason as description; "chosen automatically" until the user picks one, then "Choose automatically"), and a status line with the real days, the interval and the compared period. |
| `SegmentedControl` | A one-of-many switch on native radios (arrow keys work); the selected segment is role-600 with white text. Also used for chart measures (Gross / Net). |
| `HighlightPanel`, `HighlightFigure` | The headline band: a deep role gradient (role-700 → role-950) with white figures (AA), decorative rings only. Use one per dashboard (admin revenue, hotel "Today at the front desk"). |
| `KpiGrid`, `KpiItem`, `FigureStrip` | KPI cards as a labelled list (screen readers hear the count; tests find a card by its label); small `<dl>` tiles for figures without a chip. |

`TrendChip` (`StatCard.tsx`) also takes `unit: 'points'` for a rate's change ("+2.1 pp", read "Up 2.1 percentage
points").

Rules:
- Every figure comes from the answer; derived figures (a rate's previous value) are worked out from it, never typed in.
- Name charts after the interval the server used ("Bookings per week"); use `start` as the category.
- A `400 INVALID_INTERVAL` gets a warning with "Choose the interval automatically"; other errors keep the previous
  figures on screen with an alert.
- Rates (occupancy, cancellation and success rates) compare in percentage points; for response times and cancellations
  down is good (`upIsGood: false`).

**Staff list pages** (`features/admin/shared/adminUi.tsx`, also used by the hotel manager and support pages):
`PageHeader` (portal eyebrow and icon tile), `FilterCard` (the filter bar), `ListLoading` (table-shaped skeleton with a
status text), `ResultCount` (a pill), `SearchBox` (role button); paging is the shared `Pagination`. Links in staff pages
use `text-role-700`.

**Hotel manager pages** (`features/hotel-manager/ManagerParts.tsx`). The layout owns the h1: one compact hotel header
with the cover thumbnail, status, `FactChip`s, "Guest view", the switcher, and section tabs below `lg`. Each page then
uses:

| Part | Use |
|------|-----|
| `ManagerPageHeader` | The page's h2 with an icon tile, a one-line description, and actions on the right. |
| `MetricTile` in a `MetricGrid` | Compact figures: the label and icon tile, the value (animated when it is a number, wrapping when it is text), an optional `TrendChip` and a hint. The grid is a labelled `<ul>` (2, 3, 4 or 6 columns; `wideLast` makes the last tile span the row). With `to`, a tile is a link. |
| `Toolbar` | The filter bar card: pills on top, then search, filters and sort. |
| `FilterPills` | Quick one-of-many filters with counts: buttons with `aria-pressed`, a labelled list that scrolls sideways on phones. `value: null` when no pill applies. |
| `SearchBox` | The search field with a magnifier inside, "Search" and "Clear". |
| `SectionCard` | A card with an icon tile, an h3, a description, actions and content. |
| `FactChip` | A small grey fact with an icon. |

Icon tiles are `bg-role-50 text-role-600 ring-role-100` with the svg as the only child, so icon-colors.css tints them
per icon. A button whose visible text is a count (e.g. "Filters 2") gets an `aria-label` ("Filters, 2 set"), because
an accessible name joins the parts without spaces.

**Data export** (`components/export/ExportMenu.tsx`, `lib/export/`). Every table and record list has one **Export**
button. It sits on the right of the list's result row (next to the count) and appears only when there are rows.

The menu offers:
- **Rows:** "This page" (the current page and page size) or "All matching rows". The second choice appears only for a
  list the server pages, and only when there is more than one page. It uses the same filters, search and sort, and
  holds at most 10,000 rows.
- **Format:** Excel (.xlsx), CSV or PDF (a PDF holds at most 2,000 rows).
- **Personal data:** a reminder when the rows hold people's details.

A screen gives the menu:

| Prop | What |
|------|------|
| `columns` | `ExportColumn<T>[]`: header, `value(row)` and `type` (`text`, `integer`, `number`, `money` + `currency`, `percent` in %, `date` from `YYYY-MM-DD`, `datetime` from an instant). Export what the table shows, one fact per column, with statuses as their labels. Leave out internal ids and anything the screen hides. |
| `rows` | The rows on screen. |
| `fetchPage(page, size)` | Only for server-paged lists: the **same API call as the screen**, with only the page changed. The server therefore applies the same filters and the same role checks, and an export can never contain more than the user may see. Pass `total`, `pageLabel` and `rowKey` too. |
| `filters` | `describeFilters([['Status', label], ['Search', q], …, ['Sort', label]])`: written into the file. |
| `title`, `subtitle`, `fileName` | "Reservations", "Arabian Sands Beach Resort", "reservations-…". The file name gets the date: `reservations-arabian-sands-beach-resort-2026-11-09.xlsx`. |
| `personalData` | Shows the reminder to keep the file safe. |
| `totals` | The table's totals row ('Total', then one value per column), only for lists that show totals (reports). It is written only when the file holds every row, never under a single page of a longer list, where it would not add up. |
| `currency: (row) => row.currency` | On a `money` column whose rows differ in currency: each amount is written in its own currency, and the CSV header then names no unit. Add a "Currency" column too. |

The files:

| Format | Layout |
|--------|--------|
| Excel | Sheet 1 has a dark header row, frozen, with filter buttons. Numbers, money (₹ format), percentages and dates are real values, so they sort, filter and add up. Column widths follow the content; the sheet prints A4 landscape with the header repeated on every page. A totals row is bold, below the filter range, so sorting never moves it. Sheet 2, "About this export", has the title, time, who exported, rows and filters. Text is never a formula. |
| CSV | UTF-8 with a BOM, so Excel reads ₹ and accents. Text is quoted. Numbers and dates are plain (`1234.50`, `2026-11-19 14:05`), and the header names the unit ("Amount (INR)"). Text that starts with `= + - @` gets a leading `'`, so a spreadsheet never runs it (CSV injection). |
| PDF | A4, landscape for wide tables. The title, subtitle, rows and filters are on top. The header row repeats on every page, numbers are right-aligned, and numbers and dates never wrap. A totals row closes the table in bold. The footer has the export time, who exported, and "Page n of m". Inter is embedded (subset), so ₹ and every name print. |

jsPDF and the Excel writer load only when somebody exports, and the fonts load only for a PDF. "All matching rows"
pages through the API at the size the server allows, waits and retries on `429`, and can be cancelled.

**Exports prepared on the server** (prop `serverExport`; the audit logs today). When a list holds more than 10,000 matching
rows, the browser cannot collect them. A screen whose API can write the file itself passes
`serverExport: { start(format, { exportedBy }), note }`. Above the limit, "All matching rows" then stays enabled, with
`note` under it. Excel or CSV calls `start`, the menu closes with the toast "Preparing your export", and PDF stays
disabled. At or below the limit, and for "This page", nothing changes.

The audit logs page shows the jobs in **"Your exports"** (`AuditExportsCard`):
- each job's status, a progress bar ("32,00,000 of 1,00,00,000 rows", or "Counting rows…"), size, the number of Excel
  parts in the .zip, how long the file stays, Download, and Cancel or Remove;
- the list refreshes live (`export.status-changed`) and re-reads itself every 5 s while a job is waiting or running;
- **Download** asks for a one-time link and lets the browser's download manager save it (`openDownloadLink`). The file
  can be a gigabyte, so it is never fetched into memory as a Blob.

Anywhere in the admin portal, a toast says when an export is ready (with Download) or has failed
(`useAuditExportNotifications`, mounted in `AdminLayout`).

---

## 8. Patterns

**Page skeleton**
```tsx
<PageHeader eyebrow="Admin portal" title="Bookings" description="…" actions={<ButtonLink to="…">Export</ButtonLink>} />
<div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{/* StatCards */}</div>
<Section id="recent" title="Recent bookings" className="mt-8">{query.isPending ? <LoadingState /> : …}</Section>
```

**Loading → error → empty → data**: `LoadingState` (or skeletons in the card's shape), `ErrorState`
(`LoadError` in admin) with "Try again", `EmptyState` with a helpful action, then the data.

**Grids**:
- KPI rows: `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`.
- Chart grids: `grid gap-4 lg:grid-cols-2`.
- Always add `min-w-0` to grid and flex children that hold tables or charts.

**Lists of cards**: `stagger` on the list, `Card interactive` on items that are links.

**Checkout screens** (the held hotel price `/hotels/quote/:id`, the payment step `/my-trips/:id/pay`; parts in
`features/bookings/CheckoutParts.tsx`):
- Layout: the main column and a summary card side by side from `lg` (`lg:grid-rows-[auto_1fr]`, the summary
  `lg:row-span-2 lg:sticky`); in the DOM the summary comes second, so on phones it follows the first card and the main
  action is never far away.
- `HoldTimer`: a ring that empties as a hold runs out, "Price held for 12:34" / "Pay within 12:34" as a `timer` (read
  when reached, not announced every second), the clock time it ends; orange from two minutes, red when over. The
  "expired" sentence goes into a `status` region that exists from the start.
- `StayTimeline`: check-in and check-out cards joined by a dashed line that draws itself, nights in the middle (a valid
  `dl`: the decoration sits inside the `dd`). `compact` for the 340 px summary column.
- `StayCover`: a drifting gradient band in the role colour with the title in white, and the hotel's first photo
  (`useHotelPhoto`, the cached hotel details) as a tilted postcard. Text never sits on the photo: demo photos carry
  their own lettering, and white text on an unknown picture cannot promise 4.5:1.
- `SecureSeal`: the shield with halos on the dark payment band. The total and the main button get `sheen-sweep`.

**Profile page** (`/account/profile`, `features/account`):
- Top row (side by side from `xl`, 5 : 6): `ProfilePhotoCard` (the checkout band's drifting gradient with a dashed flight
  path that draws itself and a plane that arrives, the 112 px avatar overlapping it with halos; clicking the photo opens
  the picker, the buttons do the same for keyboards) and `ProfileChecklist` (a ring and the six items of the **saved**
  profile; "Add" opens the picker or focuses the field, ids in `profileFieldIds.ts`).
- Settings-style form: groups (`role="group"` named by an `h3`) with the title and a one-line reason in a left column
  from `xl`, above the fields before. Only true reasons: the name, e-mail and mobile number are filled in at checkout.
- Save bar: always at the end of the form; **sticky only while there are unsaved changes** (frosted, pulsing dot,
  `sheen-sweep` on "Save changes"). Its sentence is a `status` region.

**Home page** (`/customer/home`, `features/home`; `/` redirects there keeping the query and hash, and links to the home
page use `HOME_PATH` from `lib/paths.ts`):
- `HomeHero`: the drifting gradient band (glows as gradients inside it) with a greeting for signed-in users ("Good
  evening, Asha") or "Flights and hotels in one place", the h1, and two links that say where to go next (customers: My
  trips, My dashboard; visitors: Create a free account, Log in; staff: none). From `lg` a decorative route map: a globe,
  flight paths that draw themselves one after another, two looping planes and floating cards without figures. The
  search card overlaps the band's lower edge.
- Sections share one header (eyebrow pill with an icon, h2, description, a pill "See all" link). The features are
  cards with gradient tiles; destinations are colour postcards (700/800 gradients, so white text passes) in a bento
  grid when there are five or more; flight routes are tickets with a perforated stub (a row that scrolls sideways on
  phones); a closing "Ready when you are" band before the FAQ.
- Link texts the tests read stay plain: a destination link is the city and its note, nothing else.

**Flight results** (`/flights/search`, `features/flights`):
- `FlightResultsHero`: the drifting gradient band with the title (`h1`; for a round trip "Choose your outbound flight:"
  in a smaller line inside it), the search as chips, and a frosted route box: the two airport codes, a dashed arc that
  draws itself and a plane that flies up the arc (`animate-fly-route`) and cruises there. The band's glows are
  gradients **inside** the band: a blurred element that reaches out of it (even clipped) sits under the sticky header
  for axe and fails the header's contrast.
- The search form folds away behind "Modify search" (`aria-expanded`) on every screen size; it is open only while a
  search is incomplete.
- `FlightSortBar`: the sort order as four radio tiles that show the best value of each order among the flights on
  screen (`resultInsights.ts`, unit-tested); the value is the radio's description. The count above them is a `status`
  ("4 flights · cheapest first").
- `FlightOptionCard`: "Cheapest" and "Fastest" tags (to all ties, to none when every flight has the same value), the
  timeline whose plane and filled line move on to the destination on hover (transforms only), the fare facts as chips
  (the fare chip keeps its "Saver · Refundable" text: the e2e journey reads it), and a price panel.
- Filters: the active-filter count next to the title, parts of the day as picture tiles (toggle buttons whose name is
  their visible text, "Morning 06:00–12:00"; pressing the chosen one again means any time).
- `CompareFlights`: a `Dialog` with `scroll="body"` around a real table. The flight header cards stick to the top, the
  "Total price" row with the select buttons to the bottom, the row labels (icon and name) to the left; rows are striped.
  "Cheapest"/"Fastest" in the headers and "Lowest"/"Shortest" on the best values follow `highlightsOf` (nothing when
  all are equal). On phones the flight columns have a fixed width: two fit beside the labels, a third is a swipe away.

**A dashboard with a period** (the customer dashboard, `features/customer`, is the reference):
- The period lives in the URL (`?range=THIS_YEAR`, `?range=CUSTOM&from=…&to=…`; the default leaves the URL clean), so
  it survives a reload and can be shared. Presets are real radio buttons styled as pills; custom dates apply with
  "Apply" after they were checked.
- Show the period the server resolved (`range.from … range.to`), not the preset's name only.
- Without a comparison block in the API, ask for the previous period of the same length (the days right before
  `range.from`, `range=CUSTOM`) and compute the change with the contract's rules (§0.4): `null` percent when the
  previous figure is 0 ("New"), no chip when both are 0, never ∞ or NaN. Keep that in a pure, unit-tested function.
- A user with no data at all gets an invitation (what to do first), not a wall of zeros; a user with data but nothing
  in the period gets the figures (zeros are information then) and the charts' empty states.
- Group KPI cards in labelled lists (`<ul aria-label="Bookings figures">`), so tests and screen readers can find them.

---

## 9. Do's and don'ts

| Do | Don't |
|----|-------|
| Use tokens (`bg-brand-600`, `text-role-700`, `shadow-card`, `rounded-2xl`) | Hard-code hex colours, or use Tailwind's raw `blue-*`/`orange-*` in pages |
| Take every figure from the API; show an empty state when there is none | Write sample numbers, ratings or "10,000 happy travellers" |
| Name things for screen readers (one `h1`, labelled navs and regions, `aria-label` on icon buttons) | Put meaning only in colour, an icon, a tooltip or an illustration |
| Keep text at slate-500 or darker on white, and white only on 600+ steps | Put light text on light gradients, or text on top of illustrations |
| Use `Button` for actions and `ButtonLink`/`Link` for navigation | Use `onClick` on a div, or a link that submits |
| Let tables scroll in `tableStyles.wrapper`; test at 390 px | Add fixed widths that push the page sideways |
| Use the motion utilities, which turn off under reduced motion | Animate with JS timers or animate layout (width, top) |
| Use `signInPath(...)`, `PORTALS`, `loginPath(...)` | Hard-code `/login` or the portal paths |
| Load heavy things lazily (pages, the chart kit already does) | Import `recharts` directly in a page |
| Use `DateField`, `TimeField`, `selectClass()`, `checkboxClass`, `radioClass` | Add `<input type="date">`, `type="time"`, a bare `<select>` or `accent-*` checkboxes |
| Pass size options (`selectClass(false, { inline: true })`) | Override a control's width or padding with extra classes (`cn` does not merge them; the CSS order decides) |

---

## 10. Checks before you hand over

- Run `npm run typecheck`, `npm run lint` (0 warnings), `npm test` and `npm run build`.
- Run `E2E_BASE_URL=http://localhost:5174 npm run test:e2e` against `npm run dev -- --port 5174 --strictPort`.
  - The journeys and the axe suite (`e2e/accessibility.spec.ts`) must stay green, with 0 serious or critical issues.
  - Add an axe scan for each new key page, at desktop and, for public and customer pages, phone width.
  - `settle()` waits for skeletons (`[data-skeleton]`, `.animate-pulse`), "Loading…" statuses and finite animations.
- No horizontal scroll at 390 × 844: `document.documentElement.scrollWidth === clientWidth`.
- Sign in through the portal helpers in e2e: `logIn(page, email, password, 'admin' | 'manager' | 'support' | 'customer')`.

---

## 11. AI assistant (`src/features/assistant`)

The chat and voice UI of the assistant ([AI_ASSISTANT.md](../AI_ASSISTANT.md), API in API_DOCUMENTATION.md §15). It is
mounted **once** in `app/AppRoot.tsx`, so it is on every customer page and in every staff portal; pages and layouts
never import it.

| Part | What it does |
|------|--------------|
| `AssistantLauncher` (main bundle, small) | The round 56 px button in the bottom-right corner (`z-40`, role gradient with a white ring and a soft inner light; `Sparkles`, a chevron while the panel is open). It owns the panel's three states: **minimized** (only the button), **normal** and **maximized** (remembered on the device, `fh.assistant.maximized`; maximized dims the page, a click there minimizes, and the button hides). Shown only to signed-in users while `GET /api/assistant/config` says `enabled` (one cached query, re-checked on window focus, every minute while disabled, and when the panel opens), never on sign-in pages. Takes the portal accent from the route (`accentClassOf`: `.role-admin`, `.role-manager`, `.role-support`). A dot shows an answer in progress (pulsing) or a new answer while the panel is closed. |
| `useAvoidBottomBars` | Moves the launcher up when something it must not cover is under it: a **fixed or bottom-sticky** bar in the lower half of the screen (a sticky save bar, the flight compare tray), or a control marked **`data-assistant-avoid`** below the top quarter of the screen (every `Pagination`). Pages need no other change; tall cards, sidebars and full-screen overlays are ignored. The staff shell's `main` also has 7rem bottom padding, so the end of every staff page scrolls clear of the button. |
| `AssistantPanel` (lazy chunk, loaded on first open) | A labelled dialog (`panelFrame.ts`). **Normal**, from `sm` up: docked above the launcher, 500 × up to 640 px (25 % wider than the first 400 px design, never wider than the window), non-modal. **Maximized**: 1rem (1.5rem from `lg`) from every edge of the window, the full height, modal (focus trapped), with the messages and the question box in a centred 48rem column. **Phones**: always a full-screen modal sheet (no Maximize). Header: role gradient, "AI assistant" with an online dot, the model, "New chat", Maximize/Restore and Minimize (icon buttons with hints). Escape, Minimize or the launcher minimizes it and the focus returns to the launcher. It stays mounted while minimized, so the conversation and a running answer survive; changing size plays a short settle animation. |
| `MessageList`, `MessageText` | The conversation (`role="region"` "Conversation", focusable for keyboard scrolling; `<ol>` "Messages"). Messages slide in (`animate-message-in`). Your questions in role gradient bubbles on the right, answers in white cards next to the assistant's avatar; until the first words arrive, "typing" dots (`animate-typing`) with the status line ("Thinking…", "Looking up your trips…"), "Based on:" source chips (`role-50` / `role-700`), a note when the grounding check replaced an answer, and errors with "Try again". **Answers are plain text**: line breaks, `- ` / `1. ` lists and `**bold**` only (a pipe table becomes one card per row with "column: value" pairs), never HTML, Markdown links or auto-linked addresses. |
| `Composer`, `VoiceOptions` | The question box (rounded, grey until focused, then white with a role ring) grows to 160 px; round microphone, Send (role gradient) and Stop buttons; Enter sends, Shift+Enter adds a line; the limit comes from `config.limits` (count shown from 80 %). "Stop the answer" while it streams. Microphone, recording bar (red dot, timer "0:07 / 1:00", Cancel), the "Read answers aloud" and "Voice conversation" switches, and the note when the browser's speech service is used. |
| `useAssistantChat` | Streaming over `fetch` (`chatStream.ts`, the shared `SseParser`), the reducer (`chatReducer.ts`), the conversation id in `sessionStorage` per user, history restore, 401 → refresh → retry once, friendly errors (`chatErrors.ts`). |
| `voice/` | Mode choice (`voiceSupport.ts`: the speech server, else the browser's Web Speech API, else no microphone), `VoiceRecorder` (MediaRecorder within the server's 60 s / 5 MB, stops after a pause), `BrowserDictation`, speech output (server MP3 from a `blob:` URL, or `speechSynthesis`). |

Rules for pages and layouts:
- Keep the bottom-right corner (about 88 × 88 px, 104 × 104 from `sm`) free of **fixed** controls if you can. If a page
  needs a bottom bar, make it `fixed` or `sticky bottom-0`: the launcher moves above it by itself.
- Do not add another floating button in that corner. Dialogs (`z-50`) cover the launcher and the docked panel.
- Never render model output as HTML or Markdown; use `MessageText`.
- Labels used by tests: "Open the assistant", "Minimize the assistant", "Maximize the assistant", "Restore the
  assistant to its normal size", dialog "AI assistant", textbox "Your question",
  "Send", "Stop the answer", "New chat", "Ask by voice", "Stop recording", switches "Read answers aloud" and "Voice
  conversation", lists "Try asking", "Messages" and "Sources".
- Screen readers: the message list is not a live region (it would read every word); a polite live region announces the
  status lines, whole sentences of the answer, the sources and errors.
- Motion: the panel fades/scales in and settles when its size changes, messages slide in, the typing dots rise, the
  recording dot and the launcher's busy dot pulse. All of it stops under reduced motion (the global rule; the size
  animation checks `useReducedMotion`), and scrolling to new text is instant.
