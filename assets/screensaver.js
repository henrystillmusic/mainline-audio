/* Mainline Audio — site-wide screensaver mode.
 *
 * One self-contained script, included on every page. After a period of no
 * activity it fades the interface out and shows the coral reef visualizer
 * full-window, on top of the existing background player (#bg-track). It never
 * plays audio of its own.
 *
 *   idle delay     90 s while music is playing, 3 min otherwise (paused while
 *                  the tab is hidden)
 *   fade in        about 4 s; any movement during the fade cancels it
 *   manual button  starts it immediately and asks for true fullscreen
 *   touch devices  button-only; idle detection is not used
 *   exit           mouse move over a few px, key press, click or tap, ignored
 *                  for ~1 s after entering
 *   wake lock      requested while active; refusal is tolerated
 *   reduced motion still, dimmed frame instead of animation
 *
 * Audio: the reef reads #bg-track through a single MediaElementAudioSourceNode.
 * An element can only ever have one, so the node is shared on
 * window.__mainlineAudioGraph and reused if something else already made it.
 * The node is only created once the AudioContext is actually running; routing
 * an element through a suspended context would silence the site's music.
 */
(function () {
  if (window.__mainlineScreensaverLoaded) return;
  window.__mainlineScreensaverLoaded = true;

  var IDLE_PLAYING_MS = 90 * 1000;
  var IDLE_QUIET_MS   = 3 * 60 * 1000;
  var FADE_IN_MS      = 4000;
  var FADE_IN_MANUAL_MS = 1500;
  var FADE_OUT_MS     = 500;
  var GRACE_MS        = 1000;
  var MOVE_EXIT_PX    = 6;
  var FALLBACK_TITLE  = "Mainline Audio";

  var reducedMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var coarseQuery        = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;

  var root, canvas, ctx, titleEl, button;
  var state = "off";              // off | fading | active | leaving
  var lastActivity = Date.now();
  var enteredAt = 0, graceUntil = 0, fadeMs = FADE_IN_MS;
  var anchor = null;              // pointer position when the screensaver began
  var lastPointer = null;         // most recent pointer position seen while idle
  var entryMode = "idle";         // idle | manual
  var wakeLock = null, usedFullscreen = false;
  var raf = 0, titleTimer = 0, leaveTimer = 0, still = false;
  var stalks = [];
  var flakes = [];

  /* ───────────────────────── helpers ───────────────────────── */

  function audioEl() { return document.getElementById("bg-track"); }

  function isPlaying() {
    var a = audioEl();
    return !!a && !a.paused && !a.ended && !a.muted && a.volume > 0;
  }

  function currentTitle() {
    var np = document.getElementById("now-playing");
    var text = np ? np.textContent.trim() : "";
    if (isPlaying() && text) {
      text = text.replace(/^now playing\s*[—–-]?\s*/i, "").trim();
      if (text) return text;
    }
    return FALLBACK_TITLE;
  }

  function reducedMotion() { return !!(reducedMotionQuery && reducedMotionQuery.matches); }
  function touchPrimary()  { return !!(coarseQuery && coarseQuery.matches); }

  /* ───────────────────────── audio graph ───────────────────────── */

  var graph = window.__mainlineAudioGraph || (window.__mainlineAudioGraph = {});
  var freqData = null;

  function resumeContext() {
    if (graph.ctx && graph.ctx.state === "suspended") {
      try { var p = graph.ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
  }

  // Resolves to true when an analyser is ready. Never throws.
  function ensureAnalyser() {
    var a = audioEl();
    if (!a) return Promise.resolve(false);
    if (graph.analyser) { freqData = freqData || new Uint8Array(graph.analyser.frequencyBinCount); resumeContext(); return Promise.resolve(true); }

    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve(false);
      if (!graph.ctx) graph.ctx = new AC();
      var ctxA = graph.ctx;
      var running = ctxA.state === "running"
        ? Promise.resolve(true)
        : Promise.race([
            Promise.resolve(ctxA.resume()).then(function () { return ctxA.state === "running"; }),
            new Promise(function (res) { setTimeout(function () { res(false); }, 400); })
          ]).catch(function () { return false; });

      return running.then(function (ok) {
        if (!ok) return false;               // would silence the music; stay on idle motion
        if (graph.analyser) return true;
        try {
          if (!graph.source) graph.source = ctxA.createMediaElementSource(a);
          var an = ctxA.createAnalyser();
          an.fftSize = 2048;
          an.smoothingTimeConstant = 0.88;
          graph.source.connect(an);
          if (!graph.connectedToOutput) {     // the source must keep reaching the speakers
            graph.source.connect(ctxA.destination);
            graph.connectedToOutput = true;
          }
          graph.analyser = an;
          freqData = new Uint8Array(an.frequencyBinCount);
          return true;
        } catch (e) {
          // Another script already owns this element's source node and did not share it.
          return false;
        }
      });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* ───────────────────────── reef ───────────────────────── */

  var PALETTE = [
    [8, 35, 42], [340, 28, 45], [18, 30, 38], [185, 25, 35],
    [195, 22, 40], [270, 18, 38], [30, 25, 50], [0, 15, 52]
  ];
  var COUNT = 90;

  var BAND_LO = 40, BAND_HI = 12000, bandsFor = 0;

  // Give every stalk a log-spaced slice of the spectrum, low on the left and
  // high on the right, like an analyzer, so the whole width moves.
  function assignBands() {
    var n = freqData.length, rate = (graph.ctx && graph.ctx.sampleRate) || 44100;
    var hzPerBin = rate / 2 / n, order = [];
    for (var i = 0; i < stalks.length; i++) order.push(i);
    for (var b = 0; b < order.length; b++) {
      var f0 = BAND_LO * Math.pow(BAND_HI / BAND_LO, b / order.length);
      var f1 = BAND_LO * Math.pow(BAND_HI / BAND_LO, (b + 1) / order.length);
      var st = stalks[order[b]];
      st.lo = Math.min(n - 1, Math.floor(f0 / hzPerBin));
      st.hi = Math.min(n, Math.max(st.lo + 1, Math.ceil(f1 / hzPerBin)));
      st.peak = 0.25;
    }
    bandsFor = n;
  }

  // The overlay hides the page's own snow canvas, so it carries its own,
  // matching snow.js (same colour and sizes, a little brighter).
  function buildFlakes() {
    flakes = [];
    var W = window.innerWidth, H = window.innerHeight;
    for (var i = 0; i < 160; i++) {
      flakes.push({ x: Math.random() * W, y: Math.random() * H,
        r: 1.0 + Math.random() * 2.5, d: 1.2 + Math.random() * 2.2 });
    }
  }

  function drawSnow() {
    var W = canvas.width, H = canvas.height;
    ctx.fillStyle = "rgba(230,255,255,0.6)";
    for (var i = 0; i < flakes.length; i++) {
      var p = flakes[i];
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      if (still) continue;
      p.y += p.d;
      p.x += Math.sin((p.y + p.x) * 0.002) * 0.08;
      if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
    }
  }

  function buildStalks() {
    bandsFor = 0;
    stalks = [];
    for (var i = 0; i < COUNT; i++) {
      var p = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      var wc = Math.random();
      var baseW = wc < 0.6 ? 0.4 + Math.random() * 0.6 : 1.2 + Math.random() * 1.8;
      var hb = Math.random();
      var maxFrac = hb < 0.55 ? 0.10 + Math.random() * 0.18
                  : hb < 0.82 ? 0.22 + Math.random() * 0.20
                  :             0.40 + Math.random() * 0.22;
      stalks.push({
        phase: Math.random() * Math.PI * 2,
        freq: 0.1 + Math.random() * 0.35,
        amp: 0.15 + Math.random() * 0.55,
        swayF: 0.00018 + Math.random() * 0.00022,
        swayA: 2 + Math.random() * 8,
        h: p[0], s: p[1], l: p[2], baseW: baseW, maxFrac: maxFrac,
        branchStyle: Math.floor(Math.random() * 3),
        lean: (Math.random() - 0.5) * 0.18,
        current: 0.08 + Math.random() * 0.25,
        target: 0.08,
        fpos: i / (COUNT - 1)
      });
    }
  }

  function drawBranch(x, y, angle, len, depth, h, s, l, alpha) {
    if (depth === 0 || len < 3) return;
    var ex = x + Math.sin(angle) * len, ey = y - Math.cos(angle) * len;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
    ctx.strokeStyle = "hsla(" + h + "," + s + "%," + (l + depth * 5) + "%," + alpha + ")";
    ctx.lineWidth = Math.max(0.4, depth * 0.7);
    ctx.stroke();
    var spread = 0.3 + Math.random() * 0.25;
    drawBranch(ex, ey, angle - spread, len * 0.62, depth - 1, h, s, l, alpha * 0.85);
    drawBranch(ex, ey, angle + spread, len * 0.62, depth - 1, h, s, l, alpha * 0.85);
  }

  function drawReef(ts) {
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    var t = ts * 0.001, phase = ts * 0.00016, slotW = W / COUNT;

    var live = false;
    var a = audioEl();
    if (!still && graph.analyser && freqData && a && !a.paused) {
      graph.analyser.getByteFrequencyData(freqData);
      live = true;
    }

    for (var i = 0; i < stalks.length; i++) {
      var s = stalks[i];
      if (live) {
        if (bandsFor !== freqData.length) assignBands();
        var sum = 0;
        for (var bi = s.lo; bi < s.hi; bi++) sum += freqData[bi];
        var lvl = sum / (s.hi - s.lo) / 255;
        // Each band is judged against its own recent peak, so quiet high
        // bands swing as fully as the bass does.
        s.peak = Math.max(lvl, s.peak * 0.998, 0.12);
        var norm = Math.pow(lvl / s.peak, 1.6);
        s.target = Math.max(0.03, Math.min(0.6, norm * s.maxFrac * 1.2));
      } else {
        var v = Math.sin(t * s.freq + s.phase) * s.amp * 0.6 +
                Math.sin(t * s.freq * 1.8 + s.phase * 1.3) * s.amp * 0.25 +
                Math.sin(t * s.freq * 0.3 + s.phase * 0.7) * s.amp * 0.15;
        s.target = Math.max(0.03, ((v + 1) / 2) * s.maxFrac);
      }
      // Slow idle motion is deliberately gentler than the audio-driven attack.
      var speed = live ? (s.current < s.target ? 0.07 : 0.025) : 0.03;
      s.current += (s.target - s.current) * (still ? 1 : speed);

      var barH = Math.max(4, s.current * H * 0.85);
      var rootX = i * slotW + slotW / 2, tipY = H - barH;
      var sway = still ? 0 : Math.sin(phase + i * 0.12) * 6 + Math.sin(ts * s.swayF + s.phase) * s.swayA;
      var lean = s.lean * barH;
      var w2 = slotW * s.baseW * 0.5, rootW = w2, tipW = w2 * 0.18;
      var tipX = rootX + sway + lean, ctrlX = rootX + (sway + lean) * 0.4, ctrlY = H - barH * 0.55;

      var gr = ctx.createLinearGradient(rootX, H, tipX, tipY);
      gr.addColorStop(0,    "hsla(" + s.h + "," + s.s + "%," + (s.l - 15) + "%,0)");
      gr.addColorStop(0.08, "hsla(" + s.h + "," + s.s + "%," + (s.l - 10) + "%,0.3)");
      gr.addColorStop(0.5,  "hsla(" + s.h + "," + s.s + "%," + s.l + "%,0.65)");
      gr.addColorStop(1,    "hsla(" + s.h + "," + (s.s + 8) + "%," + (s.l + 12) + "%,0.78)");

      ctx.beginPath();
      ctx.moveTo(rootX - rootW, H);
      ctx.quadraticCurveTo(ctrlX - tipW * 1.5, ctrlY, tipX - tipW, tipY);
      ctx.lineTo(tipX + tipW, tipY);
      ctx.quadraticCurveTo(ctrlX + tipW * 1.5, ctrlY, rootX + rootW, H);
      ctx.closePath();
      ctx.fillStyle = gr;
      ctx.fill();

      if (s.branchStyle === 1 && barH > H * 0.08) {
        // Branches are randomised per draw in the original; seed-free but cheap.
        drawBranch(tipX, tipY + 2, 0, barH * 0.12, 2, s.h, s.s, s.l + 10, 0.55);
      } else if (s.branchStyle === 2) {
        var dots = 3 + Math.floor(s.current * 4);
        for (var d = 0; d < dots; d++) {
          var ang = (d / (dots - 1) - 0.5) * Math.PI * 0.7, dr = barH * 0.06;
          var dx = tipX + Math.sin(ang) * dr * 3, dy = tipY - Math.cos(ang) * dr * 2;
          var dotR = Math.max(0.6, w2 * 0.35 * (1 - Math.abs(d - dots / 2) / dots));
          ctx.beginPath(); ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
          ctx.fillStyle = "hsla(" + (s.h + 10) + "," + (s.s + 10) + "%," + (s.l + 18) + "%,0.7)";
          ctx.fill();
        }
      }
    }

    var floor = ctx.createLinearGradient(0, H - H * 0.1, 0, H);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, "rgba(4,7,12,.95)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, H - H * 0.1, W, H * 0.1);
    drawSnow();
  }

  /* ─────────────── second look: swaying garden (from the prototype) ─────────────── */

  var look = "spectrum";
  var LOOK_KEY = "ml-ss-look";

  // Alternate between the two looks each time the screensaver starts.
  function nextLook() {
    var prev = null;
    try { prev = localStorage.getItem(LOOK_KEY); } catch (e) {}
    var next = prev === "spectrum" ? "garden" : prev === "garden" ? "spectrum"
             : (Math.random() < 0.5 ? "spectrum" : "garden");
    try { localStorage.setItem(LOOK_KEY, next); } catch (e) {}
    return next;
  }

  function drawScene(ts) {
    if (look === "garden") drawGarden(ts); else drawReef(ts);
  }

  var garden = [], motes = [], gLvl = [0, 0, 0];

  function buildGarden() {
    var W = window.innerWidth, H = window.innerHeight;
    garden = [];
    var n = Math.max(9, Math.round(W / 70));
    for (var i = 0; i < n; i++) {
      garden.push({ x: (i + 0.5) / n * W + (Math.random() - 0.5) * 40, h: H * (0.18 + Math.random() * 0.3),
        seg: 7 + Math.floor(Math.random() * 4), ph: Math.random() * 6.28,
        col: Math.random() < 0.6 ? "233,138,116" : "127,214,200", w: 2 + Math.random() * 3 });
    }
    motes = [];
    for (var m = 0, mc = Math.round(W / 22); m < mc; m++) {
      motes.push({ x: Math.random() * W, y: Math.random() * H, r: 0.6 + Math.random() * 2, v: 0.15 + Math.random() * 0.5 });
    }
  }

  function gardenBands() {
    var a = audioEl();
    if (still || !graph.analyser || !freqData || !a || a.paused) return [0, 0, 0];
    graph.analyser.getByteFrequencyData(freqData);
    var hz = ((graph.ctx && graph.ctx.sampleRate) || 44100) / 2 / freqData.length;
    function avg(f0, f1) {
      var lo = Math.max(1, Math.floor(f0 / hz)), hi = Math.min(freqData.length, Math.max(lo + 1, Math.ceil(f1 / hz))), sum = 0;
      for (var i = lo; i < hi; i++) sum += freqData[i];
      return sum / (hi - lo) / 255;
    }
    return [avg(40, 250), avg(250, 2000), avg(2000, 8000)];
  }

  function drawGarden(ts) {
    var W = canvas.width, H = canvas.height, t = still ? 0 : ts * 0.00048;
    if (!garden.length) buildGarden();
    var b = gardenBands();
    for (var k = 0; k < 3; k++) gLvl[k] += (b[k] - gLvl[k]) * 0.08;

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#05080d"); g.addColorStop(0.6, "#081625"); g.addColorStop(1, "#0d2230");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // light shafts
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < 4; i++) {
      var x = W * (0.15 + i * 0.25) + Math.sin(t * 0.7 + i) * 60;
      var sh = ctx.createLinearGradient(x, 0, x + 120, H);
      sh.addColorStop(0, "rgba(127,214,200," + (0.05 + gLvl[2] * 0.12) + ")"); sh.addColorStop(1, "rgba(127,214,200,0)");
      ctx.fillStyle = sh; ctx.beginPath();
      ctx.moveTo(x - 30, 0); ctx.lineTo(x + 50, 0); ctx.lineTo(x + 260, H); ctx.lineTo(x + 40, H); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // coral, swaying with the low and mid bands
    ctx.lineCap = "round";
    for (var c = 0; c < garden.length; c++) {
      var s = garden[c], px = s.x, py = H, ang = -Math.PI / 2;
      var len = s.h / s.seg * (1 + gLvl[0] * 0.35);
      for (var j = 0; j < s.seg; j++) {
        ang += Math.sin(t * 1.3 + s.ph + j * 0.5) * (0.06 + gLvl[1] * 0.12);
        var nx = px + Math.cos(ang) * len, ny = py + Math.sin(ang) * len;
        ctx.strokeStyle = "rgba(" + s.col + "," + (0.35 + 0.5 * (j / s.seg) + gLvl[1] * 0.2) + ")";
        ctx.lineWidth = s.w * (1 - j / s.seg) + 0.6;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
        if (j > 2 && j % 2 === 0) {
          var ba = ang + (j % 4 ? 0.7 : -0.7) + Math.sin(t + j) * 0.1;
          ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + Math.cos(ba) * len * 0.6, ny + Math.sin(ba) * len * 0.6); ctx.stroke();
        }
        px = nx; py = ny;
      }
      ctx.fillStyle = "rgba(" + s.col + "," + (0.5 + gLvl[2] * 0.5) + ")";
      ctx.beginPath(); ctx.arc(px, py, 2 + gLvl[2] * 5, 0, Math.PI * 2); ctx.fill();
    }

    // rising bubbles
    ctx.fillStyle = "rgba(219,228,238,0.35)";
    for (var m = 0; m < motes.length; m++) {
      var mo = motes[m];
      if (!still) { mo.y -= mo.v * (1 + gLvl[0] * 2); if (mo.y < -4) { mo.y = H + 4; mo.x = Math.random() * W; } }
      ctx.beginPath(); ctx.arc(mo.x, mo.y, mo.r, 0, Math.PI * 2); ctx.fill();
    }

    drawSnow();
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (look === "garden") buildGarden();
    if (still) drawScene(12000);
  }

  function frame(ts) {
    raf = 0;
    if (state === "off") return;
    drawScene(ts);
    driftTitle(ts);
    raf = requestAnimationFrame(frame);
  }

  /* ───────────────────────── drifting title ───────────────────────── */

  var DRIFT_MS = 70000;

  function driftTitle(ts) {
    if (still) return;
    var w = titleEl.offsetWidth || 0;
    var span = window.innerWidth + w;
    var x = ((ts % DRIFT_MS) / DRIFT_MS) * span - w;
    var edge = Math.min(1, Math.min(x + w, window.innerWidth - x) / (window.innerWidth * 0.15));
    titleEl.style.transform = "translate3d(" + x.toFixed(1) + "px,0,0)";
    titleEl.style.opacity = String(Math.max(0, Math.min(1, edge)) * 0.8);
  }

  function refreshTitle() {
    var t = currentTitle();
    if (titleEl.textContent !== t) titleEl.textContent = t;
  }

  /* ───────────────────────── DOM ───────────────────────── */

  function injectStyles() {
    var css = document.createElement("style");
    css.textContent =
      "#ml-ss{position:fixed;inset:0;z-index:2147483000;opacity:0;pointer-events:none;overflow:hidden;" +
        "background:radial-gradient(120% 90% at 50% 100%,#0b1a22 0%,#05090e 60%,#020407 100%);" +
        "cursor:none;contain:strict}" +
      "#ml-ss.on{pointer-events:auto}" +
      "#ml-ss canvas{position:absolute;inset:0;width:100%;height:100%;display:block}" +
      "#ml-ss.still canvas{filter:brightness(.45) saturate(.8)}" +
      "#ml-ss-title{position:absolute;left:0;top:26%;white-space:nowrap;will-change:transform,opacity;" +
        "font-family:Satoshi,system-ui,-apple-system,sans-serif;font-weight:500;font-size:clamp(12px,1.3vw,20px);" +
        "letter-spacing:.32em;text-transform:uppercase;color:rgba(245,245,245,.8);opacity:0}" +
      "#ml-ss.still #ml-ss-title{left:50%;top:auto;bottom:14%;transform:translateX(-50%)!important;opacity:.55!important}" +
      "#ml-ss-btn{position:fixed;left:32px;bottom:32px;z-index:50;width:48px;height:48px;border-radius:50%;" +
        "display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;" +
        "background:rgba(255,255,255,.045);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);" +
        "border:1px solid rgba(255,255,255,.06);color:rgba(245,245,245,.38);" +
        "transition:background .2s,color .2s,border-color .2s}" +
      "#ml-ss-btn:hover,#ml-ss-btn:focus-visible{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.12);color:rgba(245,245,245,.72)}" +
      "@media(max-width:600px){#ml-ss-btn{left:16px;bottom:16px}}";
    document.head.appendChild(css);
  }

  function build() {
    injectStyles();

    root = document.createElement("div");
    root.id = "ml-ss";
    root.setAttribute("aria-hidden", "true");
    canvas = document.createElement("canvas");
    titleEl = document.createElement("div");
    titleEl.id = "ml-ss-title";
    root.appendChild(canvas);
    root.appendChild(titleEl);
    ctx = canvas.getContext("2d");
    document.body.appendChild(root);

    button = document.createElement("button");
    button.id = "ml-ss-btn";
    button.type = "button";
    button.title = "Screensaver";
    button.setAttribute("aria-label", "Start screensaver");
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    button.addEventListener("click", function (e) { e.stopPropagation(); enter("manual"); });
    document.body.appendChild(button);
  }

  /* ───────────────────────── wake lock & fullscreen ───────────────────────── */

  function requestWakeLock() {
    if (!("wakeLock" in navigator) || wakeLock) return;
    try {
      navigator.wakeLock.request("screen").then(function (lock) {
        if (state === "off") { lock.release().catch(function () {}); return; }
        wakeLock = lock;
        lock.addEventListener("release", function () { if (wakeLock === lock) wakeLock = null; });
      }).catch(function () { /* refused (battery saver, permissions policy…) — carry on */ });
    } catch (e) {}
  }

  function releaseWakeLock() {
    var lock = wakeLock; wakeLock = null;
    if (lock) { try { lock.release().catch(function () {}); } catch (e) {} }
  }

  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

  function requestFullscreen() {
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) return;
    try {
      var p = req.call(root);
      usedFullscreen = true;
      if (p && p.catch) p.catch(function () { usedFullscreen = false; });   // refused: stay windowed
    } catch (e) { usedFullscreen = false; }
  }

  function leaveFullscreen() {
    if (!fullscreenElement()) { usedFullscreen = false; return; }
    var ex = document.exitFullscreen || document.webkitExitFullscreen;
    try { var p = ex && ex.call(document); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    usedFullscreen = false;
  }

  /* ───────────────────────── enter / exit ───────────────────────── */

  function enter(mode) {
    if (state !== "off") return;
    entryMode = mode;
    still = reducedMotion();
    state = "fading";
    enteredAt = Date.now();
    graceUntil = enteredAt + GRACE_MS;
    anchor = lastPointer;

    // The fade is a straight opacity transition; reduced-motion visitors get a shorter one.
    fadeMs = still ? 800 : (mode === "manual" ? FADE_IN_MANUAL_MS : FADE_IN_MS);

    look = nextLook();
    garden = [];
    buildStalks();
    buildFlakes();
    resizeCanvas();
    refreshTitle();
    root.classList.toggle("still", still);
    if (still) drawScene(12000);

    root.classList.add("on");
    root.style.transition = "none";
    root.style.opacity = "0";
    void root.offsetWidth;
    root.style.transition = "opacity " + fadeMs + "ms ease-in-out";
    root.style.opacity = "1";
    button.style.visibility = "hidden";

    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(function () {
      if (state === "fading") {
        state = "active";
        graceUntil = Date.now() + GRACE_MS;
      }
    }, fadeMs);

    if (mode === "manual") requestFullscreen();
    requestWakeLock();
    if (!still) {
      ensureAnalyser();
      raf = requestAnimationFrame(frame);
    }
    titleTimer = window.setInterval(refreshTitle, 500);
  }

  function leave() {
    if (state === "off" || state === "leaving") return;
    var wasFading = state === "fading";
    state = "leaving";
    window.clearTimeout(leaveTimer);
    window.clearInterval(titleTimer);
    leaveFullscreen();
    releaseWakeLock();

    root.style.transition = "opacity " + FADE_OUT_MS + "ms ease-out";
    root.style.opacity = "0";
    // The overlay stays in place until the fade finishes so the click or tap that
    // dismissed it cannot land on a link underneath.
    leaveTimer = window.setTimeout(function () {
      state = "off";
      root.classList.remove("on");
      button.style.visibility = "";
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      lastActivity = Date.now();
    }, FADE_OUT_MS + (wasFading ? 0 : 150));
  }

  /* ───────────────────────── input ───────────────────────── */

  function markActive() { lastActivity = Date.now(); }

  function onMove(e) {
    if (e.pointerType === "touch") return;
    var x = e.clientX, y = e.clientY;
    if (state === "off" || state === "leaving") { lastPointer = { x: x, y: y }; if (state === "off") markActive(); return; }
    if (!anchor) { anchor = { x: x, y: y }; return; }
    var dist = Math.hypot(x - anchor.x, y - anchor.y);
    // Manual starts ignore pointer noise (fullscreen reflow) for the first second.
    if (Date.now() < graceUntil && (state === "active" || entryMode === "manual")) { anchor = { x: x, y: y }; return; }
    if (state === "fading") { if (dist >= 1) leave(); return; }   // any movement cancels the fade
    if (dist >= MOVE_EXIT_PX) leave();
  }

  function onDismissInput(e) {
    if (state === "off") { markActive(); resumeContext(); return; }
    if (state === "leaving") { e.preventDefault(); e.stopPropagation(); return; }
    e.stopPropagation();
    if (e.type !== "keydown" && e.cancelable) e.preventDefault();   // keep browser shortcuts (reload, Esc) working
    if (Date.now() < graceUntil && (state === "active" || entryMode === "manual")) return;
    leave();   // an idle-started fade has no grace period: any input cancels it
  }

  /* ───────────────────────── idle timer ───────────────────────── */

  function idleTick() {
    if (state !== "off" || document.hidden) return;
    if (touchPrimary()) return;                       // button-only on touch devices
    var limit = isPlaying() ? IDLE_PLAYING_MS : IDLE_QUIET_MS;
    if (Date.now() - lastActivity >= limit) enter("idle");
  }

  function onVisibility() {
    if (document.hidden) return;
    // The timer is paused while hidden: start counting again from now.
    lastActivity = Date.now();
    if (state !== "off" && state !== "leaving") requestWakeLock();   // locks are dropped when the tab is hidden
  }

  /* ───────────────────────── init ───────────────────────── */

  function init() {
    build();

    ["mousedown", "keydown", "wheel", "touchstart", "pointerdown", "scroll"].forEach(function (n) {
      window.addEventListener(n, markActive, { passive: true, capture: true });
    });
    window.addEventListener("pointermove", onMove, { passive: true, capture: true });
    window.addEventListener("mousemove", function (e) { if (!window.PointerEvent) onMove(e); }, { passive: true, capture: true });

    // Dismiss on key, click or tap. Capture phase so the page never sees the dismissing input.
    ["keydown", "click", "pointerdown", "mousedown", "touchstart"].forEach(function (n) {
      window.addEventListener(n, onDismissInput, { capture: true, passive: false });
    });

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", resizeCanvas);
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (n) {
      document.addEventListener(n, function () {
        // The visitor left fullscreen (Esc, browser UI): treat that as leaving the screensaver.
        if (usedFullscreen && !fullscreenElement() && (state === "fading" || state === "active")) leave();
      });
    });
    window.addEventListener("pagehide", releaseWakeLock);

    window.setInterval(idleTick, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
