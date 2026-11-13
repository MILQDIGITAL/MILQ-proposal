// Generates placeholder app icon / splash / favicon (bold "P" parking-sign motif) with Playwright.
// Usage: node scripts/make-icons.js   (needs Playwright + Chromium available)
const { chromium } = require("playwright");
const path = require("path");

const out = (f) => path.join(__dirname, "..", "assets", "images", f);
const html = (size, { pad, radius, bg = "#0B1B33" }) => `<!doctype html><html><body style="margin:0;background:${bg}">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg}">
  <div style="width:${size - pad * 2}px;height:${size - pad * 2}px;box-sizing:border-box;border:${Math.round(size * 0.05)}px solid #22C55E;border-radius:${radius}px;
    display:flex;align-items:center;justify-content:center;background:#0B1B33">
    <span style="font:900 ${Math.round((size - pad * 2) * 0.78)}px/1 Arial Black, Helvetica, Arial, sans-serif;color:#fff;margin-top:-${Math.round(size * 0.02)}px">P</span>
  </div>
</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shots = [
    ["icon.png", 1024, { pad: 150, radius: 150 }],
    ["adaptive-icon.png", 1024, { pad: 260, radius: 110 }],
    ["splash-icon.png", 512, { pad: 40, radius: 80 }],
    ["favicon.png", 64, { pad: 4, radius: 12 }],
  ];
  for (const [file, size, opts] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(html(size, opts));
    await page.screenshot({ path: out(file), omitBackground: false });
    console.log("wrote", file);
  }
  await browser.close();
})();
