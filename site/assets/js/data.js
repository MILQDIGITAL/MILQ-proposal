/* Placeholder case studies. Brand names, numbers and quotes are illustrative
   only and should be replaced with approved client work before launch. */
window.MILQ_FILTERS = [
  { key: "all", label: "All" },
  { key: "strategy", label: "Strategy & Ops" },
  { key: "build", label: "Design & Build" },
  { key: "migration", label: "Migration" },
  { key: "growth", label: "SEO & AI Growth" }
];

window.MILQ_WORK = [
  {
    slug: "halcyon",
    name: "Halcyon Skin",
    sector: "Skincare",
    year: 2026,
    platform: "Shopify Plus",
    tags: ["Migration", "Build", "CRO"],
    filters: ["migration", "build"],
    stat: "+41%", statLabel: "Conversion",
    imgs: ["p1027", "p691", "p1068", "p996"],
    title: "A clinical skincare brand, finally as calm online as the product.",
    challenge: "Halcyon had outgrown a heavily customised Magento store. Every promotion needed a developer, page speed sat in the red, and subscription customers were churning at checkout because their bundles would not carry over.",
    approach: "We mapped every SKU, customer record and subscription before writing a line of code, then rebuilt on Shopify Plus with a modular theme the in-house team can run without us. Checkout Extensibility handles bundles natively and 4,200 redirects kept organic traffic whole on launch day.",
    results: [
      { v: "+41%", l: "Conversion rate, 90 days post-launch" },
      { v: "-1.8s", l: "Largest contentful paint on mobile" },
      { v: "0", l: "Organic traffic lost through migration" },
      { v: "11", l: "Weeks from kickoff to launch" }
    ],
    quote: { text: "They found problems in our numbers we had stopped seeing. The new store is the first one our team actually likes using.", who: "Head of eCommerce, Halcyon Skin" }
  },
  {
    slug: "fieldnote",
    name: "Fieldnote",
    sector: "Apparel",
    year: 2026,
    platform: "Shopify",
    tags: ["Design", "Build", "Headless"],
    filters: ["build"],
    stat: "+63%", statLabel: "Mobile AOV",
    imgs: ["p822", "p758", "p1059", "p1005"],
    title: "Workwear-inspired basics with a store built like a lookbook.",
    challenge: "Fieldnote sells through drops. Their old theme buried the editorial story under filters and banners, and mobile shoppers bounced before the product ever loaded.",
    approach: "A design system built from their garment tags: utility type, swatch-led navigation and a drop calendar that turns launches into events. Product pages load the look, then the size, then the story.",
    results: [
      { v: "+63%", l: "Mobile average order value" },
      { v: "2.4x", l: "Drop-day revenue versus previous season" },
      { v: "98", l: "Lighthouse performance score" },
      { v: "-37%", l: "Bounce rate on product pages" }
    ],
    quote: { text: "The site finally sells the way our pop-ups do.", who: "Founder, Fieldnote" }
  },
  {
    slug: "ritual",
    name: "Ritual Roasters",
    sector: "Coffee subscriptions",
    year: 2025,
    platform: "Shopify + Recharge",
    tags: ["Strategy", "Retention", "Integrations"],
    filters: ["strategy", "migration"],
    stat: "-29%", statLabel: "Churn",
    imgs: ["p766", "p1060", "p755", "p431"],
    title: "Turning a subscription leak into a loyalty engine.",
    challenge: "Ritual was acquiring well and losing nearly a third of subscribers by month three. Nobody owned the numbers between marketing, ops and the roastery.",
    approach: "A fractional eCommerce director from MILQ ran a 30-day profitability audit, rebuilt the subscription flow in Recharge, and set up a weekly trading rhythm the founders still run.",
    results: [
      { v: "-29%", l: "Subscriber churn at month three" },
      { v: "+$1.2M", l: "Annualised recurring revenue added" },
      { v: "4.1x", l: "Blended ROAS, up from 2.6x" },
      { v: "1", l: "Dashboard everyone reads on Monday" }
    ],
    quote: { text: "We stopped arguing about what was happening and started fixing it.", who: "Co-founder, Ritual Roasters" }
  },
  {
    slug: "oat-ember",
    name: "Oat & Ember",
    sector: "Wholefoods",
    year: 2025,
    platform: "Shopify",
    tags: ["SEO", "GEO", "Content"],
    filters: ["growth"],
    stat: "+212%", statLabel: "Organic revenue",
    imgs: ["p493", "p674", "p429", "p1080"],
    title: "Getting a pantry brand recommended by people and by AI.",
    challenge: "Oat & Ember had great products and almost no organic presence. Shoppers asking ChatGPT and Perplexity for breakfast ideas never heard of them.",
    approach: "Technical SEO clean-up, structured product data, and a recipe library written for both search engines and answer engines. We track brand mentions across AI assistants the same way we track rankings.",
    results: [
      { v: "+212%", l: "Organic revenue year on year" },
      { v: "38", l: "Category terms ranking top three" },
      { v: "5x", l: "Brand mentions in AI answers" },
      { v: "+54%", l: "Returning customers" }
    ],
    quote: { text: "We show up in answers now, not just in results.", who: "Marketing Lead, Oat & Ember" }
  },
  {
    slug: "good-boy",
    name: "Good Boy Co.",
    sector: "Pet care",
    year: 2025,
    platform: "Shopify Plus",
    tags: ["Fractional", "Ops", "B2B"],
    filters: ["strategy"],
    stat: "+18pt", statLabel: "Gross margin",
    imgs: ["p837", "p1062", "p26", "p464"],
    title: "A fractional eCommerce lead for a brand growing faster than its team.",
    challenge: "Wholesale and DTC were running as two businesses with two price books, two warehouses and no shared view of margin.",
    approach: "We embedded two days a week, merged B2B into Shopify Plus, renegotiated 3PL terms and built the P&L the board now reports from.",
    results: [
      { v: "+18pt", l: "Gross margin on DTC orders" },
      { v: "1", l: "Store for retail and wholesale" },
      { v: "-22%", l: "Fulfilment cost per order" },
      { v: "6", l: "Months to a self-running team" }
    ],
    quote: { text: "It felt like hiring a senior director without the 12-month ramp.", who: "CEO, Good Boy Co." }
  },
  {
    slug: "arden",
    name: "Arden House",
    sector: "Homewares",
    year: 2024,
    platform: "Shopify",
    tags: ["Migration", "Design", "ERP"],
    filters: ["migration", "build"],
    stat: "+34%", statLabel: "Revenue",
    imgs: ["p625", "p1068", "p464", "p882"],
    title: "From WooCommerce plug-in sprawl to a store that just works.",
    challenge: "Forty-one plug-ins, a nightly stock sync that failed weekly, and a showroom POS that never matched the website.",
    approach: "Migration to Shopify with POS in the showroom, a direct ERP integration and a quieter, more editorial design that lets the furniture do the talking.",
    results: [
      { v: "+34%", l: "Online revenue in the first two quarters" },
      { v: "41 → 9", l: "Apps and plug-ins in the stack" },
      { v: "100%", l: "Stock accuracy across web and showroom" },
      { v: "-46%", l: "Support tickets about orders" }
    ],
    quote: { text: "Our stock is right, our site is fast, and nobody is up at midnight fixing a sync.", who: "Owner, Arden House" }
  },
  {
    slug: "lumen",
    name: "Lumen Eyewear",
    sector: "Eyewear",
    year: 2024,
    platform: "Shopify Plus",
    tags: ["Build", "AR try-on", "CRO"],
    filters: ["build", "growth"],
    stat: "+27%", statLabel: "Add to cart",
    imgs: ["p64", "p65", "p996", "p978"],
    title: "Virtual try-on that feels like the shop floor.",
    challenge: "Customers loved the frames in store and hesitated online. Returns on fit were eating the margin.",
    approach: "A product page built around try-on, face-shape guidance and real-person imagery, tested in four rounds of A/B experiments.",
    results: [
      { v: "+27%", l: "Add-to-cart rate" },
      { v: "-31%", l: "Returns for fit" },
      { v: "4", l: "A/B test rounds to the final page" },
      { v: "+19%", l: "Conversion on mobile" }
    ],
    quote: { text: "Every change came with a reason and a number.", who: "Digital Director, Lumen Eyewear" }
  },
  {
    slug: "northbound",
    name: "Northbound Outfitters",
    sector: "Outdoor",
    year: 2024,
    platform: "BigCommerce → Shopify",
    tags: ["Migration", "SEO"],
    filters: ["migration", "growth"],
    stat: "+48%", statLabel: "Page speed",
    imgs: ["p823", "p856", "p832", "p836"],
    title: "A twelve-year-old catalogue moved without losing a single ranking.",
    challenge: "Eleven thousand SKUs, twelve years of URLs and a peak season six weeks away.",
    approach: "A migration plan built around search equity: redirect maps, structured data parity and a staged cutover over a single weekend.",
    results: [
      { v: "+48%", l: "Page speed" },
      { v: "11k", l: "SKUs migrated" },
      { v: "100%", l: "Rankings retained after cutover" },
      { v: "-40%", l: "Bounce rate" }
    ],
    quote: { text: "The calmest launch we have ever had.", who: "GM Digital, Northbound Outfitters" }
  }
];
