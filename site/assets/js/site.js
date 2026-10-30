/* MILQ. site behaviour — vanilla JS on top of GSAP + ScrollTrigger + Lenis. */
(() => {
  const doc = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const desktop = () => matchMedia("(min-width: 861px)").matches;
  const hasGSAP = !!window.gsap;
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };
  const page = document.body.dataset.page || "home";
  const IMG = (id) => `assets/img/${id}.jpg`;

  if (hasGSAP && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  /* ------------------------------------------------------------------ data-driven markup */
  const work = window.MILQ_WORK || [];
  const filters = window.MILQ_FILTERS || [];

  function rowHTML(w) {
    return `<li class="row" data-filters="${w.filters.join(" ")}">
      <a href="case.html#${w.slug}" data-peek="${IMG(w.imgs[0])}" data-cursor="View" data-transition>
        <span class="row__name">${w.name}<span class="label muted" style="display:block;margin-top:6px">${w.sector} · ${w.year}</span></span>
        <span class="row__tags">${w.tags.map(t => `<span class="chip">${t}</span>`).join("")}</span>
        <span class="row__stat"><b>${w.stat}</b><span class="label muted">${w.statLabel}</span></span>
        <span class="row__thumbs">${w.imgs.slice(0, 3).map(i => `<span><img src="${IMG(i)}" alt="" loading="lazy"></span>`).join("")}</span>
      </a></li>`;
  }
  function tileHTML(w) {
    return `<a class="tile" href="case.html#${w.slug}" data-filters="${w.filters.join(" ")}" data-cursor="View" data-transition>
      <span class="tile__img px"><img src="${IMG(w.imgs[0])}" alt="${w.name}, ${w.sector}" loading="lazy" data-px></span>
      <span class="tile__meta"><h3>${w.name}</h3><span class="label muted">${w.stat} ${w.statLabel}</span></span>
      <span class="label muted">${w.tags.join(" · ")}</span>
    </a>`;
  }
  function filterHTML(list) {
    return filters.map((f, i) => {
      const n = f.key === "all" ? list.length : list.filter(w => w.filters.includes(f.key)).length;
      return `<button type="button" data-filter="${f.key}" aria-pressed="${i === 0}">${f.label}<sup>${n}</sup></button>`;
    }).join("");
  }

  $$("[data-rows]").forEach(el => {
    const n = parseInt(el.dataset.rows, 10) || work.length;
    el.innerHTML = work.slice(0, n).map(rowHTML).join("");
  });
  $$("[data-tiles]").forEach(el => { el.innerHTML = work.map(tileHTML).join(""); });
  $$("[data-filters-for]").forEach(el => { el.innerHTML = filterHTML(work); });

  // case study page renders from the hash
  if (page === "case") {
    const slug = (location.hash || "").slice(1);
    const i = Math.max(0, work.findIndex(w => w.slug === slug));
    const w = work[i];
    const next = work[(i + 1) % work.length];
    const set = (k, v) => $$(`[data-case="${k}"]`).forEach(n => { n.innerHTML = v; });
    document.title = `${w.name} — MILQ.`;
    set("name", w.name);
    set("title", w.title);
    set("sector", w.sector);
    set("year", w.year);
    set("platform", w.platform);
    set("services", w.tags.join(", "));
    set("challenge", w.challenge);
    set("approach", w.approach);
    set("quote", w.quote.text);
    set("who", w.quote.who);
    set("results", w.results.map(r => `<div><b>${r.v}</b><span class="label">${r.l}</span></div>`).join(""));
    set("next", next.name);
    $$("[data-case-img]").forEach(img => {
      const k = parseInt(img.dataset.caseImg, 10);
      img.src = IMG(w.imgs[k % w.imgs.length]);
      img.alt = `${w.name}: placeholder imagery`;
    });
    $$("[data-case-next]").forEach(a => { a.href = `case.html#${next.slug}`; });
    window.addEventListener("hashchange", () => location.reload());
  }

  /* ------------------------------------------------------------------ smooth scroll */
  let lenis = null;
  if (!reduce && window.Lenis && hasGSAP) {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const lock = (on) => { document.body.classList.toggle("is-locked", on); if (lenis) on ? lenis.stop() : lenis.start(); };

  /* ------------------------------------------------------------------ page transition (pour) */
  const pour = $(".pour");
  const pourPath = pour && $("path", pour);
  const P = {
    below: "M0 100 L100 100 L100 100 Q50 100 0 100 Z",
    rising: "M0 100 L100 100 L100 45 Q50 10 0 45 Z",
    full: "M0 100 L100 100 L100 0 Q50 0 0 0 Z",
    fullTop: "M0 0 L100 0 L100 100 Q50 100 0 100 Z",
    draining: "M0 0 L100 0 L100 55 Q50 85 0 55 Z",
    gone: "M0 0 L100 0 L100 0 Q50 0 0 0 Z"
  };
  function leave(href) {
    if (!pour || !hasGSAP || reduce) { location.href = href; return; }
    store.set("milq-pour", "1");
    lock(true);
    gsap.set(pour, { visibility: "visible" });
    gsap.timeline({ onComplete: () => { location.href = href; } })
      .fromTo(pourPath, { attr: { d: P.below } }, { attr: { d: P.rising }, duration: .45, ease: "power2.in" })
      .to(pourPath, { attr: { d: P.full }, duration: .35, ease: "power2.out" })
      .to(".pour__logo", { opacity: 1, duration: .2 }, "-=.2");
  }
  function arrive() {
    if (!pour || !hasGSAP || store.get("milq-pour") !== "1" || reduce) return false;
    store.del("milq-pour");
    gsap.set(pour, { visibility: "visible" });
    gsap.set(pourPath, { attr: { d: P.fullTop } });
    gsap.set(".pour__logo", { opacity: 1 });
    gsap.timeline({ delay: .1, onComplete: () => gsap.set(pour, { visibility: "hidden" }) })
      .to(".pour__logo", { opacity: 0, duration: .25 })
      .to(pourPath, { attr: { d: P.draining }, duration: .4, ease: "power2.in" }, "<")
      .to(pourPath, { attr: { d: P.gone }, duration: .4, ease: "power2.out" });
    return true;
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|https?):/.test(href)) return;
    const here = location.pathname.split("/").pop() || "index.html";
    const [path, hash] = href.split("#");
    if ((path === "" || path === here) && hash) return; // same-page anchor
    e.preventDefault();
    closeMenu();
    leave(href);
  });
  window.addEventListener("pageshow", e => { if (e.persisted) { lock(false); if (pour) pour.style.visibility = "hidden"; } });

  /* ------------------------------------------------------------------ text helpers */
  const GLYPHS = "MILQ.0123456789/#%+-";
  function scramble(el, text) {
    if (!el) return;
    if (reduce) { el.textContent = text; return; }
    clearInterval(el._scr);
    let f = 0; const total = 14;
    el._scr = setInterval(() => {
      f++;
      const p = f / total;
      el.textContent = text.split("").map((c, i) => (c === " " || i / text.length < p) ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join("");
      if (f >= total) { clearInterval(el._scr); el.textContent = text; }
    }, 28);
  }
  function splitWords(root) {
    const out = [];
    const walk = (node) => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const s = document.createElement("span"); s.className = "w"; s.textContent = part;
            frag.appendChild(s); out.push(s);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) {
          if (n.matches(".manifesto__pill")) { n.classList.add("w"); out.push(n); }
          else walk(n);
        }
      });
    };
    walk(root);
    return out;
  }

  /* ------------------------------------------------------------------ nav: context line + menu */
  const nav = $(".nav");
  const ctx = $(".nav__ctx");
  const panel = $(".nav__panel");
  const toggle = $(".nav__toggle");
  let menuOpen = false;
  function openMenu() {
    if (!panel || menuOpen) return;
    menuOpen = true; nav.classList.add("is-open"); toggle.setAttribute("aria-expanded", "true");
    if (hasGSAP && !reduce) {
      gsap.set(panel, { visibility: "visible" });
      gsap.to(panel, { clipPath: "inset(0 0 0% 0 round 14px)", duration: .6, ease: "expo.out" });
      gsap.from($$(".nav__links li, .nav__foot", panel), { y: 18, opacity: 0, stagger: .04, duration: .5, ease: "expo.out", delay: .05 });
    } else { panel.style.visibility = "visible"; panel.style.clipPath = "none"; }
  }
  function closeMenu() {
    if (!panel || !menuOpen) return;
    menuOpen = false; nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false");
    if (hasGSAP && !reduce) gsap.to(panel, { clipPath: "inset(0 0 100% 0 round 14px)", duration: .45, ease: "expo.inOut", onComplete: () => gsap.set(panel, { visibility: "hidden" }) });
    else { panel.style.visibility = "hidden"; }
  }
  toggle && toggle.addEventListener("click", () => menuOpen ? closeMenu() : openMenu());
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  document.addEventListener("click", e => { if (menuOpen && !e.target.closest(".nav")) closeMenu(); });

  if (ctx && hasGSAP && window.ScrollTrigger) {
    $$("[data-ctx]").forEach(sec => {
      ScrollTrigger.create({
        trigger: sec, start: "top 55%", end: "bottom 55%",
        onToggle: s => { if (s.isActive) scramble(ctx, sec.dataset.ctx); }
      });
    });
  }

  /* ------------------------------------------------------------------ Sydney clock */
  const clocks = $$("[data-clock]");
  if (clocks.length) {
    const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const tick = () => { const t = fmt.format(new Date()); clocks.forEach(c => { c.textContent = c.dataset.clock === "short" ? t.slice(0, 5) : t.replace(/:/g, " : "); }); };
    tick(); setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------------ cursor + magnetic */
  if (fine && hasGSAP && !reduce) {
    const c = $(".cursor"), lab = $(".cursor__label");
    if (c) {
      const xTo = gsap.quickTo(c, "x", { duration: .18, ease: "power3" });
      const yTo = gsap.quickTo(c, "y", { duration: .18, ease: "power3" });
      const lxTo = lab && gsap.quickTo(lab, "left", { duration: .5, ease: "power3" });
      const lyTo = lab && gsap.quickTo(lab, "top", { duration: .5, ease: "power3" });
      window.addEventListener("pointermove", e => { xTo(e.clientX); yTo(e.clientY); if (lab) { lxTo(e.clientX); lyTo(e.clientY); } }, { passive: true });
      document.addEventListener("pointerover", e => {
        const t = e.target.closest("[data-cursor]");
        if (t) { lab.textContent = t.dataset.cursor; c.classList.add("has-label"); lab.parentElement.classList.add("has-label"); }
      });
      document.addEventListener("pointerout", e => {
        const t = e.target.closest("[data-cursor]");
        if (t && !t.contains(e.relatedTarget)) { c.classList.remove("has-label"); lab.parentElement.classList.remove("has-label"); }
      });
    }
    $$("[data-magnetic]").forEach(el => {
      const xTo = gsap.quickTo(el, "x", { duration: .6, ease: "elastic.out(1, .4)" });
      const yTo = gsap.quickTo(el, "y", { duration: .6, ease: "elastic.out(1, .4)" });
      el.addEventListener("pointermove", e => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * .3); yTo((e.clientY - r.top - r.height / 2) * .4);
      });
      el.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
    });
  }

  /* ------------------------------------------------------------------ fog hero (WebGL) */
  function fog(canvas) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: false, alpha: true });
    if (!gl) return null;
    const vs = `attribute vec2 p; varying vec2 v; void main(){ v = p*.5+.5; gl_Position = vec4(p,0.,1.); }`;
    const fs = `precision highp float;
      varying vec2 v; uniform float t; uniform vec2 r; uniform sampler2D m; uniform float fade;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
      void main(){
        vec2 uv = v; vec2 asp = vec2(r.x/r.y, 1.);
        vec2 q = uv*asp*2.2;
        vec2 w = vec2(fbm(q + t*.03), fbm(q + vec2(5.2,1.3) - t*.025));
        float d = fbm(q + 1.8*w + t*.02);
        float edge = fbm(uv*asp*9. + t*.1);
        float mask = texture2D(m, vec2(uv.x, 1.-uv.y) + (edge-.5)*.035).r;
        float dens = smoothstep(.08, .75, d*1.15 + .35);
        float a = clamp(dens * (1. - smoothstep(.05, .85, mask)) * (1.-fade), 0., 1.);
        vec3 milk = vec3(.945,.949,.929);
        vec3 shade = vec3(.80,.82,.83);
        vec3 col = mix(shade, milk, smoothstep(.2,.9,d));
        col += (h(uv*r + t) - .5) * .035; // grain
        gl_FragColor = vec4(col, a);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = { t: gl.getUniformLocation(prog, "t"), r: gl.getUniformLocation(prog, "r"), m: gl.getUniformLocation(prog, "m"), fade: gl.getUniformLocation(prog, "fade") };

    // the trail mask: a small 2D canvas we paint the pointer into
    const mask = document.createElement("canvas");
    const mctx = mask.getContext("2d");
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.m, 0);

    let W = 0, H = 0, S = .25;
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr * .6); canvas.height = Math.round(H * dpr * .6); // fog is soft: render under-res
      gl.viewport(0, 0, canvas.width, canvas.height);
      mask.width = Math.max(2, Math.round(W * S)); mask.height = Math.max(2, Math.round(H * S));
      mctx.fillStyle = "#000"; mctx.fillRect(0, 0, mask.width, mask.height);
    }
    resize();
    window.addEventListener("resize", resize);

    let last = null, pending = [], fade = 0, idle = 0, running = true;
    const rect = () => canvas.getBoundingClientRect();
    canvas.parentElement.addEventListener("pointermove", e => {
      const b = rect(); pending.push([(e.clientX - b.left) * S, (e.clientY - b.top) * S]); idle = 0;
    }, { passive: true });

    function stamp(x, y, rad) {
      const g = mctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = g; mctx.beginPath(); mctx.arc(x, y, rad, 0, Math.PI * 2); mctx.fill();
    }
    const t0 = performance.now();
    function frame(now) {
      if (!running) return;
      const t = (now - t0) / 1000;
      // fog slowly refills
      mctx.globalCompositeOperation = "source-over";
      mctx.fillStyle = "rgba(0,0,0,.018)"; mctx.fillRect(0, 0, mask.width, mask.height);
      mctx.globalCompositeOperation = "lighter";
      const rad = Math.max(mask.width, mask.height) * .085;
      // idle / touch: a slow lissajous wanders and clears for you
      idle += 1;
      if (idle > 90 || !fine) {
        const x = mask.width * (.5 + .36 * Math.sin(t * .35)), y = mask.height * (.45 + .3 * Math.sin(t * .53 + 1.2));
        pending.push([x, y]);
      }
      pending.forEach(p => {
        if (last) {
          const dx = p[0] - last[0], dy = p[1] - last[1], dist = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(dist / (rad * .25)));
          for (let i = 1; i <= steps; i++) stamp(last[0] + dx * i / steps, last[1] + dy * i / steps, rad);
        } else stamp(p[0], p[1], rad);
        last = p;
      });
      pending = [];
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
      gl.uniform1f(U.t, t); gl.uniform2f(U.r, canvas.width, canvas.height); gl.uniform1f(U.fade, fade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // pause when hero is off-screen
    new IntersectionObserver(([en]) => { const was = running; running = en.isIntersecting; if (running && !was) requestAnimationFrame(frame); }).observe(canvas);
    return { setFade(f) { fade = f; } };
  }

  const fogCanvas = $(".hero__fog");
  let fogApi = null;
  if (fogCanvas) {
    fogApi = reduce ? null : fog(fogCanvas);
    if (!fogApi) { const fb = document.createElement("div"); fb.className = "hero__fog-fallback"; fogCanvas.replaceWith(fb); }
    if (hasGSAP && window.ScrollTrigger) {
      ScrollTrigger.create({
        trigger: ".hero", start: "top top", end: "bottom top", scrub: true,
        onUpdate: s => { if (fogApi) fogApi.setFade(Math.min(1, s.progress * 1.6)); }
      });
      if (!reduce) gsap.to(".hero__under", { scale: 1.08, yPercent: 8, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
    }
  }

  /* ------------------------------------------------------------------ pixel resolve images */
  function coverRect(iw, ih, w, h) {
    const s = Math.max(w / iw, h / ih); const sw = w / s, sh = h / s;
    return [(iw - sw) / 2, (ih - sh) / 2, sw, sh];
  }
  function pixelate(img) {
    const host = img.parentElement;
    const run = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h || !img.naturalWidth) return;
      const cv = document.createElement("canvas"); const c = cv.getContext("2d");
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:1";
      host.appendChild(cv);
      img.style.visibility = "hidden";
      const small = document.createElement("canvas"); const sc = small.getContext("2d");
      const src = coverRect(img.naturalWidth, img.naturalHeight, w, h);
      const steps = [5, 9, 16, 28, 48, 84];
      let i = 0;
      const draw = () => {
        const cols = steps[i]; const rows = Math.max(1, Math.round(cols * h / w));
        small.width = cols; small.height = rows;
        sc.drawImage(img, src[0], src[1], src[2], src[3], 0, 0, cols, rows);
        c.imageSmoothingEnabled = false;
        c.clearRect(0, 0, cv.width, cv.height);
        c.drawImage(small, 0, 0, cols, rows, 0, 0, cv.width, cv.height);
        i++;
        if (i < steps.length) setTimeout(draw, 85);
        else setTimeout(() => { img.style.visibility = ""; cv.style.transition = "opacity .5s"; cv.style.opacity = "0"; setTimeout(() => cv.remove(), 520); }, 90);
      };
      draw();
    };
    if (img.complete && img.naturalWidth) run(); else img.addEventListener("load", run, { once: true });
  }
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) { io.unobserve(en.target); pixelate(en.target); }
    }), { rootMargin: "0px 0px -12% 0px" });
    $$("img[data-px]").forEach(img => io.observe(img));
  }

  /* ------------------------------------------------------------------ scroll choreography */
  if (hasGSAP && window.ScrollTrigger && !reduce) {
    // line reveals
    $$("[data-reveal]").forEach(el => {
      gsap.from($$(".line > span", el), { yPercent: 110, duration: 1.1, ease: "expo.out", stagger: .07, scrollTrigger: { trigger: el, start: "top 88%" } });
    });
    $$("[data-fade]").forEach(el => {
      gsap.from(el, { y: 24, opacity: 0, duration: 1, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 92%" } });
    });

    // manifesto words come into focus
    $$("[data-focus]").forEach(el => {
      const words = splitWords(el);
      gsap.fromTo(words, { opacity: .12, filter: "blur(10px)" }, {
        opacity: 1, filter: "blur(0px)", ease: "none", stagger: .05,
        scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: .6 }
      });
    });

    // services cards settle into a stack
    const cards = $$(".svc");
    cards.forEach((card, i) => {
      const nextCard = cards[i + 1];
      if (!nextCard) return;
      ScrollTrigger.matchMedia({
        "(min-width: 861px)": () => {
          const st = { trigger: nextCard, start: "top bottom", end: "top 20%", scrub: true };
          gsap.to(card, { scale: .94 - (cards.length - i) * .006, ease: "none", scrollTrigger: st });
          gsap.to(card.children, { opacity: .25, ease: "none", scrollTrigger: { ...st } });
        }
      });
    });

    // numbers ride sideways while pinned
    const track = $(".numbers__track");
    if (track) {
      ScrollTrigger.matchMedia({
        "(min-width: 861px)": () => {
          const dist = () => Math.max(0, track.scrollWidth - innerWidth);
          gsap.to(track, { x: () => -dist(), ease: "none",
            scrollTrigger: { trigger: ".numbers", start: "top top", end: () => "+=" + dist(), pin: true, scrub: .8, invalidateOnRefresh: true } });
        }
      });
    }

    // parallax media
    $$("[data-parallax]").forEach(el => {
      const amt = parseFloat(el.dataset.parallax) || 8;
      gsap.fromTo(el, { yPercent: -amt }, { yPercent: amt, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
    });
  }

  // counters (run even without GSAP so the numbers are right)
  $$("[data-count]").forEach(el => {
    const end = parseFloat(el.dataset.count); const pre = el.dataset.prefix || ""; const suf = el.dataset.suffix || "";
    const dec = (el.dataset.count.split(".")[1] || "").length;
    const write = v => { el.innerHTML = pre + v.toFixed(dec) + (suf ? `<small>${suf}</small>` : ""); };
    write(end);
    if (!hasGSAP || reduce || !window.ScrollTrigger) return;
    const o = { v: 0 };
    ScrollTrigger.create({ trigger: el, start: "top 85%", once: true, onEnter: () => gsap.fromTo(o, { v: 0 }, { v: end, duration: 1.8, ease: "expo.out", onUpdate: () => write(o.v) }) });
  });

  /* ------------------------------------------------------------------ marquee with scroll velocity */
  $$(".marquee").forEach(m => {
    const tr = $(".marquee__track", m); const g = $(".marquee__group", m);
    if (!tr || !g) return;
    tr.appendChild(g.cloneNode(true)).setAttribute("aria-hidden", "true");
    if (reduce) return;
    let x = 0, vel = 0, lastY = scrollY, dir = -1;
    const loop = () => {
      const dy = scrollY - lastY; lastY = scrollY;
      if (dy) dir = dy > 0 ? -1 : 1;
      vel += (Math.min(Math.abs(dy), 60) * .12 - vel) * .1;
      x += dir * (0.6 + vel);
      const w = g.offsetWidth;
      if (x <= -w) x += w; if (x > 0) x -= w;
      tr.style.transform = `translate3d(${x}px,0,0)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  /* ------------------------------------------------------------------ work rows: peek + filters + view */
  const peek = $(".peek");
  if (peek && fine && hasGSAP) {
    const img = $("img", peek);
    const xTo = gsap.quickTo(peek, "x", { duration: .6, ease: "power3" });
    const yTo = gsap.quickTo(peek, "y", { duration: .6, ease: "power3" });
    let on = false;
    window.addEventListener("pointermove", e => { xTo(e.clientX + 40); yTo(e.clientY); }, { passive: true });
    document.addEventListener("pointerover", e => {
      const a = e.target.closest("[data-peek]");
      if (!a) return;
      if (img.getAttribute("src") !== a.dataset.peek) img.src = a.dataset.peek;
      if (!on) { on = true; gsap.to(peek, { opacity: 1, scale: 1, rotate: -3, duration: .5, ease: "expo.out" }); }
    });
    document.addEventListener("pointerout", e => {
      const a = e.target.closest("[data-peek]");
      if (a && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-peek]"))) {
        on = false; gsap.to(peek, { opacity: 0, scale: .6, rotate: 0, duration: .4, ease: "expo.out" });
      }
    });
  }

  $$("[data-filters-for]").forEach(bar => {
    const scope = $(bar.dataset.filtersFor);
    bar.addEventListener("click", e => {
      const b = e.target.closest("button[data-filter]"); if (!b) return;
      $$("button", bar).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      const key = b.dataset.filter;
      const items = $$("[data-filters]", scope);
      items.forEach(it => it.classList.toggle("is-hidden", key !== "all" && !it.dataset.filters.split(" ").includes(key)));
      if (hasGSAP && !reduce) gsap.fromTo(items.filter(i => !i.classList.contains("is-hidden")), { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: .04, duration: .6, ease: "expo.out" });
      window.ScrollTrigger && ScrollTrigger.refresh();
    });
  });

  $$("[data-view]").forEach(btn => btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    $$("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
    $$("[data-view-panel]").forEach(p => { p.hidden = p.dataset.viewPanel !== v; });
    try { localStorage.setItem("milq-view", v); } catch (e) {}
    window.ScrollTrigger && ScrollTrigger.refresh();
  }));
  try { const v = localStorage.getItem("milq-view"); const b = v && $(`[data-view="${v}"]`); if (b) b.click(); } catch (e) {}

  /* ------------------------------------------------------------------ milk gauge */
  const gauge = $(".gauge");
  if (gauge) {
    const fill = $(".gauge__fill", gauge), ticks = $(".gauge__ticks", gauge);
    const secs = $$("[data-ml]");
    const place = () => {
      const H = doc.scrollHeight - innerHeight;
      ticks.innerHTML = secs.map(s => {
        const p = Math.min(1, Math.max(0, (s.getBoundingClientRect().top + scrollY) / Math.max(1, H)));
        return `<span class="gauge__tick" style="bottom:${(p * 100).toFixed(2)}%"></span>`;
      }).join("") + `<span class="gauge__now"></span>`;
      now = $(".gauge__now", ticks);
    };
    let now = null;
    const upd = () => {
      const H = doc.scrollHeight - innerHeight, p = H > 0 ? scrollY / H : 0;
      fill.style.transform = `scaleY(${p})`;
      if (!now) return;
      let cur = secs[0];
      secs.forEach(s => { if (s.getBoundingClientRect().top < innerHeight * .5) cur = s; });
      now.style.bottom = (p * 100).toFixed(2) + "%";
      if (cur && now.textContent !== cur.dataset.ml) now.textContent = cur.dataset.ml;
    };
    window.addEventListener("scroll", upd, { passive: true });
    window.addEventListener("resize", place);
    window.addEventListener("load", () => { place(); upd(); });
    place(); upd();
    if (window.ScrollTrigger) ScrollTrigger.addEventListener("refresh", place);
  }

  /* ------------------------------------------------------------------ footer word fills like a glass */
  const word = $(".footer__word");
  if (word) {
    const level = $("[data-level]", word);
    // clipPath may only hold shapes, so the wave path carries both the level and the drift
    let lv = 1, target = 1, wx = 0;
    const draw = () => { if (level) level.setAttribute("transform", `translate(${wx.toFixed(1)} ${(340 - lv * 372).toFixed(1)})`); };
    if (hasGSAP && window.ScrollTrigger && !reduce) {
      lv = target = 0;
      ScrollTrigger.create({ trigger: word, start: "top bottom", end: "bottom bottom", onUpdate: s => { target = s.progress; } });
      const loop = () => { lv += (target - lv) * .08; wx -= 1.2; if (wx <= -500) wx += 500; draw(); requestAnimationFrame(loop); };
      new IntersectionObserver(([en]) => { if (en.isIntersecting && !word._loop) { word._loop = 1; requestAnimationFrame(loop); } }).observe(word);
    }
    draw();
  }

  /* ------------------------------------------------------------------ case: scroll to next */
  const nextSec = $(".next-case");
  if (nextSec && hasGSAP && window.ScrollTrigger && !reduce) {
    const bar = $(".next-case__bar i", nextSec);
    const a = $("[data-case-next]", nextSec);
    let gone = false;
    ScrollTrigger.create({
      trigger: nextSec, start: "top top", end: "+=70%", pin: true, scrub: true,
      onUpdate: s => {
        bar.style.transform = `scaleX(${s.progress})`;
        if (s.progress > .995 && !gone) { gone = true; leave(a.getAttribute("href")); }
      }
    });
  }

  /* ------------------------------------------------------------------ contact: brief builder */
  const brief = $("#brief");
  if (brief) {
    const budgets = ["Under $25k", "$25k – $50k", "$50k – $100k", "$100k – $250k", "$250k +"];
    const range = $("#budget"), out = $("#budget-out"), milk = $(".carton__milk");
    const sum = { svc: $("#sum-svc"), budget: $("#sum-budget"), when: $("#sum-when"), level: $("#sum-level") };
    const update = () => {
      const svcs = $$("input[name=service]:checked", brief).map(i => i.value);
      const when = ($("input[name=timeline]:checked", brief) || {}).value || "Not sure yet";
      const b = parseInt(range.value, 10);
      out.textContent = budgets[b];
      sum.svc.textContent = svcs.length ? svcs.join(", ") : "Pick at least one";
      sum.budget.textContent = budgets[b];
      sum.when.textContent = when;
      const lvl = Math.min(100, 12 + svcs.length * 16 + b * 8 + (when === "ASAP" ? 8 : 0));
      milk.style.height = lvl + "%";
      sum.level.textContent = `${Math.round(lvl * 10)} ml`;
    };
    brief.addEventListener("input", update);
    update();
    brief.addEventListener("submit", e => {
      e.preventDefault();
      if (!brief.reportValidity()) return;
      const done = $("#brief-done");
      brief.hidden = true; done.hidden = false;
      $("#done-name").textContent = ($("#name").value || "there").split(" ")[0];
      if (lenis) lenis.scrollTo(done, { offset: -120 }); else done.scrollIntoView({ behavior: "smooth" });
    });
  }
  $$("[data-copy]").forEach(b => b.addEventListener("click", () => {
    const txt = b.dataset.copy;
    const done = () => { const o = b.textContent; b.textContent = "Copied"; setTimeout(() => { b.textContent = o; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, () => { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); s.removeAllRanges(); s.addRange(r); });
  }));

  /* ------------------------------------------------------------------ intro: loader then hero */
  function heroIntro() {
    if (!hasGSAP || reduce) return;
    const tl = gsap.timeline();
    tl.from(".hero__title .line > span, .page-hero .line > span, .case-hero .line > span", { yPercent: 110, duration: 1.3, ease: "expo.out", stagger: .08 })
      .from(".hero__sub, .hero__badges, .hero__bar, .hero__hint, .page-hero__aside, .page-hero__eyebrow", { opacity: 0, y: 20, duration: 1, ease: "expo.out", stagger: .06, clearProps: "transform,opacity" }, "-=1") // leftover transforms would break the hero's blend mode
      .from(".nav, .callpill", { opacity: 0, y: -20, duration: .9, ease: "expo.out", stagger: .08 }, "-=1.1");
  }
  const loader = $(".loader");
  const arrived = arrive();
  if (loader && !arrived && !reduce && hasGSAP && store.get("milq-loaded") !== "1") {
    store.set("milq-loaded", "1");
    lock(true);
    const n = $(".loader__count", loader), o = { v: 0 };
    gsap.timeline({ onComplete: () => { loader.remove(); lock(false); } })
      .to(o, { v: 100, duration: 1.8, ease: "power2.inOut", onUpdate: () => {
        n.textContent = String(Math.round(o.v)).padStart(3, "0") + " ml";
        $(".loader__fill", loader).style.clipPath = `inset(${100 - o.v}% 0 0 0)`;
      } })
      .to(loader, { yPercent: -100, duration: 1, ease: "expo.inOut" }, "+=.15")
      .add(heroIntro, "-=.55");
  } else {
    if (loader) loader.remove();
    heroIntro();
  }

  window.addEventListener("load", () => window.ScrollTrigger && ScrollTrigger.refresh());
})();
