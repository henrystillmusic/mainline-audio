/* Mainline Audio — shared snow canvas.
 *
 * Drives <canvas id="snow"></canvas>. Defaults reproduce the standard site
 * treatment; pages that want the softer, sparser variant declare it inline:
 *
 *   <canvas id="snow"
 *           data-count="120" data-opacity="0.4"
 *           data-radius="1.0,3.2" data-speed="1.0,3.0"></canvas>
 *
 * data-radius and data-speed are "min,max" ranges in the units the original
 * inline implementations used. thankyou.html is deliberately not a consumer —
 * it paints its own opaque confirmation-screen canvas (#canvas-layer) with a
 * different particle character and its own draw loop.
 */
(function () {
  if (window.__mainlineSnowLoaded) return;
  window.__mainlineSnowLoaded = true;

  const DEFAULTS = { count: 160, opacity: 0.45, radius: [1.0, 3.5], speed: [1.2, 3.4] };

  function range(value, fallback) {
    if (!value) return fallback;
    const parts = value.split(",").map(n => parseFloat(n.trim()));
    return parts.length === 2 && parts.every(n => !Number.isNaN(n)) ? parts : fallback;
  }

  function start() {
    const canvas = document.getElementById("snow");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const count   = parseInt(canvas.dataset.count, 10) || DEFAULTS.count;
    const opacity = parseFloat(canvas.dataset.opacity) || DEFAULTS.opacity;
    const [rMin, rMax] = range(canvas.dataset.radius, DEFAULTS.radius);
    const [dMin, dMax] = range(canvas.dataset.speed,  DEFAULTS.speed);

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener("resize", () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    });

    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: rMin + Math.random() * (rMax - rMin),
        d: dMin + Math.random() * (dMax - dMin)
      });
    }

    const fill = `rgba(230,255,255,${opacity})`;

    function snow() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = fill;
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2, false);
        ctx.fill();
        p.y += p.d;
        p.x += Math.sin((p.y + p.x) * 0.002) * 0.08;
        if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
      });
      requestAnimationFrame(snow);
    }
    snow();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
