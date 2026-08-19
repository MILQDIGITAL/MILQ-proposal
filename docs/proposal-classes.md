# Proposal layout classes

The fixed set of classes a proposal's `content_html` fragment is allowed to use. Keep this file,
`src/lib/sanitize.ts` and the `milq-proposal` skill's `references/proposal-html.md` in sync — if
you add a class here, add its CSS in `src/app/globals.css` and allow it through the sanitiser.

| Class | Purpose |
|---|---|
| `.milq-cover` | Proposal cover/hero block — title, client name, date |
| `.milq-lede` | Opening summary paragraph, larger type |
| `.milq-stat` | A single large-number stat callout |
| `.milq-pricing-grid` | Container for a row of pricing cards |
| `.milq-pricing-card` | One pricing option |
| `.milq-pricing-card--recommended` | Modifier: highlights the recommended pricing option |
| `.milq-scope-group` | A grouped block of scope/deliverable items |
| `.milq-process-strip` | Horizontal step-by-step process summary |
| `.milq-testimonial` | Pull-quote / client testimonial block |
| `.milq-terms` | Terms and payment block within the body copy |
| `.milq-team-card` | A single team member card |

`.milq-pricing-card` automatically gets an "Excludes GST" line appended by the shell (CSS
`::after`, see `src/app/globals.css`) — do not repeat "excludes GST" inside a pricing card's own
copy, it will read as duplicated. The skill's separate GST prose line elsewhere in the body is
fine; it is a different mention, not adjacent to a specific total.

Only tags and attributes in the sanitiser allowlist survive ingest: headings, paragraphs, lists,
tables, `img`, `a`, `strong`, `em`, `blockquote`, `hr`, `section`, `div`, `span`, with `class`,
`href`, `src`, `alt`, `colspan`, `rowspan` attributes. No inline styles, no `script`/`style`/
`iframe`, no event handlers. See `src/lib/sanitize.ts` for the exact allowlist.
