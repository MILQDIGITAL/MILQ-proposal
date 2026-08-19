import sanitizeHtml from "sanitize-html";

// Mirrors docs/proposal-classes.md — keep the two in sync.
const ALLOWED_CLASSES = [
  "milq-cover",
  "milq-lede",
  "milq-stat",
  "milq-pricing-grid",
  "milq-pricing-card",
  "milq-pricing-card--recommended",
  "milq-scope-group",
  "milq-process-strip",
  "milq-testimonial",
  "milq-terms",
  "milq-team-card",
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
    "a",
    "strong",
    "em",
    "blockquote",
    "hr",
    "section",
    "div",
    "span",
  ],
  allowedAttributes: {
    "*": ["class"],
    a: ["href"],
    img: ["src", "alt"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  allowedClasses: {
    "*": ALLOWED_CLASSES,
  },
  allowedSchemes: ["https", "mailto"],
  disallowedTagsMode: "discard",
  // Belt and braces: sanitize-html already strips style/script/iframe/event handlers by
  // omitting them from allowedTags/allowedAttributes, but be explicit about intent here.
  exclusiveFilter: (frame) =>
    ["script", "style", "iframe"].includes(frame.tag),
};

/** Sanitises a proposal body fragment down to the fixed MILQ layout vocabulary. */
export function sanitizeProposalHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
