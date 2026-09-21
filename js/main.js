// The CSS `@view-transition { navigation: auto; }` rule (styles.css) lets
// the browser animate cross-document navigations natively. When a
// transition gets superseded/skipped — e.g. a script-driven or otherwise
// non-standard navigation — the browser rejects its internal promise with
// an AbortError that nothing in this codebase awaits, surfacing as a
// noisy but harmless "Uncaught (in promise)" console error. Swallow only
// that specific case so real unhandled rejections still show up.
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.name === 'AbortError' && /[Tt]ransition/.test(event.reason.message || '')) {
    event.preventDefault();
  }
});

// A service page's "Volver a soluciones" link lands here as
// index.html?solutions=<badge>, where scrollToSolutions() (below) scrolls
// down to that card. The native cross-document view transition above
// reveals this page at its initial scrollY (0) before that scroll runs,
// so the transition itself shows a jump to the top instead of the
// intended smooth scroll to the card. Skip the incoming transition for
// this specific arrival so the JS-driven scroll plays cleanly instead.
window.addEventListener('pagereveal', (event) => {
  if (event.viewTransition && new URLSearchParams(window.location.search).has('solutions')) {
    event.viewTransition.skipTransition();
  }
});

// Supabase project storing leads captured from the #registro form (see
// the "leads" table). The publishable key is safe to ship in frontend
// code: row-level security on that table only allows inserts, nothing
// can be read, edited, or deleted with it.
const SUPABASE_URL = 'https://qdzrpgnryzsolstfimty.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2R1lplZjaiqtIk4SejUeqA_gpk2nKlX';

// Bump these whenever terminos-y-condiciones.html / politicas-de-privacidad.html
// change in a way that matters legally — every lead records which version
// was live when the visitor accepted it. Keep in sync with the
// "legal-updated" line on each of those pages.
const TC_VERSION = '1.0 (2026-09-21)';
const PRIVACY_VERSION = '1.0 (2026-09-21)';

// Best-effort client-side IP + approximate geolocation for the leads log
// (this site has no backend of its own to read the request's real IP
// from, so it asks a third-party service instead — the IP is therefore
// self-reported by the browser, not server-verified). Kicked off once on
// load so it's already resolved (or failed) by the time someone actually
// submits, instead of adding latency to the submit itself.
function fetchGeoIp(timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch('https://ipapi.co/json/', { signal: controller.signal })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || data.error) return null;
      return {
        ip: data.ip || null,
        city: data.city || null,
        region: data.region || null,
        country: data.country_name || null,
        postal: data.postal || null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      };
    })
    .catch(() => null) // network failure, blocked request, timeout, etc. — fail open
    .finally(() => clearTimeout(timeout));
}
const geoIpPromise = fetchGeoIp();

async function saveLeadToSupabase(lead) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(lead),
    });
    if (!res.ok) {
      console.error('No se pudo guardar el lead en Supabase:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Error de red guardando el lead en Supabase:', err);
  }
}

let toastHideTimer = null;
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  if (!toast || !toastMessage) return;
  toastMessage.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => toast.classList.remove('is-visible'), duration);
}

function initKineticText() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Internal service pages (huella-digital.html, etc.) only keep the
  // word-reveal effect in the hero — everywhere else in the template
  // (section headings, body copy, CTAs, the "¿Cómo funciona?" grid...)
  // renders as plain static text instead.
  const isServicePage = !!document.querySelector('.service-hero');
  const selector = isServicePage
    ? ['.service-hero-content h1', '.service-hero-content p', '.service-hero-content .btn'].join(', ')
    : ['main h1', 'main h2', 'main h3', 'main p', 'main li', 'main .btn', '.faq-question span'].join(', ');

  const targets = Array.from(document.querySelectorAll(selector)).filter((el) => {
    if (el.closest('.kinetic-text')) return false; // avoid double-wrapping nested matches
    if (el.closest('.solution-card')) return false; // these get their own entrance animation instead
    if (el.closest('.dolor-item')) return false; // these get their own entrance animation instead
    if (el.closest('.pf-summary-checklist')) return false; // list items hold an icon span, not just text
    const hasText = el.textContent && el.textContent.trim().length > 0;
    const onlyHoldsElements = el.children.length > 0 && el.textContent.trim() === '';
    return hasText && !onlyHoldsElements;
  });

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    return; // leave text static and fully visible
  }

  targets.forEach((el) => {
    // Walk the element's actual child nodes instead of flattening to
    // plain textContent, so an inline <strong> (used to bold key phrases
    // in service page copy) survives the word-span rebuild instead of
    // being silently dropped.
    const sourceNodes = Array.from(el.childNodes);
    el.textContent = '';
    el.classList.add('kinetic-text');

    let i = 0;
    const addWord = (word, parent) => {
      const span = document.createElement('span');
      span.className = 'kinetic-word';
      span.style.setProperty('--i', Math.min(i, 24));
      span.textContent = word;
      parent.appendChild(span);
      i += 1;
    };

    sourceNodes.forEach((node) => {
      // A <br> (e.g. the hero title's responsive forced line break) has no
      // text content, so the word-splitting below would silently drop it —
      // carry it over as-is instead of feeding it through addWord.
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
        el.appendChild(node.cloneNode(false)); // keep its class (e.g. hero-title-break)
        return;
      }
      const isInlineElement = node.nodeType === Node.ELEMENT_NODE;
      const words = (node.textContent || '').split(/\s+/).filter(Boolean);
      if (!words.length) return;

      if (el.lastChild) el.appendChild(document.createTextNode(' '));
      const target = isInlineElement ? document.createElement(node.tagName) : el;
      words.forEach((word, wi) => {
        if (wi > 0) target.appendChild(document.createTextNode(' '));
        addWord(word, target);
      });
      if (isInlineElement) el.appendChild(target);
    });
  });

  // Reveal only while the user is scrolling down. Scrolling up never
  // triggers or undoes the animation — text just stays put.
  let lastScrollY = window.scrollY;
  let scrollDirection = 'down';
  let ticking = false;

  const pending = new Set();

  const revealPending = () => {
    if (scrollDirection !== 'down') return;
    pending.forEach((el) => {
      el.classList.add('in-view');
      observer.unobserve(el);
      pending.delete(el);
    });
  };

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      scrollDirection = currentY > lastScrollY ? 'down' : currentY < lastScrollY ? 'up' : scrollDirection;
      lastScrollY = currentY;
      revealPending();
      ticking = false;
    });
  }, { passive: true });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        pending.add(entry.target);
      } else {
        // Left the viewport before it was revealed — wait for it to come
        // back into view under a downward scroll instead of revealing later.
        pending.delete(entry.target);
      }
    });
    revealPending();
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

  targets.forEach((el) => observer.observe(el));
}

function initPartnerMarquee() {
  const track = document.querySelector('.partner-logos-track');
  const firstSet = document.querySelector('.partner-logos-set');
  if (!track || !firstSet) return;

  // Measure the real rendered width of one set (gaps/padding included) and
  // feed it back as the exact translation distance. Percentage-based -50%
  // depends on the browser rounding every gap identically on both copies;
  // any 1px mismatch shows up as a visible jump/restart at the loop point.
  // Measuring avoids that entirely — the loop always ends exactly where it
  // started.
  function measure() {
    const width = firstSet.getBoundingClientRect().width;
    if (width > 0) {
      track.style.setProperty('--marquee-shift', `-${width}px`);
    }
  }

  measure();
  window.addEventListener('resize', measure);

  firstSet.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', measure, { once: true });
  });
}

function initScrollParallaxScale() {
  const els = Array.from(document.querySelectorAll('[data-parallax-scale]'));
  if (!els.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let ticking = false;

  function update() {
    const vh = window.innerHeight;

    els.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const total = vh + rect.height;
      const traveled = vh - rect.top; // 0 when entering from the bottom, `total` when fully exited past the top
      const progress = Math.max(0, Math.min(1, traveled / total));

      const minScale = parseFloat(el.dataset.parallaxMinScale || '0.72');
      const maxScale = parseFloat(el.dataset.parallaxMaxScale || '1.22');
      const range = parseFloat(el.dataset.parallaxRange || '70'); // px of vertical drift

      const scale = minScale + progress * (maxScale - minScale);
      const translateY = (0.5 - progress) * range;

      el.style.transform = `translateY(${translateY.toFixed(2)}px) scale(${scale.toFixed(3)})`;

      // Subtle depth-of-field: sharp when the box has scaled up close to
      // the viewer, gently soft when it's still small/far away.
      const filterParts = [];
      const depthBlur = (1 - progress) * 1.2;
      if (depthBlur > 0.05) filterParts.push(`blur(${depthBlur.toFixed(2)}px)`);

      // Photo-lighting logic: a shadow barely reads while the object sits at
      // rest, then fades in and softens/spreads as it "lifts" and grows —
      // like a subject rising closer to the light, casting a bigger, more
      // diffuse (but still subtle) contact shadow the larger it gets.
      if (el.hasAttribute('data-parallax-shadow')) {
        const shadowOpacity = 0.22 * progress;
        const shadowBlur = 10 + progress * 50;
        const shadowOffsetY = 6 + progress * 34;
        filterParts.push(
          `drop-shadow(0 ${shadowOffsetY.toFixed(1)}px ${shadowBlur.toFixed(1)}px rgba(0, 0, 0, ${shadowOpacity.toFixed(3)}))`
        );
      }
      el.style.filter = filterParts.join(' ');
    });

    ticking = false;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

// The brand-section reaction emojis (.brand-emoji) already own `transform`
// via a CSS entrance transition + an infinite float animation — writing
// scale there directly (like initScrollParallaxScale above) would fight
// both. Instead this drives a --emoji-scale custom property that those
// CSS rules fold into their own transform via scale(var(...)).
function initEmojiParallax() {
  const els = Array.from(document.querySelectorAll('.brand-emoji'));
  if (!els.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let ticking = false;

  function update() {
    const vh = window.innerHeight;

    els.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const total = vh + rect.height;
      const traveled = vh - rect.top;
      let progress = Math.max(0, Math.min(1, traveled / total));

      // The left emoji (--a) runs the opposite direction of the rest —
      // starts big and shrinks as you scroll past it, instead of growing.
      if (el.classList.contains('brand-emoji--a')) progress = 1 - progress;

      const minScale = 0.65;
      const maxScale = 1.75;
      const scale = minScale + progress * (maxScale - minScale);
      el.style.setProperty('--emoji-scale', scale.toFixed(3));

      // Depth-of-field: sharp at its biggest, gently soft at its
      // smallest — same progress driving the scale, so it always reads
      // as "small = far/blurred, big = close/in focus". `progress` only
      // reaches 1 once the emoji has scrolled fully past the viewport
      // (invisible), so blur is ramped against a lower ceiling (0.7)
      // instead — it hits exactly 0 while still comfortably on screen,
      // not just in the unreachable literal maximum.
      const blur = Math.max(0, 1 - progress / 0.7);
      el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
    });

    ticking = false;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

function initSolutionsGallery() {
  const scroller = document.getElementById('solutions-scroll');
  if (!scroller) return;

  // Belt-and-suspenders: card images finishing their load can nudge this
  // row's scrollLeft away from 0 (scroll anchoring), leaving the first card
  // partly scrolled off. Snap it back to the true start once everything
  // has settled.
  const resetToStart = () => { scroller.scrollLeft = 0; };
  resetToStart();
  window.addEventListener('load', resetToStart);
  scroller.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', resetToStart, { once: true });
  });

  // Click-and-drag horizontal scroll for mouse users (touch/trackpad already
  // scroll this natively via swipe/two-finger gestures).
  let isDown = false;
  let dragged = false;
  let startX = 0;
  let startScroll = 0;
  let momentumRAF = null;
  let scrollAnim = null;

  // Velocity sample from the last couple of pointer moves, used to fling
  // the row on release instead of having it stop dead like a static drag.
  let lastMoveX = 0;
  let lastMoveTime = 0;
  let velocity = 0;

  function stopMomentum() {
    if (momentumRAF) cancelAnimationFrame(momentumRAF);
    momentumRAF = null;
  }

  function runMomentum() {
    const max = maxScroll();
    // Friction per frame: fast enough to feel intentional, not floaty.
    velocity *= 0.94;
    if (Math.abs(velocity) < 0.4) { momentumRAF = null; return; }

    let next = scroller.scrollLeft + velocity;
    if (next < 0) { next = 0; velocity = 0; }
    if (next > max) { next = max; velocity = 0; }
    scroller.scrollLeft = next;
    momentumRAF = requestAnimationFrame(runMomentum);
  }

  scroller.addEventListener('mousedown', (e) => {
    stopMomentum();
    if (scrollAnim) { cancelAnimationFrame(scrollAnim); scrollAnim = null; }
    isDown = true;
    dragged = false;
    startX = e.pageX;
    startScroll = scroller.scrollLeft;
    lastMoveX = e.pageX;
    lastMoveTime = performance.now();
    velocity = 0;
    scroller.classList.add('is-dragging');
  });
  window.addEventListener('mouseup', () => {
    if (!isDown) return;
    isDown = false;
    scroller.classList.remove('is-dragging');
    if (Math.abs(velocity) > 0.4) {
      momentumRAF = requestAnimationFrame(runMomentum);
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const delta = e.pageX - startX;
    if (Math.abs(delta) > 3) dragged = true;
    scroller.scrollLeft = startScroll - delta;

    const now = performance.now();
    const dt = now - lastMoveTime;
    if (dt > 0) {
      // Pixels per frame (~16ms), so it composes directly with runMomentum.
      velocity = ((e.pageX - lastMoveX) / dt) * -16;
      lastMoveX = e.pageX;
      lastMoveTime = now;
    }
  });
  // A drag that moved the row shouldn't also fire the link/button it started
  // on top of.
  scroller.addEventListener('click', (e) => {
    if (dragged) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // The whole card is clickable, not just its CTA link: a click anywhere
  // on a card (that isn't the info-tooltip toggle or the link itself,
  // which already handle their own click) activates that card's link.
  scroller.addEventListener('click', (e) => {
    if (dragged) return;
    if (e.target.closest('.solution-card-info')) return;
    if (e.target.closest('.solution-card-link')) return;
    const card = e.target.closest('.solution-card');
    const link = card?.querySelector('.solution-card-link');
    if (link) link.click();
  });

  // Dot navigation + the "active card" focus effect: whichever card sits
  // closest to the gallery's own center gets lifted (see the .is-active
  // styles in styles.css); everything below just figures out which one
  // that is as the row scrolls, and keeps the matching dot lit.
  const cards = Array.from(scroller.querySelectorAll('.solution-card'));
  const dotsWrap = document.getElementById('solutions-dots');
  const dots = cards.map((_, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'solutions-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Ir a la solución ${i + 1}`);
    dotsWrap?.appendChild(dot);
    return dot;
  });

  function maxScroll() {
    return scroller.scrollWidth - scroller.clientWidth - 1;
  }

  function updateNav() {
    if (!cards.length) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const center = scrollerRect.left + scrollerRect.width / 2;
    let closestIndex = 0;
    let closestDistance = Infinity;
    cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      const distance = Math.abs((rect.left + rect.width / 2) - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    });
    cards.forEach((card, i) => card.classList.toggle('is-active', i === closestIndex));
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i === closestIndex));
  }

  const easeOutCubic = (t) => 1 - (1 - t) ** 3;

  function animateScrollTo(target, duration = 450) {
    stopMomentum();
    if (scrollAnim) cancelAnimationFrame(scrollAnim);
    const start = scroller.scrollLeft;
    const change = Math.max(0, Math.min(maxScroll(), target)) - start;
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      scroller.scrollLeft = start + change * easeOutCubic(t);
      scrollAnim = t < 1 ? requestAnimationFrame(frame) : null;
    }
    scrollAnim = requestAnimationFrame(frame);
  }

  // Each dot centers its matching card in the gallery.
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      const card = cards[i];
      if (!card) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const delta = (cardRect.left + cardRect.width / 2) - (scrollerRect.left + scrollerRect.width / 2);
      animateScrollTo(scroller.scrollLeft + delta);
    });
  });

  scroller.addEventListener('scroll', updateNav, { passive: true });
  window.addEventListener('resize', updateNav);
  updateNav();
}

function initSolutionCardsReveal() {
  const scroller = document.getElementById('solutions-scroll');
  if (!scroller) return;
  const cards = Array.from(scroller.querySelectorAll('.solution-card'));
  cards.forEach((card, i) => card.style.setProperty('--card-i', Math.min(i, 8)));

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    scroller.classList.add('in-view');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      scroller.classList.add('in-view');
      observer.disconnect();
    });
  }, { threshold: 0.15 });
  observer.observe(scroller);
}

function initSolutionCardTooltips() {
  const buttons = Array.from(document.querySelectorAll('.solution-card-info'));
  if (!buttons.length) return;

  function closeAll(except) {
    buttons.forEach((btn) => {
      if (btn === except) return;
      btn.setAttribute('aria-expanded', 'false');
      btn.parentElement.querySelector('.solution-card-note')?.classList.remove('is-open');
    });
  }

  buttons.forEach((btn) => {
    const note = btn.parentElement.querySelector('.solution-card-note');
    if (!note) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = note.classList.contains('is-open');
      closeAll(btn);
      note.classList.toggle('is-open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  document.addEventListener('click', () => closeAll(null));
}

function initBrandImageReveal() {
  const wrap = document.querySelector('.brand-image');
  if (!wrap) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    wrap.classList.add('in-view');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      wrap.classList.add('in-view');
      observer.disconnect();
    });
  }, { threshold: 0.2 });
  observer.observe(wrap);
}

// Every internal service page's body has one secondary image/video
// (.service-image-wrap) — wipes into view the first time it scrolls
// into frame, same one-shot pattern as initBrandImageReveal above.
function initServiceImageReveal() {
  const wrap = document.querySelector('.service-image-wrap');
  if (!wrap) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    wrap.classList.add('in-view');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      wrap.classList.add('in-view');
      observer.disconnect();
    });
  }, { threshold: 0.2 });
  observer.observe(wrap);
}

// The step-0 avatar's speech-bubble tooltip stays hidden until the
// registro section scrolls into view, then reveals itself after a beat —
// arriving alongside the section reads as an afterthought instead of a
// deliberate "hi there" the moment the form appears.
function initAvatarTooltipReveal() {
  const tooltip = document.querySelector('.pf-step-avatar-tooltip');
  const section = document.getElementById('registro');
  if (!tooltip || !section) return;

  const reveal = () => tooltip.classList.add('in-view');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    reveal();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      setTimeout(reveal, 1000);
      observer.disconnect();
    });
  }, { threshold: 0.3 });
  observer.observe(section);
}

function initCarrierLogosReveal() {
  const section = document.querySelector('.carriers-section');
  if (!section) return;

  const logos = section.querySelectorAll('.carrier-logos img');
  logos.forEach((img, i) => img.style.setProperty('--logo-i', i));

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    section.classList.add('in-view');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      section.classList.add('in-view');
      observer.disconnect();
    });
  }, { threshold: 0.2 });
  observer.observe(section);
}

function initWhatsappFloatReveal() {
  const btn = document.querySelector('.whatsapp-float');
  if (!btn) return;

  const isMobile = () => window.matchMedia('(max-width: 899px)').matches;
  let revealed = false; // desktop: one-shot, never hides again

  function resetAboveInstantly() {
    // Snap back to the "hidden above" position with no transition so the
    // next reveal always slides in from above, even after it was hidden.
    btn.classList.add('no-transition');
    btn.classList.remove('is-hidden-below');
    void btn.offsetHeight; // force reflow before re-enabling transitions
    btn.classList.remove('no-transition');
  }

  function check() {
    const revealThreshold = window.innerHeight * 0.25;
    const past = window.scrollY > revealThreshold;

    if (!isMobile()) {
      if (revealed || !past) return;
      revealed = true;
      btn.classList.add('is-visible');
      return;
    }

    // Mobile: toggles as the user scrolls past/back before the hero,
    // entering from above and exiting downward each time.
    if (past && !btn.classList.contains('is-visible')) {
      resetAboveInstantly();
      requestAnimationFrame(() => btn.classList.add('is-visible'));
    } else if (!past && btn.classList.contains('is-visible')) {
      btn.classList.remove('is-visible');
      btn.classList.add('is-hidden-below');
    }
  }

  window.addEventListener('scroll', check, { passive: true });
  check();
}

function initFloatLogoContrast() {
  const bar = document.querySelector('.whatsapp-float');
  const darkSections = Array.from(document.querySelectorAll('[data-bg="dark"]'));
  const darkImages = Array.from(document.querySelectorAll('.solution-card-image, .brand-image img'));
  // Light surfaces that float inside an otherwise-dark section (the white
  // plan-finder card inside #registro) — real rect overlap wins over the
  // section-level flag, since the section itself is only dark around them.
  const lightOverrides = Array.from(document.querySelectorAll('.plan-finder-grid'));
  if (!bar || (!darkSections.length && !darkImages.length)) return;

  let ticking = false;

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function update() {
    const barRect = bar.getBoundingClientRect();
    const probeY = barRect.top + barRect.height / 2;

    const onDarkSection = darkSections.some((el) => {
      const r = el.getBoundingClientRect();
      return probeY >= r.top && probeY <= r.bottom;
    });
    // Photos (card images, the brand photo) read as "dark" too, wherever
    // they happen to be scrolled to — checked as real rect overlap since
    // the solutions gallery scrolls these horizontally on its own.
    const onDarkImage = darkImages.some((el) => rectsOverlap(barRect, el.getBoundingClientRect()));
    const onLightOverride = lightOverrides.some((el) => rectsOverlap(barRect, el.getBoundingClientRect()));

    bar.classList.toggle('on-dark', (onDarkSection || onDarkImage) && !onLightOverride);
    ticking = false;
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  const solutionsScroll = document.getElementById('solutions-scroll');
  if (solutionsScroll) solutionsScroll.addEventListener('scroll', requestUpdate, { passive: true });
  update();
}

function initLogoScrollTop() {
  const logo = document.querySelector('.logo');
  if (!logo) return;
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;

  logo.addEventListener('click', (e) => {
    // Only intercept for an in-page scroll-to-top when the link actually
    // points at this same document. On internal service pages the logo's
    // href navigates back to the landing home instead, and must not be
    // hijacked into a same-page scroll.
    if (logo.pathname !== window.location.pathname) return;

    e.preventDefault();
    const startY = window.scrollY;
    if (startY === 0) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    const duration = 450;
    const startTime = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      window.scrollTo({ top: startY * (1 - easeOutCubic(t)), behavior: 'instant' });
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

function initScrollNextLinks() {
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;

  document.querySelectorAll('[data-scroll-next]').forEach((link) => {
    link.addEventListener('click', (e) => {
      // Re-check at click time, not just at attach time: a link's
      // href/data-scroll-next can be swapped later (e.g. the header CTA
      // becomes a plain external link after a successful signup).
      if (!link.hasAttribute('data-scroll-next')) return;
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();

      const startY = window.scrollY;
      const rect = target.getBoundingClientRect();
      const header = document.querySelector('.site-header');
      const headerOffset = header && getComputedStyle(header).position === 'fixed'
        ? header.getBoundingClientRect().height
        : 0;
      const targetY = startY + rect.top - headerOffset - 16;
      const change = targetY - startY;
      const duration = 450;
      const startTime = performance.now();

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.scrollTo({ top: targetY, behavior: 'instant' });
        return;
      }

      function frame(now) {
        const t = Math.min(1, (now - startTime) / duration);
        window.scrollTo({ top: startY + change * easeOutCubic(t), behavior: 'instant' });
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  });
}

// Full gallery order + which of those get the "Recomendado para ti" pill,
// per volume tier — from "Recomendaciones por cantidad de ordenes.docx".
// `order` covers all 11 cards (the whole gallery gets reordered, not just
// the recommended ones); `pills` is the leading subset of `order` that
// earns the badge. "Dropi Academy" in that doc is this site's "Mentorías"
// card (its own H1 reads "Dropi Academy"). Module scope so both the
// DOMContentLoaded gallery logic and initServiceRecommendedPill below
// (used on internal pages) share one source of truth.
const TIER_RECOMMENDATIONS = {
  '0 - 50': {
    order: ['Mentorías', 'Pago contra entrega', 'Huella Digital', 'Wallet', 'Asistentes IA', 'Gestión de entregas', 'Atención VIP', 'Notificaciones', 'Fulfillment', 'Métricas y reportes', 'API Pública'],
    pills: ['Mentorías', 'Pago contra entrega', 'Huella Digital', 'Wallet'],
  },
  '51 - 300': {
    order: ['Pago contra entrega', 'Huella Digital', 'Wallet', 'Mentorías', 'Notificaciones', 'Gestión de entregas', 'Asistentes IA', 'Atención VIP', 'Fulfillment', 'Métricas y reportes', 'API Pública'],
    pills: ['Pago contra entrega', 'Huella Digital', 'Wallet', 'Mentorías'],
  },
  '301 - 500': {
    order: ['Pago contra entrega', 'Huella Digital', 'Wallet', 'Asistentes IA', 'Notificaciones', 'Fulfillment', 'Gestión de entregas', 'Atención VIP', 'Métricas y reportes', 'Mentorías', 'API Pública'],
    pills: ['Pago contra entrega', 'Huella Digital', 'Wallet', 'Asistentes IA', 'Notificaciones'],
  },
  '501 - 1.000': {
    order: ['Huella Digital', 'Wallet', 'Asistentes IA', 'Notificaciones', 'Fulfillment', 'Atención VIP', 'Métricas y reportes', 'Gestión de entregas', 'API Pública', 'Pago contra entrega', 'Mentorías'],
    pills: ['Huella Digital', 'Wallet', 'Asistentes IA', 'Notificaciones', 'Fulfillment'],
  },
  '+1.000': {
    order: ['Atención VIP', 'Fulfillment', 'Métricas y reportes', 'Huella Digital', 'Wallet', 'Asistentes IA', 'Notificaciones', 'API Pública', 'Gestión de entregas', 'Pago contra entrega', 'Mentorías'],
    pills: ['Fulfillment', 'Métricas y reportes', 'Huella Digital', 'Wallet', 'Asistentes IA'],
  },
};
const DEFAULT_TIER = '0 - 50';

function initServiceRecommendedPill() {
  const content = document.querySelector('.service-hero-content[data-solution-badge]');
  const pill = document.getElementById('service-recommended-pill');
  if (!content || !pill) return;

  let registered = false;
  let tier = '';
  try {
    registered = sessionStorage.getItem('dropiRegistered') === '1';
    tier = sessionStorage.getItem('dropiTier') || '';
  } catch (err) {
    return; // sessionStorage unavailable — leave the pill hidden
  }
  const config = TIER_RECOMMENDATIONS[tier];
  if (registered && config && config.pills.includes(content.dataset.solutionBadge)) pill.hidden = false;
}

function initHideOwnSolutionCard() {
  // A service detail page carries its own copy of the solutions gallery
  // (cross-sell fold) — showing a card that links back to the very page
  // you're already on is redundant, so hide it there too.
  const content = document.querySelector('.service-hero-content[data-solution-badge]');
  const scroller = document.getElementById('solutions-scroll');
  if (!content || !scroller) return;
  const badge = content.dataset.solutionBadge;
  const card = Array.from(scroller.querySelectorAll('.solution-card')).find(
    (c) => c.querySelector('.solution-card-badge')?.textContent === badge
  );
  if (card) card.hidden = true;
}

function initServiceHeroVideo() {
  // Only present on the Dropi Academy page (mentorias.html) — every other
  // service page keeps its plain background-image hero, so this quietly
  // no-ops everywhere else.
  const video = document.getElementById('service-hero-video');
  const soundToggle = document.getElementById('service-hero-sound-toggle');
  if (!video) return;

  if (soundToggle) {
    soundToggle.addEventListener('click', () => {
      const wasMuted = video.muted;
      video.muted = !wasMuted;
      if (wasMuted) video.volume = 1;
      soundToggle.setAttribute('aria-pressed', String(wasMuted));
      soundToggle.setAttribute('aria-label', wasMuted ? 'Silenciar' : 'Activar sonido');
    });
  }
}

function initServiceScrollHint() {
  const hint = document.getElementById('service-scroll-hint');
  const hero = document.querySelector('.service-hero');
  if (!hint || !hero) return;

  hint.addEventListener('click', () => {
    const next = hero.nextElementSibling;
    if (!next) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    next.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
  });
}

function initServiceShare() {
  const whatsappBtn = document.getElementById('service-share-whatsapp');
  const copyBtn = document.getElementById('service-share-copy');
  if (!whatsappBtn && !copyBtn) return;

  const shareUrl = window.location.href;
  const shareText = document.title.split('|')[0].trim() + '\n' + shareUrl;

  if (whatsappBtn) {
    whatsappBtn.href = 'https://wa.me/?text=' + encodeURIComponent(shareText);
  }

  if (copyBtn) {
    const label = copyBtn.querySelector('.service-share-btn-text');
    const defaultLabel = label ? label.textContent : '';
    let resetTimer = null;

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch (err) {
        // Clipboard API unavailable/denied — fall back to a manual select
        // via a temporary input so the user can still copy with Cmd/Ctrl+C.
        const temp = document.createElement('input');
        temp.value = shareUrl;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        try { document.execCommand('copy'); } catch (err2) { /* give up silently */ }
        document.body.removeChild(temp);
      }

      copyBtn.classList.add('is-copied');
      if (label) label.textContent = '¡Copiado!';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        copyBtn.classList.remove('is-copied');
        if (label) label.textContent = defaultLabel;
      }, 2000);
    });
  }
}

function initServiceHeroHeaderContrast() {
  const header = document.getElementById('site-header');
  const hero = document.querySelector('.service-hero');
  if (!header || !hero) return;

  let ticking = false;
  function update() {
    // The header floats over the hero media as long as any part of the
    // hero is still below the viewport top — switch to dark glass then,
    // and back to the default light glass once it's over plain background.
    const overMedia = hero.getBoundingClientRect().bottom > 0;
    header.classList.toggle('is-over-media', overMedia);
    ticking = false;
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

document.addEventListener('DOMContentLoaded', () => {
  initKineticText();
  initPartnerMarquee();
  initSolutionsGallery();
  initSolutionCardsReveal();
  initSolutionCardTooltips();
  initBrandImageReveal();
  initServiceImageReveal();
  initAvatarTooltipReveal();
  initCarrierLogosReveal();
  initScrollParallaxScale();
  initEmojiParallax();
  initWhatsappFloatReveal();
  initFloatLogoContrast();
  initLogoScrollTop();
  initScrollNextLinks();
  initServiceHeroHeaderContrast();
  initServiceRecommendedPill();
  initHideOwnSolutionCard();
  initServiceShare();
  initServiceScrollHint();
  initServiceHeroVideo();

  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach((item) => {
    const question = item.querySelector('.faq-question');
    const icon = item.querySelector('.faq-icon');

    question.addEventListener('click', () => {
      const isOpen = item.classList.toggle('is-open');
      icon.src = isOpen
        ? 'assets/icons/icon-minus-circle.svg'
        : 'assets/icons/icon-plus-circle.svg';
    });
  });

  const volumeChips = Array.from(document.querySelectorAll('.pf-chip'));
  const volumeInput = document.getElementById('volume-input');
  const selectVolumeChip = (chip) => {
    volumeChips.forEach((c) => c.classList.toggle('is-selected', c === chip));
    const tier = chip.dataset.tier;
    if (volumeInput) volumeInput.value = tier;
  };
  volumeChips.forEach((chip) => chip.addEventListener('click', () => selectVolumeChip(chip)));

  const planFinder = document.querySelector('.plan-finder');
  let updateStepStates = () => {};
  // Shared with the emailForm submit handler further down (both blocks
  // live in this same outer scope) — set by the checkbox change
  // listeners below, read when a submission actually goes through.
  let tcAcceptedAt = null;
  let privacyAcceptedAt = null;
  let updateConsentState = () => {};
  if (planFinder) {
    const stepEls = Array.from(planFinder.querySelectorAll('.pf-step'));
    const step2Heading = planFinder.querySelector('.pf-step[data-step="2"] h3');
    const nombreInput = planFinder.querySelector('input[name="nombre"]');
    const emailFieldInput = planFinder.querySelector('input[name="email"]');
    const telefonoInput = planFinder.querySelector('input[name="telefono"]');
    const termsTcInput = document.getElementById('terms-tc-input');
    const termsPrivacyInput = document.getElementById('terms-privacy-input');
    const registerSubmitBtn = document.getElementById('register-submit-btn');
    const registerSubmitWrap = document.getElementById('register-submit-wrap');
    const registerSubmitHit = document.getElementById('register-submit-hit');
    const registerSubmitTooltip = document.getElementById('register-submit-tooltip');
    // tcAcceptedAt/privacyAcceptedAt are declared in the outer scope
    // above (shared with the emailForm submit handler) — timestamped
    // independently per checkbox and cleared if unchecked, so a
    // submission can only ever carry the acceptance time of its current
    // checked state.
    updateConsentState = () => {
      if (registerSubmitBtn) {
        registerSubmitBtn.disabled = !(termsTcInput?.checked && termsPrivacyInput?.checked);
      }
      if (registerSubmitWrap) {
        registerSubmitWrap.classList.toggle('is-disabled', !!registerSubmitBtn?.disabled);
      }
    };
    if (termsTcInput) {
      termsTcInput.addEventListener('change', () => {
        tcAcceptedAt = termsTcInput.checked ? new Date().toISOString() : null;
        updateConsentState();
      });
    }
    if (termsPrivacyInput) {
      termsPrivacyInput.addEventListener('change', () => {
        privacyAcceptedAt = termsPrivacyInput.checked ? new Date().toISOString() : null;
        updateConsentState();
      });
    }
    updateConsentState();

    // Tooltip on the (wrapper around the) disabled submit button — hover
    // on desktop, tap on touch devices. Listeners live on the wrapper/hit
    // overlay rather than the button itself because a native disabled
    // <button> fires no mouse or touch events at all (not even ones that
    // would bubble), which is also why register-submit-hit exists: a
    // plain, non-disabled sibling that only intercepts taps while the
    // real button is disabled (see .is-disabled in styles.css).
    const SUBMIT_TOOLTIP_OPENERS = [
      'Casi, casi...',
      'Un empujoncito más:',
      'Ese botón se hace de rogar:',
      'Falta poquito, lo prometo:',
    ];
    function getMissingFields() {
      const missing = [];
      if (!(emailFieldInput && emailFieldInput.checkValidity())) {
        missing.push({ text: 'Tu correo electrónico', target: emailFieldInput?.closest('.register-field') });
      }
      if (!(telefonoInput && telefonoInput.value.trim())) {
        missing.push({ text: 'Tu número de teléfono', target: telefonoInput?.closest('.register-field') });
      }
      if (!(termsTcInput && termsTcInput.checked)) {
        missing.push({ text: 'Aceptar los Términos y Condiciones', target: termsTcInput?.closest('.register-checkbox') });
      }
      if (!(termsPrivacyInput && termsPrivacyInput.checked)) {
        missing.push({ text: 'Autorizar el tratamiento de tus datos', target: termsPrivacyInput?.closest('.register-checkbox') });
      }
      return missing;
    }
    if (registerSubmitWrap && registerSubmitTooltip && registerSubmitBtn) {
      let highlightedTargets = [];
      const clearHighlights = () => {
        highlightedTargets.forEach((el) => el.classList.remove('is-tooltip-target'));
        highlightedTargets = [];
      };
      const showSubmitTooltip = () => {
        if (!registerSubmitBtn.disabled) return;
        const missing = getMissingFields();
        if (!missing.length) return;
        const opener = SUBMIT_TOOLTIP_OPENERS[Math.floor(Math.random() * SUBMIT_TOOLTIP_OPENERS.length)];
        const items = missing.map((f) => `<li>${f.text}</li>`).join('');
        registerSubmitTooltip.innerHTML = `<span class="register-submit-tooltip-intro">${opener}</span><ul class="register-submit-tooltip-list">${items}</ul>`;
        clearHighlights();
        highlightedTargets = missing.map((f) => f.target).filter(Boolean);
        highlightedTargets.forEach((el) => el.classList.add('is-tooltip-target'));
        registerSubmitWrap.classList.add('is-tooltip-visible');
      };
      const hideSubmitTooltip = () => {
        registerSubmitWrap.classList.remove('is-tooltip-visible');
        clearHighlights();
      };
      const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (supportsHover) {
        registerSubmitWrap.addEventListener('mouseenter', showSubmitTooltip);
        registerSubmitWrap.addEventListener('mouseleave', hideSubmitTooltip);
      } else if (registerSubmitHit) {
        registerSubmitHit.addEventListener('click', (e) => {
          e.preventDefault();
          if (registerSubmitWrap.classList.contains('is-tooltip-visible')) {
            hideSubmitTooltip();
          } else {
            showSubmitTooltip();
          }
        });
        document.addEventListener('click', (e) => {
          if (!registerSubmitWrap.classList.contains('is-tooltip-visible')) return;
          if (registerSubmitWrap.contains(e.target)) return;
          hideSubmitTooltip();
        });
      }
      registerSubmitWrap.addEventListener('focusin', showSubmitTooltip);
      registerSubmitWrap.addEventListener('focusout', hideSubmitTooltip);
    }

    const introTitle = document.getElementById('pf-step0-title');
    const introNameInput = document.getElementById('intro-name-input');
    const introContinueBtn = document.getElementById('intro-name-continue');
    const step1Title = document.getElementById('pf-step1-title');
    const step1TitleDefault = step1Title ? step1Title.textContent : '';
    let introDone = false;

    const isStepComplete = (stepNum) => {
      if (stepNum === '0') return introDone;
      if (stepNum === '1') return volumeChips.some((c) => c.classList.contains('is-selected'));
      if (stepNum === '2') {
        return !!(nombreInput && nombreInput.value.trim()
          && emailFieldInput && emailFieldInput.checkValidity()
          && telefonoInput && telefonoInput.value.trim());
      }
      return false;
    };

    // Step 1 (volume) and step 2 (contact) stay collapsed (.is-locked, see
    // styles.css) until the step before each is completed for the first
    // time. Once unlocked, a step stays unlocked even if its answer
    // changes later — re-locking on every keystroke would collapse the
    // fields out from under someone mid-typing.
    let maxUnlocked = 0;

    if (introNameInput && introContinueBtn && introTitle) {
      const introField = introNameInput.closest('.register-field');
      const introTooltip = introField ? introField.querySelector('.register-field-tooltip') : null;
      const showIntroError = (message) => {
        if (!introField || !introTooltip) return;
        introField.classList.add('has-error');
        introTooltip.textContent = message;
        introTooltip.hidden = false;
      };
      const clearIntroError = () => {
        if (!introField || !introTooltip) return;
        introField.classList.remove('has-error');
        introTooltip.hidden = true;
      };
      // Same medium-weight treatment as the email/telefono fields once
      // there's valid-looking text — just the type style, no checkmark
      // icon (it would compete with the Continuar button for space here).
      const updateIntroFilledStyle = () => {
        const value = introNameInput.value.trim();
        introNameInput.classList.toggle('is-filled', Boolean(value) && !/\d/.test(value));
      };
      introNameInput.addEventListener('input', () => {
        clearIntroError();
        updateIntroFilledStyle();
      });
      introContinueBtn.addEventListener('click', () => {
        const value = introNameInput.value.trim();
        if (!value) { showIntroError('Ingresa tu nombre.'); return; }
        if (/\d/.test(value)) { showIntroError('El nombre no debe contener números.'); return; }
        clearIntroError();
        if (nombreInput && !nombreInput.value.trim()) nombreInput.value = value;
        const firstName = value.split(/\s+/)[0];
        if (step1Title) {
          step1Title.textContent = `Una consulta ${firstName}, ${step1TitleDefault}`;
        }
        introDone = true;
        updateStepStates();

        if (step1Title) {
          const header = document.querySelector('.site-header');
          const headerOffset = header && getComputedStyle(header).position === 'fixed'
            ? header.getBoundingClientRect().height
            : 0;
          const rect = step1Title.getBoundingClientRect();
          const targetY = window.scrollY + rect.top - headerOffset - 96;
          window.scrollTo({
            top: targetY,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          });
        }
      });
    }

    updateStepStates = () => {
      stepEls.forEach((step) => {
        const n = Number(step.dataset.step);
        const complete = isStepComplete(step.dataset.step);
        step.classList.toggle('is-complete', complete);
        if (complete && n === maxUnlocked) maxUnlocked = n + 1;
      });
      stepEls.forEach((step) => {
        if (Number(step.dataset.step) <= maxUnlocked) step.classList.remove('is-locked');
      });
    };

    [nombreInput, emailFieldInput, telefonoInput].forEach((el) => {
      if (el) el.addEventListener('input', updateStepStates);
    });
    if (termsTcInput) termsTcInput.addEventListener('change', updateStepStates);
    if (termsPrivacyInput) termsPrivacyInput.addEventListener('change', updateStepStates);

    // The first time a volume is picked, step 2 unlocks below the fold on
    // most screens — smoothly scroll to the start of its heading once the
    // reveal has had time to expand, so it doesn't go unnoticed.
    let hasAutoScrolledToStep2 = false;
    volumeChips.forEach((chip) => chip.addEventListener('click', () => {
      updateStepStates();
      if (hasAutoScrolledToStep2 || !step2Heading) return;
      hasAutoScrolledToStep2 = true;
      setTimeout(() => {
        const header = document.querySelector('.site-header');
        const headerOffset = header && getComputedStyle(header).position === 'fixed'
          ? header.getBoundingClientRect().height
          : 0;
        const rect = step2Heading.getBoundingClientRect();
        const targetY = window.scrollY + rect.top - headerOffset - 16;
        window.scrollTo({
          top: targetY,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }, 520);
    }));

    updateStepStates();
  }

  const confirmModal = document.getElementById('confirm-modal');
  const confirmModalTitleGreeting = document.getElementById('confirm-modal-title-greeting');
  let lastFocusedBeforeModal = null;

  function openConfirmModal() {
    if (!confirmModal) return;
    if (confirmModalTitleGreeting) {
      const nombreValue = emailForm ? emailForm.querySelector('input[name="nombre"]').value.trim() : '';
      const firstName = nombreValue ? nombreValue.split(/\s+/)[0] : '';
      confirmModalTitleGreeting.textContent = firstName ? `¡Listo! ${firstName}` : '¡Listo!';
    }
    lastFocusedBeforeModal = document.activeElement;
    confirmModal.classList.add('is-open');
    document.body.classList.add('modal-open');
    const closeBtn = confirmModal.querySelector('.confirm-modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeConfirmModal() {
    if (!confirmModal) return;
    confirmModal.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus();
  }

  // Scrolls the page to the solutions gallery, then (if a badge is given)
  // scrolls the horizontal gallery itself to the matching card. Used by
  // both the recommended-service rows and the modal's main CTA.
  function scrollToSolutions(badge) {
    const section = document.getElementById('servicios');
    if (!section) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      section.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' });
      if (!badge) return;
      const card = Array.from(section.querySelectorAll('.solution-card')).find(
        (c) => !c.hidden && c.querySelector('.solution-card-badge')?.textContent === badge
      );
      if (card) {
        setTimeout(() => {
          card.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', inline: 'center', block: 'nearest' });
        }, 400);
      }
    }, 250);
  }

  if (confirmModal) {
    confirmModal.querySelectorAll('[data-modal-close]').forEach((el) => {
      el.addEventListener('click', closeConfirmModal);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && confirmModal.classList.contains('is-open')) closeConfirmModal();
    });

    // The main CTA closes the modal and takes the user to the solutions
    // gallery too, without targeting one specific card.
    const confirmModalCta = document.getElementById('confirm-modal-cta');
    if (confirmModalCta) {
      confirmModalCta.addEventListener('click', () => scrollToSolutions());
    }

    // The download attribute triggers the file save silently (no page
    // navigation), so a toast is the only feedback the user gets that
    // anything happened.
    const confirmModalBrochure = document.getElementById('confirm-modal-brochure');
    if (confirmModalBrochure) {
      confirmModalBrochure.addEventListener('click', () => {
        showToast('Descargando el brochure de soluciones…');
      });
    }
  }

  // Wraps the pill's text into per-word spans and replays the kinetic
  // reveal every 5s, looping for as long as the card stays on the page —
  // set up once per pill (guarded via dataset) even if called again.
  function startPillKinetic(pill) {
    if (pill.dataset.kineticInit) return;
    pill.dataset.kineticInit = 'true';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const words = pill.textContent.trim().split(/\s+/);
    pill.innerHTML = words.map((w, i) => `<span class="kinetic-word" style="--i: ${i};">${w}</span>`).join(' ');
    pill.classList.add('kinetic-text');

    function play() {
      pill.classList.remove('kinetic-playing');
      void pill.offsetWidth; // reflow so the next class add re-triggers the keyframe animation
      pill.classList.add('kinetic-playing');
    }
    play();
    setInterval(play, 3000);
  }

  function revealRecommendedSolutions(tierOverride) {
    const scroller = document.getElementById('solutions-scroll');
    if (!scroller) return;
    const cards = Array.from(scroller.querySelectorAll('.solution-card'));
    const tier = tierOverride || (volumeInput ? volumeInput.value : '');
    const config = TIER_RECOMMENDATIONS[tier] || TIER_RECOMMENDATIONS[DEFAULT_TIER];

    cards.forEach((card) => {
      const badge = card.querySelector('.solution-card-badge')?.textContent;
      if (!config.pills.includes(badge)) return;
      const pill = card.querySelector('.solution-card-recommended');
      if (!pill) return;
      pill.hidden = false;
      requestAnimationFrame(() => pill.classList.add('is-visible'));
      startPillKinetic(pill);
    });

    // Reorder the whole gallery to match `config.order`, not just the
    // pilled cards — the doc specifies a full ranking per tier.
    const spacer = scroller.querySelector('.solutions-scroll-spacer');
    let insertAfter = spacer;
    config.order.forEach((badge) => {
      const card = cards.find((c) => c.querySelector('.solution-card-badge')?.textContent === badge);
      if (!card) return;
      insertAfter.insertAdjacentElement('afterend', card);
      insertAfter = card;
    });
    scroller.scrollLeft = 0;
  }

  const headerCta = document.getElementById('header-cta');
  const mobileFloatCta = document.querySelector('.mobile-float-cta');
  const registroSection = document.getElementById('registro');
  let hasRegistered = false;

  // Once the visitor has registered, these "Hablar con un asesor" CTAs
  // (header + mobile floating pill) keep their original look and href, but
  // clicking either re-opens the confirmation modal instead of scrolling
  // to the (now hidden) form. Capture phase so this runs before
  // initScrollNextLinks' bubble-phase listener on the same buttons.
  [headerCta, mobileFloatCta].forEach((cta) => {
    if (!cta) return;
    cta.addEventListener('click', (e) => {
      if (!hasRegistered) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openConfirmModal();
    }, true);
  });

  const emailForm = document.getElementById('email-form');
  if (emailForm) {
    const nombreInput = emailForm.querySelector('input[name="nombre"]');
    const emailInput = emailForm.querySelector('input[type="email"]');
    const telefonoInput = emailForm.querySelector('input[name="telefono"]');

    function fieldTooltip(input) {
      const wrap = input.closest('.register-field');
      return { wrap, tooltip: wrap ? wrap.querySelector('.register-field-tooltip') : null };
    }
    function showFieldError(input, message) {
      const { wrap, tooltip } = fieldTooltip(input);
      if (!wrap || !tooltip) return;
      wrap.classList.add('has-error');
      tooltip.textContent = message;
      tooltip.hidden = false;
    }
    function clearFieldError(input) {
      const { wrap, tooltip } = fieldTooltip(input);
      if (!wrap || !tooltip) return;
      wrap.classList.remove('has-error');
      tooltip.hidden = true;
    }
    function setFieldValid(input, valid) {
      const { wrap } = fieldTooltip(input);
      if (!wrap) return;
      wrap.classList.toggle('is-valid', valid);
    }

    const isEmailFormatValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    const isTelefonoFormatValid = (value) => /^3\d{9}$/.test(value);

    function validateNombreFormat() {
      const value = nombreInput.value.trim();
      if (!value) { setFieldValid(nombreInput, false); showFieldError(nombreInput, 'Ingresa tu nombre.'); return false; }
      if (/\d/.test(value)) { setFieldValid(nombreInput, false); showFieldError(nombreInput, 'El nombre no debe contener números.'); return false; }
      clearFieldError(nombreInput);
      setFieldValid(nombreInput, true);
      return true;
    }
    function validateEmailFormat() {
      const value = emailInput.value.trim();
      if (!value) { setFieldValid(emailInput, false); showFieldError(emailInput, 'Ingresa tu correo.'); return false; }
      if (!isEmailFormatValid(value)) { setFieldValid(emailInput, false); showFieldError(emailInput, 'Ingresa un correo válido.'); return false; }
      clearFieldError(emailInput);
      setFieldValid(emailInput, true);
      return true;
    }
    function validateTelefonoFormat() {
      const value = telefonoInput.value.trim();
      if (!value) { setFieldValid(telefonoInput, false); showFieldError(telefonoInput, 'Ingresa tu número de teléfono.'); return false; }
      if (!isTelefonoFormatValid(value)) { setFieldValid(telefonoInput, false); showFieldError(telefonoInput, 'Ingresa un celular colombiano válido (10 dígitos, inicia en 3).'); return false; }
      clearFieldError(telefonoInput);
      setFieldValid(telefonoInput, true);
      return true;
    }

    // Checks against Supabase without exposing the leads table: a
    // security-definer RPC (check_lead_exists) returns only true/false,
    // never the matching row. See SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY
    // near the top of this file.
    async function checkLeadExists({ email, telefono } = {}) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_lead_exists`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ p_email: email || null, p_telefono: telefono || null }),
        });
        if (!res.ok) {
          console.error('No se pudo verificar duplicados en Supabase:', res.status, await res.text());
          return false; // fail open — no bloquear el registro si la verificación falla
        }
        return await res.json();
      } catch (err) {
        console.error('Error de red verificando duplicados en Supabase:', err);
        return false;
      }
    }

    async function validateEmailDuplicate() {
      if (!validateEmailFormat()) return false;
      if (await checkLeadExists({ email: emailInput.value.trim() })) {
        setFieldValid(emailInput, false);
        showFieldError(emailInput, 'Este correo ya está registrado.');
        return false;
      }
      return true;
    }
    async function validateTelefonoDuplicate() {
      if (!validateTelefonoFormat()) return false;
      if (await checkLeadExists({ telefono: telefonoInput.value.trim() })) {
        setFieldValid(telefonoInput, false);
        showFieldError(telefonoInput, 'Este teléfono ya está registrado.');
        return false;
      }
      return true;
    }

    nombreInput.addEventListener('blur', validateNombreFormat);
    emailInput.addEventListener('blur', validateEmailDuplicate);
    telefonoInput.addEventListener('input', () => {
      telefonoInput.value = telefonoInput.value.replace(/\D/g, '').slice(0, 10);
    });
    telefonoInput.addEventListener('blur', validateTelefonoDuplicate);
    [nombreInput, emailInput, telefonoInput].forEach((el) => {
      el.addEventListener('input', () => {
        if (el.closest('.register-field').classList.contains('has-error')) clearFieldError(el);
      });
    });
    // Live positive feedback as the user types (format only — the async
    // duplicate check still runs on blur and can revoke it), so the field
    // doesn't wait until blur to acknowledge correct input.
    emailInput.addEventListener('input', () => {
      setFieldValid(emailInput, isEmailFormatValid(emailInput.value.trim()));
    });
    telefonoInput.addEventListener('input', () => {
      setFieldValid(telefonoInput, isTelefonoFormatValid(telefonoInput.value.trim()));
    });

    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = emailInput;
      if (input && input.value) {
        const nombreOk = validateNombreFormat();
        const [emailOk, telefonoOk] = await Promise.all([validateEmailDuplicate(), validateTelefonoDuplicate()]);
        if (!nombreOk || !emailOk || !telefonoOk) return;
        // Defense in depth: the submit button is disabled and both boxes
        // are native `required` fields, but a programmatic form.submit()
        // bypasses both — refuse here too rather than log a lead with a
        // missing consent timestamp.
        if (!tcAcceptedAt || !privacyAcceptedAt) return;

        const nombreValue = emailForm.querySelector('input[name="nombre"]').value;
        const telefonoValue = emailForm.querySelector('input[name="telefono"]').value;
        const tier = volumeInput ? volumeInput.value : '';
        const geo = await geoIpPromise;

        saveLeadToSupabase({
          nombre: nombreValue,
          email: input.value,
          telefono: telefonoValue,
          volumen_pedidos: tier,
          interes: new URLSearchParams(window.location.search).get('interest') || null,
          pagina_origen: document.referrer || null,
          ip_address: geo?.ip || null,
          geo_location: geo ? { city: geo.city, region: geo.region, country: geo.country, postal: geo.postal, latitude: geo.latitude, longitude: geo.longitude } : null,
          user_agent: navigator.userAgent,
          tc_accepted_at: tcAcceptedAt,
          privacy_accepted_at: privacyAcceptedAt,
          tc_version: TC_VERSION,
          privacy_version: PRIVACY_VERSION,
        });

        // The terms/privacy checkbox is a native `required` field, so
        // reaching this point already means the visitor accepted both —
        // fire the Meta Pixel's standard Lead event right here, once per
        // successful submission (not on every click of the CTA).
        if (typeof fbq === 'function') {
          fbq('track', 'Lead', {
            content_name: 'Registro Dropi',
            volumen_pedidos: tier,
          });
        }

        openConfirmModal();
        hasRegistered = true;
        revealRecommendedSolutions(tier);
        // Persist across page loads (sessionStorage survives navigation,
        // unlike these in-memory variables) so an internal service page
        // can show its own "Recomendado para ti" pill when relevant —
        // see initServiceRecommendedPill.
        try {
          sessionStorage.setItem('dropiRegistered', '1');
          sessionStorage.setItem('dropiTier', tier);
        } catch (err) { /* sessionStorage unavailable (private mode, etc.) — skip persistence */ }
        emailForm.reset();
        tcAcceptedAt = null;
        privacyAcceptedAt = null;
        updateConsentState();
        [nombreInput, emailInput, telefonoInput].forEach((el) => setFieldValid(el, false));
        if (registroSection) registroSection.hidden = true;
        const defaultChip = volumeChips.find((c) => c.dataset.tier === volumeInput.value) || volumeChips[0];
        if (defaultChip) selectVolumeChip(defaultChip);
        updateStepStates();
      }
    });
  }

  // Returning visitor: sessionStorage (unlike the in-memory `hasRegistered`
  // above) survives navigating away and back, so a fresh load of this page
  // reapplies the recommended-first reorder + pills immediately instead of
  // only right after a live form submission.
  try {
    if (sessionStorage.getItem('dropiRegistered') === '1') {
      const persistedTier = sessionStorage.getItem('dropiTier');
      if (persistedTier) revealRecommendedSolutions(persistedTier);
    }
  } catch (err) { /* sessionStorage unavailable — skip */ }

  // A service detail page's "Volver a soluciones" link sends the visitor
  // here as index.html?solutions=<badge> (no hash, so the page loads at
  // the very top) — smoothly scroll down to that card instead of an
  // instant anchor jump, so the return trip feels like part of one page.
  // Every card stays visible here — the hide-the-current-solution's-card
  // behavior only applies to a service page's own embedded gallery (see
  // initHideOwnSolutionCard), not the landing page's full gallery.
  const solutionsParam = new URLSearchParams(window.location.search).get('solutions');
  if (solutionsParam) scrollToSolutions(solutionsParam);
});
