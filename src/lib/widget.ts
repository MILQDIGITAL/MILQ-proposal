import "server-only";
import type { Proposal, Signature } from "@/lib/proposals";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Safe to embed inside a <script> tag: JSON-encode, then defuse any literal "</script>". */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function formatSydneyTimestamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayPeriod = get("dayPeriod").toLowerCase();

  return `${get("day")} ${get("month")} ${get("year")} at ${get("hour")}:${get("minute")} ${dayPeriod} ${get("timeZoneName")}`;
}

/** Inserts trusted host markup immediately before the document's closing </body> tag. */
export function injectBeforeBodyClose(html: string, injection: string): string {
  const idx = html.search(/<\/body\s*>/i);
  if (idx === -1) return html + injection;
  return html.slice(0, idx) + injection + html.slice(idx);
}

const WIDGET_STYLES = `
:host, * { box-sizing: border-box; }
:host {
  all: initial;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #000000;
}
#bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  background: #000000;
  color: #ffffff;
  font-size: 14px;
}
#bar .msg { flex: 1 1 auto; min-width: 0; }
#bar .actions { display: flex; gap: 10px; flex: 0 0 auto; }
#bar button {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 10px 18px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: transparent;
  color: #ffffff;
}
#bar button.primary { background: #ffffff; color: #000000; border-color: #ffffff; }
#modal {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: rgba(0, 0, 0, 0.7);
  padding: 24px;
  overflow: auto;
}
#modal.open { display: flex; align-items: flex-start; justify-content: center; }
#modal .shell {
  width: 100%;
  max-width: 520px;
  background: #ffffff;
  color: #000000;
  border-radius: 4px;
  padding: 28px 28px 32px;
}
#modal h2 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
#modal .sub { font-size: 13px; color: #3d3d3d; margin: 0 0 20px; }
#modal label { display: block; font-size: 12px; font-weight: 600; margin: 14px 0 5px; }
#modal input[type="text"], #modal input[type="email"] {
  width: 100%;
  font-size: 14px;
  padding: 9px 11px;
  border: 1px solid #3d3d3d;
  border-radius: 3px;
  font-family: inherit;
}
#modal .sig-toggle { display: flex; gap: 8px; margin-top: 6px; }
#modal .sig-toggle button {
  flex: 1;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 8px;
  border: 1px solid #3d3d3d;
  background: #ffffff;
  color: #000000;
  cursor: pointer;
  border-radius: 3px;
}
#modal .sig-toggle button.active { background: #000000; color: #ffffff; }
#modal canvas {
  width: 100%;
  height: 140px;
  border: 1px solid #3d3d3d;
  border-radius: 3px;
  touch-action: none;
  margin-top: 8px;
}
#modal .typed {
  width: 100%;
  font-size: 24px;
  font-style: italic;
  padding: 16px 11px;
  border: 1px solid #3d3d3d;
  border-radius: 3px;
  margin-top: 8px;
  font-family: inherit;
}
#modal .clear {
  font-size: 11px;
  text-decoration: underline;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px 0 0;
  color: #3d3d3d;
}
#modal details {
  margin-top: 18px;
  border: 1px solid #f4f4f1;
  border-radius: 3px;
  padding: 10px 12px;
  font-size: 12px;
  color: #3d3d3d;
}
#modal summary { cursor: pointer; font-weight: 600; color: #000000; }
#modal .terms-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; font-size: 12px; line-height: 1.5; }
#modal .terms-row input { margin-top: 3px; }
#modal .error { display: none; margin-top: 12px; font-size: 12px; color: #b00020; }
#modal .footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
#modal .footer button { font: inherit; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 3px; cursor: pointer; }
#modal .footer .cancel { background: #ffffff; border: 1px solid #3d3d3d; color: #000000; }
#modal .footer .submit { background: #000000; border: 1px solid #000000; color: #ffffff; }
#modal .footer .submit:disabled { opacity: 0.5; cursor: not-allowed; }
#panel {
  display: block;
  background: #ffffff;
  color: #000000;
  border-top: 3px solid #000000;
  padding: 32px 24px 100px;
  font-size: 14px;
}
#panel .inner { max-width: 640px; margin: 0 auto; }
#panel h2 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
#panel .executed-sub { color: #3d3d3d; margin: 0 0 20px; font-size: 13px; }
#panel dl { display: grid; grid-template-columns: 160px 1fr; gap: 6px 16px; margin: 0 0 24px; font-size: 13px; }
#panel dt { color: #3d3d3d; }
#panel dd { margin: 0; }
#panel .sig-mark { font-size: 22px; font-style: italic; margin: 0 0 20px; }
#panel .sig-image { max-width: 240px; display: block; margin: 0 0 20px; border: 1px solid #f4f4f1; }
#panel h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 10px; }
#panel .audit { background: #f4f4f1; border-radius: 4px; padding: 16px 18px; font-size: 12.5px; line-height: 1.7; }
#panel .audit dl { grid-template-columns: 140px 1fr; margin: 8px 0 0; }
@media print {
  #bar { display: none !important; }
  #panel { display: block !important; break-inside: avoid; }
}
`;

function barMarkup(opts: { message: string; showSignButton: boolean }): string {
  return `
<div id="bar">
  <span class="msg">${escapeHtml(opts.message)}</span>
  <span class="actions">
    <button type="button" id="download-btn">Download PDF</button>
    ${opts.showSignButton ? `<button type="button" class="primary" id="open-sign-btn">Sign this proposal</button>` : ""}
  </span>
</div>`;
}

/**
 * Wraps the widget's markup, styles and script in a Shadow DOM root. This is the actual
 * isolation boundary described in BUILD_SPEC.md §3 — styles inside the shadow tree can't leak
 * out, and (more importantly here) the uploaded document's own CSS can't reach in, however
 * aggressive its resets or selectors are. Inline `<script>` tags don't execute when set via
 * innerHTML, so the bootstrap script below lives in the light DOM and reaches into the shadow
 * root by reference to wire everything up.
 */
function mountInShadow(innerHtml: string, scriptBody: string): string {
  const html = embedJson(`<style>${WIDGET_STYLES}</style>${innerHtml}`);
  return `
<div id="milq-host-widget-root"></div>
<script>
(function () {
  var host = document.getElementById('milq-host-widget-root');
  host.style.all = 'initial';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = ${html};
  (function (shadowRoot) {
    ${scriptBody}
  })(root);
})();
</script>`;
}

export function buildSigningWidget(proposal: Proposal, slug: string): string {
  const inner = `
${barMarkup({ message: "This proposal is ready for your signature.", showSignButton: true })}
<div id="modal">
  <div class="shell">
    <h2>Sign this proposal</h2>
    <p class="sub">Fields marked are required.</p>
    <form id="form">
      <label for="name">Full name</label>
      <input type="text" id="name" required />

      <label for="role">Role / title</label>
      <input type="text" id="role" required />

      <label for="company">Company</label>
      <input type="text" id="company" required />

      <label for="email">Email</label>
      <input type="email" id="email" required />

      <label>Signature</label>
      <div class="sig-toggle">
        <button type="button" id="tab-typed" class="active">Type it</button>
        <button type="button" id="tab-drawn">Draw it</button>
      </div>
      <input type="text" id="typed-input" class="typed" placeholder="Type your full name" />
      <canvas id="canvas" style="display:none"></canvas>
      <button type="button" id="clear-canvas" class="clear" style="display:none">Clear signature</button>

      <details>
        <summary>MILQ Digital General Terms and Conditions ${escapeHtml(proposal.terms_version)}</summary>
        <p style="margin-top:8px">
          Full terms text is hosted separately and linked here once migrated (BUILD_SPEC.md §7).
        </p>
      </details>
      <div class="terms-row">
        <input type="checkbox" id="terms-checkbox" required />
        <label for="terms-checkbox" style="margin:0">
          I have read and accept the MILQ Digital General Terms and Conditions
          ${escapeHtml(proposal.terms_version)}, and I have authority to enter this Agreement on
          behalf of <span id="company-echo">the company above</span>.
        </label>
      </div>

      <p class="error" id="error"></p>

      <div class="footer">
        <button type="button" class="cancel" id="cancel-btn">Cancel</button>
        <button type="submit" class="submit" id="submit-btn">Sign and accept</button>
      </div>
    </form>
  </div>
</div>`;

  const config = embedJson({
    slug,
    clientCompany: proposal.client_company,
    termsVersion: proposal.terms_version,
  });

  const script = `
    var CONFIG = ${config};
    var modal = shadowRoot.getElementById('modal');
    shadowRoot.getElementById('open-sign-btn').addEventListener('click', function () {
      modal.classList.add('open');
    });
    shadowRoot.getElementById('download-btn').addEventListener('click', function () {
      window.print();
    });
    shadowRoot.getElementById('cancel-btn').addEventListener('click', function () {
      modal.classList.remove('open');
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('open');
    });

    var companyInput = shadowRoot.getElementById('company');
    var companyEcho = shadowRoot.getElementById('company-echo');
    companyInput.value = CONFIG.clientCompany;
    companyEcho.textContent = CONFIG.clientCompany;
    companyInput.addEventListener('input', function () {
      companyEcho.textContent = companyInput.value || 'the company above';
    });

    var tabTyped = shadowRoot.getElementById('tab-typed');
    var tabDrawn = shadowRoot.getElementById('tab-drawn');
    var typedInput = shadowRoot.getElementById('typed-input');
    var canvas = shadowRoot.getElementById('canvas');
    var clearBtn = shadowRoot.getElementById('clear-canvas');
    var mode = 'typed';

    function setMode(next) {
      mode = next;
      var isTyped = mode === 'typed';
      tabTyped.classList.toggle('active', isTyped);
      tabDrawn.classList.toggle('active', !isTyped);
      typedInput.style.display = isTyped ? 'block' : 'none';
      canvas.style.display = isTyped ? 'none' : 'block';
      clearBtn.style.display = isTyped ? 'none' : 'inline-block';
      if (!isTyped) setupCanvas();
    }
    tabTyped.addEventListener('click', function () { setMode('typed'); });
    tabDrawn.addEventListener('click', function () { setMode('drawn'); });

    var ctx, drawing = false, hasDrawn = false;
    function setupCanvas() {
      if (ctx) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000000';
      canvas.addEventListener('pointerdown', function (e) {
        drawing = true; hasDrawn = true;
        ctx.beginPath();
        var r = canvas.getBoundingClientRect();
        ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var r = canvas.getBoundingClientRect();
        ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
        ctx.stroke();
      });
      window.addEventListener('pointerup', function () { drawing = false; });
    }
    clearBtn.addEventListener('click', function () {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
    });

    var form = shadowRoot.getElementById('form');
    var errorEl = shadowRoot.getElementById('error');
    var submitBtn = shadowRoot.getElementById('submit-btn');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.style.display = 'none';

      var signatureData = mode === 'typed' ? typedInput.value.trim() : (hasDrawn ? canvas.toDataURL('image/png') : '');
      if (mode === 'typed' && !signatureData) {
        errorEl.textContent = 'Type your name to sign.';
        errorEl.style.display = 'block';
        return;
      }
      if (mode === 'drawn' && !hasDrawn) {
        errorEl.textContent = 'Draw your signature to sign.';
        errorEl.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing...';

      fetch('/api/proposals/' + CONFIG.slug + '/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: shadowRoot.getElementById('name').value.trim(),
          signerRole: shadowRoot.getElementById('role').value.trim(),
          signerCompany: companyInput.value.trim(),
          signerEmail: shadowRoot.getElementById('email').value.trim(),
          signatureType: mode,
          signatureData: signatureData,
          acceptedTerms: shadowRoot.getElementById('terms-checkbox').checked,
          termsVersion: CONFIG.termsVersion,
        }),
      })
        .then(function (res) {
          if (res.ok) {
            window.location.reload();
            return;
          }
          return res.json().then(function (body) {
            throw new Error(body.error || 'Something went wrong. Please try again.');
          });
        })
        .catch(function (err) {
          errorEl.textContent = err.message;
          errorEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign and accept';
        });
    });
  `;

  return mountInShadow(inner, script);
}

export function buildExecutedWidget(
  proposal: Proposal,
  signature: Signature,
  audit: { viewCount: number }
): string {
  const signedAtDisplay = formatSydneyTimestamp(signature.signed_at);
  const publishedDisplay = formatSydneyTimestamp(proposal.created_at);
  const firstViewedDisplay = proposal.first_viewed_at
    ? formatSydneyTimestamp(proposal.first_viewed_at)
    : "Not recorded";

  const signatureMark =
    signature.signature_type === "drawn"
      ? `<img class="sig-image" src="${escapeHtml(signature.signature_data)}" alt="Signature" />`
      : `<p class="sig-mark">${escapeHtml(signature.signature_data)}</p>`;

  const inner = `
${barMarkup({ message: `Signed by ${escapeHtml(signature.signer_name)} — ${escapeHtml(signedAtDisplay)}.`, showSignButton: false })}
<div id="panel">
  <div class="inner">
    <h2>Executed</h2>
    <p class="executed-sub">This proposal was signed and is now locked.</p>

    ${signatureMark}

    <dl>
      <dt>Signed by</dt><dd>${escapeHtml(signature.signer_name)}</dd>
      <dt>Role</dt><dd>${escapeHtml(signature.signer_role)}</dd>
      <dt>Company</dt><dd>${escapeHtml(signature.signer_company)}</dd>
      <dt>Email</dt><dd>${escapeHtml(signature.signer_email)}</dd>
      <dt>Signed</dt><dd>${escapeHtml(signedAtDisplay)}</dd>
    </dl>

    <h3>Audit trail</h3>
    <div class="audit">
      <div>Proposal published — ${escapeHtml(publishedDisplay)}</div>
      <div>First opened by recipient — ${escapeHtml(firstViewedDisplay)}</div>
      <div>Opened ${audit.viewCount} time${audit.viewCount === 1 ? "" : "s"}</div>
      <div>Signed by ${escapeHtml(signature.signer_name)} — ${escapeHtml(signedAtDisplay)}</div>
      <dl>
        <dt>Role</dt><dd>${escapeHtml(signature.signer_role)}</dd>
        <dt>Company</dt><dd>${escapeHtml(signature.signer_company)}</dd>
        <dt>Email</dt><dd>${escapeHtml(signature.signer_email)}</dd>
        <dt>IP address</dt><dd>${escapeHtml(signature.ip ?? "Not recorded")}</dd>
        <dt>Terms version</dt><dd>${escapeHtml(signature.terms_version)}</dd>
        <dt>Document hash</dt><dd>${escapeHtml(signature.content_hash_at_signing.slice(0, 12))}&hellip;${escapeHtml(signature.content_hash_at_signing.slice(-6))} (unchanged since publication)</dd>
      </dl>
    </div>
  </div>
</div>`;

  const script = `
    shadowRoot.getElementById('download-btn').addEventListener('click', function () {
      window.print();
    });
  `;

  return mountInShadow(inner, script);
}

const PAGE_STYLES = `
body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #ffffff; color: #000000; }
main { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; }
h1 { font-size: 20px; margin: 0 0 12px; }
p { font-size: 14px; color: #3d3d3d; max-width: 360px; margin: 0 0 8px; line-height: 1.6; }
a { color: #000000; }
form { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 280px; margin-top: 8px; }
input[type="password"] { font-size: 14px; padding: 10px 12px; border: 1px solid #3d3d3d; border-radius: 3px; }
button { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 16px; border-radius: 3px; border: none; background: #000000; color: #ffffff; cursor: pointer; }
.milq-error { color: #b00020; font-size: 13px; }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}

export function buildNotFoundPage(): string {
  return page(
    "Proposal not found",
    `<main><h1>Proposal not found</h1><p>This link isn't valid, or the proposal has been removed.</p></main>`
  );
}

export function buildExpiredPage(ownerEmail: string): string {
  return page(
    "Proposal expired",
    `<main><h1>This proposal has expired</h1><p>Contact <a href="mailto:${escapeHtml(ownerEmail)}">${escapeHtml(ownerEmail)}</a> for an updated version.</p></main>`
  );
}

export function buildPasscodeGate(opts: { errorMessage?: string }): string {
  return page(
    "This proposal is protected",
    `<main>
      <h1>This proposal is protected</h1>
      <p>Enter the passcode you were given to view it.</p>
      <form method="POST">
        <input type="password" name="passcode" autofocus required placeholder="Passcode" />
        ${opts.errorMessage ? `<p class="milq-error">${escapeHtml(opts.errorMessage)}</p>` : ""}
        <button type="submit">Continue</button>
      </form>
    </main>`
  );
}
