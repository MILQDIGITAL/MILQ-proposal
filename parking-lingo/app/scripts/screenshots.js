// Screenshots of the Result screen in demo mode at an iPhone viewport.
// Usage: start `npx expo start --web` (port 8081), then: node scripts/screenshots.js [baseUrl]
const { chromium } = require("playwright");
const path = require("path");

const base = process.argv[2] || "http://localhost:8081";
const outDir = path.join(__dirname, "..", "docs", "screenshots");
const shots = [
  { name: "result-yes-conditional-2p-meter", url: "/result?fixture=nsw-2p-meter-weekdays-sat" },
  { name: "result-conditional-clearway-sandwich", url: "/result?fixture=nsw-clearway-sandwich" },
  { name: "result-no-temporary-roadworks", url: "/result?fixture=temporary-roadworks-no-stopping" },
  { name: "result-upcoming-temporary-clearway", url: "/result?fixture=temporary-event-clearway" },
  { name: "result-depends-on-side", url: "/result?fixture=split-sides-no-stopping-1p" },
  { name: "result-side-selected-right", url: "/result?fixture=split-sides-no-stopping-1p", click: "side-right" },
  { name: "result-side-picker-detail", url: "/result?fixture=disabled-only-right", scrollTo: "side-selector" },
  { name: "result-no-loading-zone", url: "/result?fixture=loading-zone-with-evening-1p" },
  { name: "result-yes-permit", url: "/result?fixture=vic-permit-zone-area-12" },
  { name: "result-unsure-blurry", url: "/result?fixture=blurry-low-confidence" },
  { name: "result-evidence-open", url: "/result?fixture=temporary-works-zone-undated", click: "evidence-toggle", full: true },
  { name: "result-timeline-clearway", url: "/result?fixture=nsw-clearway-sandwich", scrollTo: "timeline" },
  { name: "result-intl-failure-demo", url: "/result?fixture=nsw-2p-meter-weekdays-sat&intl=fail" },
  { name: "result-night-taxi-zone", url: "/result?fixture=night-taxi-zone" },
  { name: "result-unsure-temporary-dates", url: "/result?fixture=dev-temporary-dates-unclear" },
  { name: "result-unsure-vehicle-note", url: "/result?fixture=dev-vehicle-note-unclear" },
  { name: "result-calendar-conflict", url: "/result?fixture=dev-jurisdiction-conflict", click: "evidence-toggle", full: true },
  { name: "scan-web", url: "/" },
  { name: "demo-list", url: "/demo" },
  { name: "settings", url: "/settings" },
  { name: "result-dark-clearway", url: "/result?fixture=nsw-clearway-sandwich", dark: true },
];
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

(async () => {
  const browser = await chromium.launch();
  for (const s of shots) {
    if (only && !only.includes(s.name)) continue;
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: s.dark ? "dark" : "light",
      timezoneId: "Australia/Sydney",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error(`[${s.name}] pageerror:`, e.message));
    page.on("console", (m) => m.type() === "error" && console.error(`[${s.name}] console:`, m.text()));
    await page.goto(base + s.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    if (s.click) {
      await page.getByTestId(s.click).click();
      await page.waitForTimeout(500);
    }
    if (s.full) {
      // Scroll the result list to the evidence section.
      await page.getByTestId(s.click).scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="result-scroll"]');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(300);
    }
    if (s.scrollTo) {
      await page.getByTestId(s.scrollTo).evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
    }
    const file = path.join(outDir, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log("wrote", file);
    await ctx.close();
  }
  await browser.close();
})();
