# UI consistency rules

These rules apply to every UI change in TimeLogger. Treat them as acceptance criteria, not optional styling suggestions.

## Page structure and alignment
- Every routed screen uses `.page-shell` and the shared `.page-header`; do not introduce a second page-level header pattern.
- Use `--page-gutter`, `--page-block`, and `--page-max` / `--page-max-wide` for page geometry. Do not hard-code a different horizontal gutter for a header, date bar, and main content on the same screen.
- Keep page headings and their first content section visually related. A new section must have consistent separation from the preceding content; the first section in a column must not receive extra top margin.
- Use the shared heading hierarchy: one `h1` per screen, `h2` for major sections, and `h3` for subsections. Keep subtitle/help text secondary and consistently spaced.

## Components
- Prefer existing shared classes from `src/styles/components.css` and `src/styles/forms.css` before adding page-local styles.
- Buttons must use the shared primary/secondary patterns where applicable and provide consistent hover, focus-visible, active, and disabled states. Avoid creating another one-off button class when a shared variant can express the intent.
- Tables and table-like lists must share the same surface, border, radius, header contrast, row divider, hover, selected, and overflow behaviour. Keep intentional column layouts page-specific, not their visual chrome.
- Panels/cards should use shared surface, border, radius, and spacing tokens. Avoid new hard-coded near-duplicate colours, radii, or spacing values.
- Use the design tokens in `src/styles/tokens.css` for colour, typography, spacing, borders, radii, transitions, and page geometry. Add a token if a repeated design value has no existing token.

## Responsive behaviour
- Use the common breakpoints: 1200px (wide layouts), 1024px (compact desktop/tablet), and 768px (narrow layout). Add a breakpoint only when a real content constraint requires it, and explain that reason in a short comment.
- At narrow widths, headers/actions must wrap without overlap, controls must remain reachable, and tables must use a deliberate horizontal-scroll or stacked-row strategy. Do not collapse every table into a single column if that destroys row/column meaning.
- Settings navigation and content must remain usable without nested scroll traps. Test keyboard navigation and scrolling as well as pointer use.

## Scoped CSS and review
- Before adding scoped CSS, check whether the component already has a shared rule. Scoped selectors can override shared styles; do not copy an entire shared rule into a page component.
- Keep page-specific overrides limited to actual layout/behaviour differences. If a shared component's appearance needs to change, change the shared class/token and review its other consumers.
- For every UI pull request, inspect all changed screens at desktop and narrow widths, check spacing before/after section headings, check focus and disabled states, and run `npm run build`. Run `npm run check` when the environment supports the full toolchain.
- The PR description should state which shared UI patterns were reused and which intentional exceptions remain.
