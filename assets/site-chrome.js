/* Mainline Audio — shared site chrome (navigation + footer base).
 *
 * Pages opt in with two placeholders and one line of configuration:
 *
 *   <body data-page="dsp">                     current section, "" for none
 *   <body data-page="" data-nav="minimal">     legal pages: no Apparel/Instagram
 *
 *   <nav data-site-nav aria-label="Main navigation">
 *     <a class="nav-home" href="index.html">Mainline Audio</a>   <-- static fallback
 *   </nav>
 *
 *   <footer data-site-footer>
 *     ...page-family content stays here, statically...
 *   </footer>
 *
 * The home link stays in the markup rather than being generated. It is both the
 * no-JS fallback and the page's chosen treatment (text wordmark, or the logo
 * image used by the product and legal pages), so there is no second source of
 * truth for it. If this script never runs, every page still has a working link
 * home and a working Privacy Policy link — reduced navigation, not none.
 *
 * sync.html and thankyou.html deliberately do not participate.
 */
(function () {
  if (window.__mainlineChromeLoaded) return;
  window.__mainlineChromeLoaded = true;

  /* ── The site's navigation. Edit here and nowhere else. ── */
  var NAV_LINKS = [
    { key: "mastering", label: "Mastering", href: "mastering.html" },
    { key: "dsp",       label: "DSP",       href: "dsp.html" },
    { key: "music",     label: "Music",     href: "music.html" },
    { key: "apparel",   label: "Apparel",   href: "https://mainline-audio-shop.fourthwall.com/", external: true },
    { key: "instagram", label: "Instagram", href: "https://www.instagram.com/henrystill/",       external: true }
  ];

  /* Legal pages carry only the site sections, not the commerce/social links. */
  var MINIMAL_KEYS = ["mastering", "dsp", "music"];

  var PRIVACY_HREF = "privacy-policy.html";
  var COPYRIGHT_HOLDER = "Mainline Audio";

  function renderNav() {
    var nav = document.querySelector("[data-site-nav]");
    if (!nav) return;

    var current = document.body.getAttribute("data-page") || "";
    var minimal = document.body.getAttribute("data-nav") === "minimal";

    var ul = document.createElement("ul");
    ul.className = "nav-links";

    NAV_LINKS.forEach(function (link) {
      if (minimal && MINIMAL_KEYS.indexOf(link.key) === -1) return;
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = link.href;
      a.textContent = link.label;
      if (link.external) {
        a.target = "_blank";
        a.rel = "noopener";
      }
      if (link.key === current) {
        a.className = "current";
        a.setAttribute("aria-current", "page");
      }
      li.appendChild(a);
      ul.appendChild(li);
    });

    var existing = nav.querySelector(".nav-links");
    if (existing) nav.replaceChild(ul, existing);
    else nav.appendChild(ul);
  }

  function renderFooterBase() {
    var footer = document.querySelector("[data-site-footer]");
    if (!footer) return;

    /* Pages whose own footer content already links the privacy policy (legal and
       product pages) must not get a second copy. */
    if (!footer.querySelector('a[href="' + PRIVACY_HREF + '"]')) {
      var a = document.createElement("a");
      a.className = "footer-link";
      a.href = PRIVACY_HREF;
      a.textContent = "Privacy Policy";
      footer.appendChild(a);
    }

    var p = document.createElement("p");
    p.className = "footer-copy";
    p.textContent = "© " + new Date().getFullYear() + " " + COPYRIGHT_HOLDER;
    footer.appendChild(p);
  }

  function start() {
    renderNav();
    renderFooterBase();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
