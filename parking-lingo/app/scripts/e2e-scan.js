// End-to-end check of Scan → Analysing → Result on web against a server in mock mode.
// Usage: node scripts/e2e-scan.js http://localhost:8082 <image-file>
const { chromium } = require("playwright");
const path = require("path");

const base = process.argv[2] || "http://localhost:8082";
const image = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Australia/Sydney" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  const reqs = [];
  page.on("request", (r) => r.url().includes("/v1/") && reqs.push(r));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose a photo" }).click()]);
  await chooser.setFiles(image);
  await page.getByTestId("verdict-hero").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const r = reqs[0];
  if (r) {
    const body = JSON.parse(r.postData());
    console.log("request headers:", JSON.stringify({ token: r.headers()["x-app-token"], mock: r.headers()["x-mock-fixture"] }));
    console.log("image:", body.image.mediaType, Math.round((body.image.base64.length * 3) / 4 / 1024), "KB; context:", JSON.stringify(body.context));
  }
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "screenshots", "e2e-scan-result.png") });
  await page.goto(base + "/history", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "screenshots", "history.png") });
  console.log("ok");
  await browser.close();
})();
