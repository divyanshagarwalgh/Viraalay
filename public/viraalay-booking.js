/* =============================================================================
 * Viraalay booking engine - front end
 *
 * Loaded from the booking service with a single tag in the Webflow site footer:
 *   <script defer src="https://YOUR-SERVICE/assets/viraalay-booking.js"></script>
 *
 * Design rules this file follows:
 *  - It never calculates a price. Every amount shown comes from /api/quote,
 *    which comes from Guesty. The browser is a renderer, not a pricing engine.
 *  - It never sees a Guesty or PayU secret.
 *  - It only ever writes into elements that already exist in the Webflow
 *    Designer, or clones a native template node, so the client can restyle
 *    everything without touching this file. The one exception is the date
 *    availability overlay, which has to be generated per day.
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- config */

  var SELF = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  var API_BASE = (function () {
    var override = window.VIRAALAY_BOOKING && window.VIRAALAY_BOOKING.apiBase;
    if (override) return String(override).replace(/\/$/, '');
    try {
      var u = new URL(SELF.src);
      return u.origin;
    } catch (e) {
      return '';
    }
  })();

  var CFG = {
    checkoutPath: '/checkout',
    confirmedPath: '/booking-confirmed',
    failedPath: '/booking-failed',
    currency: 'INR',
    captureMode: 'full',
    depositPercent: 30,
  };

  /* ----------------------------------------------------------------- utils */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

  function text(el, value) { if (el) el.textContent = value; }

  function show(el, display) { if (el) el.style.display = display || 'block'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function toISO(d) {
    if (!d) return null;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /**
   * Tolerant date parser. The hero/nav search widget renders dates as human
   * text, so this accepts what it produces as well as ISO and dd/mm/yyyy.
   */
  function parseDate(value) {
    if (!value) return null;
    var s = String(value).trim();
    if (!s || /select|add date|check/i.test(s)) return null;

    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);

    var dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);

    // "24 Jul", "24 Jul 2026", "Jul 24", "Fri, 24 Jul 2026"
    var cleaned = s.replace(/^[a-z]{3,9},?\s*/i, '');
    var m = cleaned.match(/(\d{1,2})\s*([a-z]{3,9})\.?\s*(\d{4})?/i)
      || cleaned.match(/([a-z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{4})?/i);
    if (m) {
      var day, monName, year;
      if (/^\d/.test(m[1])) { day = +m[1]; monName = m[2]; year = m[3]; }
      else { monName = m[1]; day = +m[2]; year = m[3]; }
      var mon = MONTHS.indexOf(String(monName).slice(0, 3).toLowerCase());
      if (mon >= 0 && day >= 1 && day <= 31) {
        var y = year ? +year : new Date().getFullYear();
        var d = new Date(y, mon, day);
        // No year given and the date already passed -> they mean next year.
        if (!year && d < startOfToday()) d = new Date(y + 1, mon, day);
        return d;
      }
    }
    var fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function nightsBetween(a, b) {
    if (!a || !b) return 0;
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  function fmtDate(iso) {
    var d = parseDate(iso);
    if (!d) return '--';
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * Guesty returns a policy code on every quote (the rate plan's
   * cancellationPolicy). It is the authoritative policy for that booking, so
   * the checkout renders it from the quote rather than from the CMS.
   */
  var POLICIES = {
    flexible: 'Free cancellation up to 1 day before check-in. Cancellations within 24 hours of check-in are non-refundable.',
    moderate: 'Free cancellation up to 5 days before check-in. Cancel between 5 days and 24 hours before check-in for a 50% refund. Within 24 hours is non-refundable.',
    strict: 'Cancel at least 7 days before check-in for a 50% refund. Cancellations within 7 days of check-in are non-refundable.',
    nonrefundable: 'This rate is non-refundable. Once confirmed, the booking cannot be cancelled for a refund.',
  };

  function policyText(code) {
    if (!code) return null;
    var key = String(code).toLowerCase().replace(/[^a-z]/g, '');
    return POLICIES[key] || null;
  }

  var money = (function () {
    var fmt;
    try {
      fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
    } catch (e) { fmt = null; }
    return function (amount, currency) {
      var n = Number(amount) || 0;
      if (currency && currency !== 'INR') {
        try {
          return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency, maximumFractionDigits: 0 }).format(n);
        } catch (e) { /* fall through */ }
      }
      return fmt ? fmt.format(n) : '₹' + Math.round(n).toLocaleString('en-IN');
    };
  })();

  function qs() {
    var out = {};
    new URLSearchParams(location.search).forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function api(path, options) {
    var opts = options || {};
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.text().then(function (t) {
        var json;
        try { json = t ? JSON.parse(t) : null; } catch (e) { json = { message: t }; }
        if (!res.ok) {
          var err = new Error((json && json.message) || 'Request failed');
          err.code = json && json.error;
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  /* ------------------------------------------------------------ selection */

  /**
   * The single source of truth for what the guest has chosen. Reads URL params
   * first (the hero search widget writes them), then falls back to the text the
   * widget rendered into the booking sidebar.
   */
  /**
   * What the guest has currently selected.
   *
   * THE ON-SCREEN WIDGET WINS OVER THE URL. It used to be the other way round,
   * and because a property page is always reached with ?checkin=… in the
   * address, the URL value always matched first and the picker was never read.
   * Changing dates in the widget updated the display and nothing else: the
   * price stayed on the old dates until someone edited the address bar by hand.
   * Reported live 2026-07-23.
   *
   * The URL is only ever a starting value. It is still the fallback for pages
   * that have no picker on them — checkout, the listings page — where these
   * elements do not exist and `textOf` returns nothing.
   */
  function readSelection() {
    var p = qs();

    // "Select date" is an ANSWER, not a missing value. Choosing a new check-in
    // clears the check-out on purpose, and falling back to the URL there would
    // resurrect the old check-out — which made the page think a full stay was
    // chosen after a single click, price the wrong nights, and skip the guest
    // straight past choosing a check-out at all.
    // ONLY real pickers belong here: the booking sidebar, the mobile modal and
    // the hero bar. NOT #vbk_ci / #vbk_co — those are the checkout page's own
    // display, which this page WRITES to (see CheckoutPage.render). Reading
    // them made checkout ask itself for the dates before it had written any,
    // find the "Select date" placeholder, and refuse the whole booking with
    // "We could not load your booking". Every checkout broke.
    var ci = fromPicker(['#bk_ci', '#vm_ci', '#vh_ci'], p.checkin);
    var co = fromPicker(['#bk_co', '#vm_co', '#vh_co'], p.checkout);

    var children = int(p.children, 0);
    var infants = int(p.infants, 0);
    var pets = int(p.pets, 0);

    // The picker only ever displays a combined head count, so recover adults by
    // subtracting the children the URL knows about — otherwise a widget showing
    // "6 guests" alongside children=2 in the URL would price for eight.
    var shown = guestsFromText(textOf('#bk_g')) || guestsFromText(textOf('#vm_g')) || guestsFromText(textOf('#vh_g'));
    var adults = shown > 0 ? Math.max(1, shown - children) : int(p.adults, 0) || 2;

    return {
      checkIn: toISO(ci),
      checkOut: toISO(co),
      adults: adults,
      children: children,
      infants: infants,
      pets: pets,
      nights: nightsBetween(ci, co),
      coupon: p.coupon || '',
    };
  }

  function textOf(sel) {
    var el = $(sel);
    return el ? el.textContent : '';
  }

  /**
   * A date from the on-screen picker, falling back to the URL ONLY when there
   * is no picker on the page at all — checkout and the listings page have none.
   *
   * The distinction that matters: a picker showing "Select date" has told us
   * there is no date, and must not be overruled by a stale URL. Only the
   * absence of the element itself means "we don't know, ask the URL".
   */
  function fromPicker(selectors, urlValue) {
    for (var i = 0; i < selectors.length; i += 1) {
      var el = $(selectors[i]);
      if (el) return parseDate(el.textContent); // may be null — deliberately cleared
    }
    return parseDate(urlValue);
  }

  function int(v, d) {
    var n = parseInt(v, 10);
    return isNaN(n) ? d : n;
  }

  function guestsFromText(t) {
    if (!t) return 0;
    var m = String(t).match(/(\d+)/);
    return m ? +m[1] : 0;
  }

  /**
   * slug -> property record, fetched once from the booking service. This is how
   * a page knows which Guesty listing it is showing without anyone having to
   * bind a hidden attribute in the Designer.
   */
  var INDEX = { bySlug: {}, byListing: {}, loaded: false };

  function loadIndex() {
    return api('/api/properties-index')
      .then(function (data) {
        (data.properties || []).forEach(function (p) {
          if (p.slug) INDEX.bySlug[p.slug] = p;
          if (p.listingId) INDEX.byListing[p.listingId] = p;
        });
        INDEX.loaded = true;
        window.ViraalayBooking.index = INDEX;
        return INDEX;
      })
      .catch(function (err) {
        console.warn('[viraalay] property index unavailable:', err.message);
        return INDEX;
      });
  }

  function currentSlug() {
    var parts = location.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function currentProperty() {
    return INDEX.bySlug[currentSlug()] || null;
  }

  function listingId() {
    // 1. An attribute bound to the CMS field in the Designer, if one exists.
    var el = $('[data-guesty-listing]');
    if (el) {
      var v = (el.getAttribute('data-guesty-listing') || '').trim();
      if (v) return v;
    }
    // 2. An explicit id in the URL (used by /checkout).
    var p = qs();
    if (p.listing || p.listingId) return String(p.listing || p.listingId).trim();
    // 3. The service's slug index.
    var record = currentProperty();
    return record && record.listingId ? record.listingId : '';
  }

  function propertyContext() {
    var p = qs();
    var record = currentProperty() || {};
    return {
      listingId: listingId(),
      propertyItemId: p.propertyId || record.itemId || '',
      propertyName: p.property || record.name || textOf('h1') || document.title.split('|')[0].trim(),
      propertySlug: p.slug || record.slug || currentSlug(),
      propertyImage: p.image || record.image || '',
      propertyLocation: p.location || record.location || textOf('[data-vbk-property-location]') || '',
    };
  }

  /* ------------------------------------------------------- price rendering */

  /**
   * Renders quote line items by cloning the native template row that exists in
   * the Designer, so all styling stays under the client's control.
   */
  function renderRows(container, quote) {
    if (!container) return;
    var tpl = container.querySelector('[data-vbk-row="template"], [data-vbc-row="template"]');
    if (!tpl) return;
    tpl.style.display = 'none';

    $$('[data-vbk-row="generated"]', container).forEach(function (n) { n.remove(); });

    var rows = [];
    if (quote.invoiceItems && quote.invoiceItems.length) {
      quote.invoiceItems.forEach(function (item) {
        rows.push([item.title, money(item.amount, quote.currency)]);
      });
    } else {
      if (quote.nights && quote.fareAccommodation) {
        rows.push([
          money(quote.perNight || quote.fareAccommodation / quote.nights, quote.currency) +
            ' x ' + quote.nights + ' night' + (quote.nights === 1 ? '' : 's'),
          money(quote.fareAccommodation, quote.currency),
        ]);
      }
      if (quote.fareCleaning) rows.push(['Cleaning fee', money(quote.fareCleaning, quote.currency)]);
      if (quote.totalFees) rows.push(['Service fees', money(quote.totalFees, quote.currency)]);
      if (quote.totalTaxes) rows.push(['Taxes', money(quote.totalTaxes, quote.currency)]);
    }

    rows.forEach(function (pair) {
      var node = tpl.cloneNode(true);
      node.setAttribute('data-vbk-row', 'generated');
      // The template carries a hidden-by-default class so it never renders as
      // a stray "Line item 0" row before a quote exists. Clones must shed it.
      node.classList.remove('vbk-rowtpl');
      node.style.display = '';
      var cells = node.children;
      if (cells[0]) cells[0].textContent = pair[0];
      if (cells[1]) cells[1].textContent = pair[1];
      container.appendChild(node);
    });

    if (quote.captureMode === 'part' && quote.payableNow != null && quote.payableNow < quote.total) {
      var note = tpl.cloneNode(true);
      note.setAttribute('data-vbk-row', 'generated');
      note.style.display = '';
      if (note.children[0]) note.children[0].textContent = 'Due now (' + CFG.depositPercent + '%)';
      if (note.children[1]) note.children[1].textContent = money(quote.payableNow, quote.currency);
      container.appendChild(note);

      var bal = tpl.cloneNode(true);
      bal.setAttribute('data-vbk-row', 'generated');
      bal.style.display = '';
      if (bal.children[0]) bal.children[0].textContent = 'Balance at check-in';
      if (bal.children[1]) bal.children[1].textContent = money(quote.balanceDue, quote.currency);
      container.appendChild(bal);
    }
  }

  /* ------------------------------------------------- property detail page */

  var PropertyPage = {
    quoteToken: 0,
    lastKey: '',

    init: function () {
      var id = listingId();
      if (!id) return;

      this.panel = $('[data-vbk-quote]');
      this.rows = $('[data-vbk-quote-rows]');
      this.totalEl = $('[data-vbk-quote-total]');
      this.statusEl = $('[data-vbk-quote-status]');
      this.reserveEl = $('[data-vbk-reserve]');
      this.perNightEl = $('[data-vbk-pernight]');

      this.findStaticPrice();
      this.blockUnavailableClicks();

      this.loadAvailability(id);
      this.watch();
      this.refresh();

      var self = this;
      on(this.reserveEl, 'click', function (e) {
        e.preventDefault();
        self.goToCheckout();
      });

      // Drive the site's own "Book Now" button rather than competing with it.
      // Matched by hook attribute, class, or visible text — whichever the
      // Designer happens to use.
      //
      // Webflow component buttons wrap their label in nested spans
      // (.button-main > .button-main__inner > .button-main__mask >
      // .button-main__text), so the clickable <a> is never itself a leaf and
      // the leaf that holds the text is a <span>. Match on text at any depth,
      // include <span>, then resolve up to the real <a>/<button>. Dedupe on
      // that resolved target — several nested elements share the same label,
      // and binding each would fire goToCheckout once per level.
      var booked = [];
      $$('[data-vla-book], [data-vbk-booknow], .booking_button, a, button, span, div').forEach(function (btn) {
        var hooked = btn.hasAttribute('data-vla-book') || btn.hasAttribute('data-vbk-booknow');
        var isBookNow = hooked || /^book now$/i.test((btn.textContent || '').trim());
        if (!isBookNow) return;
        var target = hooked ? btn : btn.closest('a, button') || btn;
        if (booked.indexOf(target) > -1) return;
        booked.push(target);
        on(target, 'click', function (e) {
          e.preventDefault();
          self.goToCheckout();
        });
      });

      // Two CTAs doing the same thing: the site's own "Book Now" and the
      // "Reserve now" inside the quote panel. Reserve now only exists as a
      // fallback for a template with no Book Now of its own, so when the real
      // one is present and wired, stand down. The site's button is the branded
      // one and sits with Call us / WhatsApp, so it is the one to keep.
      if (booked.length && this.reserveEl) {
        this.reserveEl.style.display = 'none';
        this.reserveEl.setAttribute('data-vbk-superseded', 'true');
      }
    },

    loadAvailability: function (id) {
      var self = this;
      var from = toISO(startOfToday());
      var to = toISO(new Date(Date.now() + 400 * 86400000));
      api('/api/availability?listingId=' + encodeURIComponent(id) + '&from=' + from + '&to=' + to)
        .then(function (data) {
          self.availability = data;
          window.ViraalayBooking.availability = data;
          self.paintCalendar();
          document.dispatchEvent(new CustomEvent('viraalay:availability', { detail: data }));
        })
        .catch(function (err) {
          console.warn('[viraalay] availability unavailable:', err.message);
        });
    },

    /**
     * Greys out unavailable days in whichever calendar is on screen. The hero
     * widget renders day cells with a data-date attribute; anything matching is
     * disabled. Runs again whenever the calendar re-renders.
     */
    /**
     * The date picker lives in the site's head script and renders each day as a
     * bare `<button class="vla-d">12</button>` — no date on it anywhere, which
     * is why availability had nothing to attach to and blocked dates were never
     * marked at all.
     *
     * The date is recoverable: each `.vla-mo` block heads its grid with a
     * "Aug 2026" title, and the non-empty cells inside run 1..n in order. Stamp
     * `data-date` on them so everything downstream can stay generic. Done here
     * rather than in the head block because that block is one 19KB literal
     * holding the entire search widget, and a bad edit there takes search down
     * site-wide. If the picker is ever changed to emit `data-date` itself, this
     * becomes a no-op and can be deleted.
     */
    stampCalendarDates: function () {
      var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

      $$('.vla-mo').forEach(function (month) {
        var head = month.querySelector('.vla-mohd');
        var grid = month.querySelector('.vla-grid');
        if (!head || !grid) return;

        // Heading also holds the ‹ › arrows, so pull the month and year out.
        var m = (head.textContent || '').match(/([A-Za-z]{3})[a-z]*\s+(\d{4})/);
        if (!m) return;
        var monthIndex = MONTHS.indexOf(m[1].toLowerCase());
        var year = Number(m[2]);
        if (monthIndex < 0 || !year) return;

        var pad = function (n) { return (n < 10 ? '0' : '') + n; };

        $$('.vla-d', grid).forEach(function (cell) {
          if (/\bemp\b/.test(cell.className)) return;
          var day = parseInt(cell.textContent, 10);
          if (!day) return;
          var iso = year + '-' + pad(monthIndex + 1) + '-' + pad(day);
          if (cell.getAttribute('data-date') !== iso) cell.setAttribute('data-date', iso);
        });
      });
    },

    paintCalendar: function () {
      if (!this.availability) return;
      this.stampCalendarDates();

      var blocked = {};
      (this.availability.blocked || []).forEach(function (d) { blocked[d] = true; });
      // Dates that are free but cannot be the FIRST night — Guesty's closed-to-
      // arrival flag. Bookable as part of a longer stay, so they are marked
      // differently rather than struck through.
      var noCheckIn = {};
      (this.availability.noCheckIn || []).forEach(function (d) { noCheckIn[d] = true; });

      $$('[data-date]').forEach(function (cell) {
        var d = cell.getAttribute('data-date');
        if (!d) return;

        if (blocked[d]) {
          cell.setAttribute('data-vbk-blocked', 'true');
          cell.setAttribute('aria-disabled', 'true');
          // `title` is the tooltip. Note the cell must stay hit-testable for the
          // browser to show it, so clicks are swallowed by the capture-phase
          // handler below rather than by pointer-events:none.
          cell.setAttribute('title', 'Not available — already booked for this date');
          cell.style.opacity = '0.32';
          cell.style.textDecoration = 'line-through';
          cell.style.cursor = 'not-allowed';
          cell.style.pointerEvents = '';
        } else if (noCheckIn[d]) {
          cell.setAttribute('data-vbk-nocheckin', 'true');
          cell.removeAttribute('data-vbk-blocked');
          cell.removeAttribute('aria-disabled');
          cell.setAttribute('title', 'No check-in on this date — it can still fall inside a longer stay');
          cell.style.opacity = '0.6';
          cell.style.textDecoration = '';
          cell.style.cursor = 'not-allowed';
          cell.style.pointerEvents = '';
        } else {
          // Calendars reuse their cells when the month changes, so everything
          // set above has to be cleared or a free date inherits a struck-out,
          // unclickable cell from whatever date used to sit in that slot.
          cell.removeAttribute('data-vbk-blocked');
          cell.removeAttribute('data-vbk-nocheckin');
          cell.removeAttribute('aria-disabled');
          cell.removeAttribute('title');
          cell.style.opacity = '';
          cell.style.textDecoration = '';
          cell.style.cursor = '';
          cell.style.pointerEvents = '';
        }
      });
    },

    /**
     * Blocked days stay hit-testable so their tooltip appears, so the click has
     * to be stopped here instead. Capture phase, because the date picker lives
     * in the site's own head script and binds its own listeners — by the bubble
     * phase it has already taken the date.
     */
    blockUnavailableClicks: function () {
      if (this.clickGuardBound) return;
      this.clickGuardBound = true;

      document.addEventListener(
        'click',
        function (e) {
          var cell = e.target.closest && e.target.closest('[data-vbk-blocked="true"], [data-vbk-nocheckin="true"]');
          if (!cell) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        },
        true
      );
    },

    /** Poll for changes made by the separately-owned date picker widget. */
    watch: function () {
      var self = this;
      setInterval(function () {
        var sel = readSelection();
        var key = [sel.checkIn, sel.checkOut, sel.adults, sel.children, sel.infants].join('|');
        if (key !== self.lastKey) {
          self.lastKey = key;
          self.refresh();
        }
        self.paintCalendar();
      }, 600);
    },

    /**
     * The property sidebar carries the CMS's own price card — a nightly rate
     * copied from the collection, e.g. "Total (Incl. taxes) ₹14,998 for 2
     * nights". That figure is static: it ignores the guest's dates, the season
     * and the tax actually quoted, so once a live Guesty quote is on screen the
     * two contradict each other and the stale one reads first.
     *
     * Found by text rather than by class because every block in the sidebar is
     * an identically-classed `.booking_content`. If the Designer copy changes
     * and nothing matches, the quote panel simply renders where it already is —
     * the sidebar stays correct, just with the old duplicate visible.
     */
    findStaticPrice: function () {
      if (!this.panel) return;
      var wrap = this.panel.parentNode;
      if (!wrap) return;

      var self = this;
      var kids = [].slice.call(wrap.children);
      var block = null;

      kids.forEach(function (el) {
        if (block || el === self.panel || el.contains(self.panel)) return;
        var txt = (el.textContent || '').replace(/\s+/g, ' ');
        // A price card, not the coupon row: says "total" AND carries a figure.
        if (/total/i.test(txt) && /[\d,]{3,}/.test(txt)) block = el;
      });
      if (!block) return;

      this.staticPrice = block;
      // Sidebar blocks are separated by `.divider_property`; hiding the block
      // without its divider leaves a stray rule floating in the gap.
      var next = block.nextElementSibling;
      this.staticDivider = next && /divider/i.test(next.className || '') ? next : null;
    },

    /**
     * The quote panel is hidden in the Designer so it never duplicates the CMS
     * price card while the engine is idle. That also hid every failure message
     * written into it: when pricing broke, the guest saw the stale CMS card —
     * a price for a different number of nights — with no sign anything was
     * wrong, and a Book Now leading to a checkout that could not price either.
     * Anything the guest needs to read has to force the panel visible.
     */
    showPanelWithoutPrice: function () {
      if (!this.panel) return;
      // Only ever called when there is no quote, so any line items still on
      // screen are from a previous stay and must not be shown beside the
      // message explaining that this one could not be priced.
      $$('[data-vbk-row="generated"]', this.rows || this.panel).forEach(function (row) {
        row.remove();
      });
      this.panel.style.display = 'block';
    },

    /** Live quote wins: hide the stale card and take its place in the column. */
    hideStaticPrice: function () {
      if (!this.staticPrice || this.staticSwapped) return;
      this.staticPrice.style.display = 'none';
      if (this.staticDivider) this.staticDivider.style.display = 'none';
      // Move the panel up into the slot the stale card occupied, so the price
      // still sits above the Book Now row rather than below it.
      if (this.panel && this.panel.parentNode === this.staticPrice.parentNode) {
        this.staticPrice.parentNode.insertBefore(this.panel, this.staticPrice);
      }
      this.staticSwapped = true;
    },

    /**
     * No live quote — unavailable dates, an API error, the engine switched off.
     * Put the CMS card back so the sidebar is never priceless.
     */
    restoreStaticPrice: function () {
      if (!this.staticPrice || !this.staticSwapped) return;
      this.staticPrice.style.display = '';
      if (this.staticDivider) this.staticDivider.style.display = '';
      this.staticSwapped = false;
    },

    refresh: function () {
      var id = listingId();
      var sel = readSelection();
      if (!id) return;

      if (!sel.checkIn || !sel.checkOut || sel.nights < 1) {
        text(this.statusEl, 'Select your dates to see the total for your stay.');
        text(this.totalEl, '');
        if (this.reserveEl) this.reserveEl.setAttribute('data-vbk-state', 'needs-dates');
        this.restoreStaticPrice();
        return;
      }

      var minNights = (this.availability && this.availability.baseMinNights) || 1;
      if (sel.nights < minNights) {
        text(this.statusEl, 'This home has a ' + minNights + '-night minimum stay.');
        text(this.totalEl, '');
        if (this.reserveEl) this.reserveEl.setAttribute('data-vbk-state', 'min-nights');
        this.restoreStaticPrice();
        this.showPanelWithoutPrice();
        return;
      }

      var token = ++this.quoteToken;
      var self = this;
      text(this.statusEl, 'Checking availability and pricing…');

      api('/api/quote', {
        method: 'POST',
        body: {
          listingId: id,
          checkIn: sel.checkIn,
          checkOut: sel.checkOut,
          adults: sel.adults,
          children: sel.children,
          infants: sel.infants,
          pets: sel.pets,
          coupon: sel.coupon,
        },
      })
        .then(function (quote) {
          if (token !== self.quoteToken) return; // a newer request won
          self.quote = quote;
          window.ViraalayBooking.quote = quote;
          // The panel is hidden in the Designer so it never duplicates the
          // site's own price card while the engine is idle. Reveal it only
          // once there is a real, live-priced quote to show.
          if (self.panel) self.panel.style.display = 'block';
          self.hideStaticPrice();
          renderRows(self.rows, quote);
          text(self.totalEl, money(quote.total, quote.currency));
          text(self.perNightEl, money(quote.perNight, quote.currency) + ' / night');
          text(self.statusEl, sel.nights + ' night' + (sel.nights === 1 ? '' : 's') + ', all taxes included');
          if (self.reserveEl) self.reserveEl.setAttribute('data-vbk-state', 'ready');
          document.dispatchEvent(new CustomEvent('viraalay:quote', { detail: quote }));
        })
        .catch(function (err) {
          if (token !== self.quoteToken) return;
          self.quote = null;
          text(self.totalEl, '');
          text(
            self.statusEl,
            err.status === 422 || err.code === 'no_rate_plan'
              ? 'These dates are not available. Please try different dates.'
              : 'We could not price these dates just now. Please try again.'
          );
          if (self.reserveEl) self.reserveEl.setAttribute('data-vbk-state', 'error');
          // This branch is only reachable with valid dates chosen, and the CMS
          // card is a fixed figure for a fixed two nights — leaving it up next
          // to a failure message quotes the guest a price for a stay they did
          // not ask for. No price is the honest answer here.
          self.hideStaticPrice();
          self.showPanelWithoutPrice();
        });
    },

    goToCheckout: function () {
      var sel = readSelection();
      var ctx = propertyContext();
      if (!sel.checkIn || !sel.checkOut || sel.nights < 1) {
        var trigger = $('[data-vla-seg="date"]') || $('[data-vla-open="modal"]');
        if (trigger) trigger.click();
        text(this.statusEl, 'Please choose your check-in and check-out dates first.');
        return;
      }
      var params = new URLSearchParams({
        listing: ctx.listingId,
        checkin: sel.checkIn,
        checkout: sel.checkOut,
        adults: String(sel.adults),
        children: String(sel.children),
        infants: String(sel.infants),
        property: ctx.propertyName || '',
        slug: ctx.propertySlug || '',
        location: ctx.propertyLocation || '',
      });
      if (ctx.propertyItemId) params.set('propertyId', ctx.propertyItemId);
      if (ctx.propertyImage) params.set('image', ctx.propertyImage);
      if (sel.coupon) params.set('coupon', sel.coupon);
      location.href = CFG.checkoutPath + '?' + params.toString();
    },
  };

  /* --------------------------------------------------------- checkout page */

  var CheckoutPage = {
    init: function () {
      var p = qs();
      this.sel = readSelection();
      this.ctx = {
        listingId: p.listing || p.listingId || '',
        propertyItemId: p.propertyId || '',
        propertyName: p.property || '',
        propertySlug: p.slug || '',
        propertyImage: p.image || '',
        propertyLocation: p.location || '',
      };

      if (!this.ctx.listingId || !this.sel.checkIn || !this.sel.checkOut) {
        show($('#vbk_alert'), 'block');
        return;
      }

      this.paintStay();
      this.wire();
      this.loadQuote();
    },

    paintStay: function () {
      text($('#vbk_prop'), this.ctx.propertyName || 'Your stay');
      text($('#vbk_loc'), this.ctx.propertyLocation || '');
      text($('#vbk_ci'), fmtDate(this.sel.checkIn));
      text($('#vbk_co'), fmtDate(this.sel.checkOut));

      var guests = this.sel.adults + this.sel.children;
      text($('#vbk_guests'), guests + ' guest' + (guests === 1 ? '' : 's'));
      text($('#vbk_nights'), this.sel.nights + ' night' + (this.sel.nights === 1 ? '' : 's'));

      var thumb = $('#vbk_thumb');
      if (thumb && this.ctx.propertyImage) {
        thumb.style.backgroundImage = 'url("' + this.ctx.propertyImage.replace(/"/g, '') + '")';
      }

      var edit = $('#vbk_edit');
      if (edit && this.ctx.propertySlug) edit.setAttribute('href', '/properties/' + this.ctx.propertySlug);
    },

    wire: function () {
      var self = this;

      // This is a Webflow form element; its native submit must never fire.
      var form = $('[data-vbk="form"]');
      on(form, 'submit', function (e) { e.preventDefault(); });

      on($('#vbk_pay'), 'click', function (e) {
        e.preventDefault();
        self.pay();
      });

      on($('#vbk_couponbtn'), 'click', function (e) {
        e.preventDefault();
        self.sel.coupon = ($('#vbk_coupon') || {}).value || '';
        self.loadQuote();
      });

      var coupon = $('#vbk_coupon');
      on(coupon, 'keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('#vbk_couponbtn').click(); }
      });
    },

    loadQuote: function () {
      var self = this;
      text($('#vbk_total'), 'Pricing…');
      api('/api/quote', {
        method: 'POST',
        body: {
          listingId: this.ctx.listingId,
          checkIn: this.sel.checkIn,
          checkOut: this.sel.checkOut,
          adults: this.sel.adults,
          children: this.sel.children,
          infants: this.sel.infants,
          coupon: this.sel.coupon,
        },
      })
        .then(function (quote) {
          self.quote = quote;
          renderRows($('#vbk_rows'), quote);
          var payable = quote.captureMode === 'part' ? quote.payableNow : quote.total;
          text($('#vbk_total'), money(payable, quote.currency));
          hide($('#vbk_alert'));
          self.setPayEnabled(true);

          // Show the policy Guesty will actually apply to this booking.
          var policy = policyText(quote.cancellationPolicy);
          if (policy) text($('#vbk_policy'), policy);

          if (quote.checkInTime) text($('#vbk_cit'), 'From ' + quote.checkInTime);
          if (quote.checkOutTime) text($('#vbk_cot'), 'Until ' + quote.checkOutTime);
        })
        .catch(function (err) {
          self.quote = null;
          text($('#vbk_total'), '--');
          self.error(
            err.code === 'no_rate_plan'
              ? 'These dates are no longer available. Please choose different dates.'
              : 'We could not price this stay. Please go back and try again.'
          );
          // Without a quote there is nothing to charge, so pay() refuses anyway.
          // Leaving the button looking live invites a guest to press it and be
          // told to "wait for pricing" for something that is not still loading.
          self.setPayEnabled(false, 'Pricing unavailable');
        });
    },

    /**
     * Reflects "there is a price" in the pay button. Never enables payment on
     * its own — pay() re-checks this.quote before it will POST anything.
     */
    setPayEnabled: function (enabled, labelWhenDisabled) {
      var button = $('#vbk_pay');
      if (!button) return;
      if (this.payLabel == null) this.payLabel = button.textContent;
      button.textContent = enabled ? this.payLabel : labelWhenDisabled || this.payLabel;
      button.setAttribute('data-vbk-state', enabled ? 'ready' : 'unpriced');
      button.style.opacity = enabled ? '' : '0.45';
      button.style.pointerEvents = enabled ? '' : 'none';
    },

    error: function (message) {
      var el = $('#vbk_err');
      if (!el) return;
      el.textContent = message;
      show(el, 'block');
    },

    validate: function () {
      var fields = {
        firstName: ($('#vbk_fn') || {}).value,
        lastName: ($('#vbk_ln') || {}).value,
        email: ($('#vbk_em') || {}).value,
        phone: ($('#vbk_ph') || {}).value,
      };
      var terms = $('[data-vbk="termsrow"] input[type="checkbox"]') || $('#vbk_terms');

      if (!String(fields.firstName || '').trim()) return 'Please enter your first name.';
      if (!String(fields.lastName || '').trim()) return 'Please enter your last name.';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(fields.email || '').trim())) return 'Please enter a valid email address.';
      if (String(fields.phone || '').replace(/\D/g, '').length < 8) return 'Please enter a valid mobile number.';
      if (terms && !terms.checked) return 'Please accept the house rules and cancellation policy to continue.';
      this.guest = {
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        email: fields.email.trim(),
        phone: fields.phone.trim(),
      };
      return null;
    },

    pay: function () {
      var self = this;
      var button = $('#vbk_pay');
      if (button && button.getAttribute('data-vbk-busy') === 'true') return;

      hide($('#vbk_err'));
      var problem = this.validate();
      if (problem) return this.error(problem);
      if (!this.quote) {
        return this.error(
          'We do not have a price for this stay yet, so there is nothing to charge. ' +
            'Please go back and reselect your dates.'
        );
      }

      if (button) {
        button.setAttribute('data-vbk-busy', 'true');
        button.textContent = 'Redirecting to payment…';
      }

      api('/api/checkout', {
        method: 'POST',
        body: {
          listingId: this.ctx.listingId,
          checkIn: this.sel.checkIn,
          checkOut: this.sel.checkOut,
          adults: this.sel.adults,
          children: this.sel.children,
          infants: this.sel.infants,
          coupon: this.sel.coupon,
          guest: this.guest,
          specialRequests: ($('#vbk_msg') || {}).value || '',
          propertyItemId: this.ctx.propertyItemId,
          propertyName: this.ctx.propertyName,
          propertySlug: this.ctx.propertySlug,
          propertyImage: this.ctx.propertyImage,
          propertyLocation: this.ctx.propertyLocation,
        },
      })
        .then(function (res) {
          submitToPayU(res.action, res.fields);
        })
        .catch(function (err) {
          if (button) {
            button.removeAttribute('data-vbk-busy');
            button.textContent = 'Pay securely';
          }
          self.error(err.message || 'We could not start the payment. Please try again.');
        });
    },
  };

  /**
   * PayU hosted checkout requires a real browser form POST - it will not accept
   * a fetch. The form is built, submitted and immediately discarded.
   */
  function submitToPayU(action, fields) {
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.style.display = 'none';
    Object.keys(fields).forEach(function (key) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = fields[key] == null ? '' : String(fields[key]);
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }

  /* ----------------------------------------------------- confirmation page */

  var ConfirmedPage = {
    init: function () {
      var ref = (qs().ref || '').toUpperCase();
      if (!ref) return;
      text($('#vbc_ref'), ref);

      api('/api/booking/' + encodeURIComponent(ref))
        .then(function (b) {
          text($('#vbc_prop'), b.propertyName || 'Your stay');
          text($('#vbc_loc'), b.propertyLocation || '');
          text($('#vbc_ci'), fmtDate(b.checkIn));
          text($('#vbc_co'), fmtDate(b.checkOut));
          text($('#vbc_guests'), (b.adults + b.children) + ' guest' + ((b.adults + b.children) === 1 ? '' : 's'));
          text($('#vbc_nights'), b.nights + ' night' + (b.nights === 1 ? '' : 's'));
          text($('#vbc_guest'), b.guestName || '--');
          text($('#vbc_code'), b.confirmationCode || 'Being issued');
          text($('#vbc_txn'), b.paymentReference || '--');
          text($('#vbc_total'), money(b.amountPaid || b.total, b.currency));
          if (b.checkInTime) text($('#vbc_cit'), 'From ' + b.checkInTime);
          if (b.checkOutTime) text($('#vbc_cot'), 'Until ' + b.checkOutTime);

          renderRows($('#vbc_rows'), {
            invoiceItems: b.lineItems,
            currency: b.currency,
            nights: b.nights,
            fareAccommodation: b.fareAccommodation,
            fareCleaning: b.fareCleaning,
            totalFees: b.totalFees,
            totalTaxes: b.totalTaxes,
          });

          var thumb = $('#vbc_thumb');
          if (thumb && b.propertyImage) thumb.style.backgroundImage = 'url("' + b.propertyImage + '")';

          var view = $('#vbc_view');
          if (view && b.propertySlug) view.setAttribute('href', '/properties/' + b.propertySlug);
          else if (view) view.style.display = 'none';

          if (b.status !== 'Confirmed') {
            text(
              $('#vbc_sub'),
              'Your payment has gone through. Our team is finalising the reservation with the host and will email your confirmation shortly.'
            );
          }
        })
        .catch(function () {
          text($('#vbc_sub'), 'Your payment was received. If you do not get a confirmation email within an hour, contact us with the reference above.');
        });
    },
  };

  var FailedPage = {
    init: function () {
      var p = qs();
      var ref = (p.ref || '').toUpperCase();
      text($('#vbf_ref'), ref || 'not available');

      var reasons = {
        invalid_signature: 'The payment response could not be verified. No charge has been made.',
        amount_mismatch: 'The amount captured did not match your booking total. We have held the booking and will contact you.',
        verification_pending: 'We are still confirming this payment with PayU. Do not pay again — we will email you within a few minutes.',
        not_found: 'We could not find this booking. Please start again.',
        no_reference: 'The payment came back without a booking reference. Please start again.',
      };
      if (p.reason && reasons[p.reason]) text($('#vbf_sub'), reasons[p.reason]);
      else if (p.reason) text($('#vbf_sub'), 'Your bank reported: ' + p.reason + '. Your card has not been charged.');

      var retry = $('#vbf_retry');
      if (retry) {
        retry.setAttribute('href', document.referrer && /checkout/.test(document.referrer) ? document.referrer : '/properties');
      }
    },
  };

  /* --------------------------------------------------- search flow ----- */

  /**
   * Moves the guest to the next field once they've answered the current one:
   * pick a city and the calendar opens; pick both dates and the guest picker
   * opens. Without this every step needs two clicks — one to answer, one to
   * open the next thing — which on mobile is most of the work of searching.
   *
   * Driven from outside the picker rather than inside it. The picker lives in
   * the site's head code as a single block holding the hero bar, nav pill and
   * mobile modal; nudging it from here costs one delegated listener and risks
   * nothing. It works because the picker opens its popovers from a delegated
   * click on [data-vla-seg], so a synthetic click is indistinguishable from a
   * real one.
   */
  var SearchFlow = {
    init: function () {
      if (this.bound) return;
      this.bound = true;
      var self = this;

      this.keepCalendarOpen();

      // CAPTURE phase: keepCalendarOpen() stops calendar clicks from bubbling
      // past the popover, so a listener on the way up would never see them.
      document.addEventListener('click', function (e) {
        if (!e.target.closest) return;

        // Remember which bar the guest is working in — hero, nav pill, mobile
        // modal and booking sidebar can all be on the page at once, and the
        // next field has to come from the same one.
        var seg = e.target.closest('[data-vla-seg]');
        if (seg) {
          self.scope = seg.closest('.vla-modal, .vla-bar, .vla-navbar, .vla-bk') || document;
          return;
        }

        if (e.target.closest('.vla-loci')) {
          self.open('date', 260);
          return;
        }

        var day = e.target.closest('.vla-d');
        if (day && !/\b(emp|dis)\b/.test(day.className || '') && day.getAttribute('data-vbk-blocked') !== 'true') {
          self.afterDates();
        }
      }, true);
    },

    /**
     * Stops the picker from closing its own calendar.
     *
     * Choosing a date or a month arrow makes the picker rebuild the calendar,
     * which replaces every node inside the popover. The click then carries on
     * up to the picker's document-level "a click outside closes the popover"
     * check, which asks whether the clicked element sits inside the popover —
     * and it does not, because the rebuild just destroyed it. The picker
     * concludes the guest clicked away and closes.
     *
     * The visible damage: month arrows shut the calendar, and picking a
     * check-in shut it before the guest could pick a check-out, so every stay
     * needed the calendar reopened by hand halfway through.
     *
     * Stop calendar clicks at the popover and that check never runs for them.
     * Closing on a genuine outside click still works, as does the picker's own
     * deliberate close once both dates are set — that one is on a timer, not on
     * this event.
     */
    keepCalendarOpen: function () {
      var attach = function (pop) {
        if (!pop || pop.getAttribute('data-vbk-guarded')) return false;
        pop.setAttribute('data-vbk-guarded', '1');
        pop.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('.vla-cal')) e.stopPropagation();
        });
        return true;
      };

      // The popover is created lazily, the first time a field is opened.
      if (attach(document.querySelector('.vla-pop'))) return;
      if (typeof MutationObserver === 'undefined') return;
      var observer = new MutationObserver(function () {
        if (attach(document.querySelector('.vla-pop'))) observer.disconnect();
      });
      observer.observe(document.body, { childList: true });
    },

    open: function (type, delay) {
      var self = this;
      setTimeout(function () {
        var scope = self.scope && self.scope.querySelector ? self.scope : document;
        var next = scope.querySelector('[data-vla-seg="' + type + '"]') || $('[data-vla-seg="' + type + '"]');
        if (next) next.click();
      }, delay || 240);
    },

    /**
     * A first date selection leaves the calendar open for the second, so only
     * advance once both ends are actually set. The picker closes the calendar
     * on its own short timer, so poll briefly rather than guessing a delay.
     */
    afterDates: function () {
      var self = this;
      var tries = 0;
      var check = function () {
        tries += 1;
        var sel = readSelection();
        if (sel.checkIn && sel.checkOut && sel.nights >= 1) {
          self.open('guests', 260);
          return;
        }
        if (tries < 8) setTimeout(check, 120);
      };
      setTimeout(check, 200);
    },
  };

  /* ------------------------------------------------------- listing page */

  /**
   * Rewrites a listing card's price to the live rate for the chosen dates.
   *
   * The card renders the CMS `price` field under a "Per Night" label, but that
   * field is not a nightly rate — The Royal Crown carries 18016 there while its
   * live rate is 5500 a night, so the card overstates the price roughly
   * threefold. Guesty's calendar is the only thing that knows what these dates
   * actually cost.
   *
   * These are base rates, before tax. The card's own label already says
   * "+ Taxes"; where it does not, the label is corrected too, because a figure
   * that quietly changes meaning is worse than the stale one it replaced.
   */
  function priceCard(card, result) {
    if (!card || !result || !result.nightlyFrom) return;

    var el = card.querySelector('[fs-list-field="price"], [data-vbk-card-price]');
    if (!el) return;

    var live = String(result.nightlyAvg || result.nightlyFrom);
    if (el.textContent === live) return; // already painted; do not churn the DOM

    // Keep the original for reference and so this is traceable in the DOM.
    if (!el.hasAttribute('data-vbk-price-original')) {
      el.setAttribute('data-vbk-price-original', el.textContent || '');
    }

    // A BARE NUMBER, matching what was there. The rupee sign is a sibling
    // element, so a formatted string would render "₹ ₹5,500" — and the field
    // carries fs-list-fieldtype="number", so Finsweet parses it for price
    // sorting and range filters. Anything but digits breaks both.
    el.textContent = live;
    el.setAttribute('data-vbk-priced', 'live');
  }

  /**
   * The /properties list is rendered by Finsweet, not by Webflow's server, so
   * at boot there is usually nothing on the page yet — a single pass at load
   * time found zero cards and did nothing at all. Finsweet also re-renders the
   * whole list on every filter, sort or page change, discarding anything
   * written into a card. So this watches the list and re-applies.
   */
  var ListingPage = {
    resultsKey: null,
    results: null,
    applying: false,

    init: function () {
      var sel = readSelection();
      if (!sel.checkIn || !sel.checkOut || sel.nights < 1) return;
      this.observe();
      this.apply();
    },

    observe: function () {
      if (this.observer || typeof MutationObserver === 'undefined') return;
      var self = this;
      var root = $('[fs-list-element="list"]') || document.body;
      var timer = null;

      this.observer = new MutationObserver(function () {
        // Painting mutates cards, which would re-trigger this immediately.
        if (self.applying) return;
        clearTimeout(timer);
        timer = setTimeout(function () { self.apply(); }, 250);
      });
      this.observer.observe(root, { childList: true, subtree: true });
    },

    /**
     * Pair each rendered card with a listing id: an explicit attribute if the
     * client bound one, otherwise the slug in the card's detail link.
     *
     * Property cards contain their own nested collection lists (amenities,
     * "great for"), so .w-dyn-item matches far more than just cards. Only the
     * OUTERMOST item that resolves to a listing counts — otherwise a nested
     * item could be hidden instead of the card that contains it.
     */
    collectCards: function () {
      var cards = [];
      $$('.w-dyn-item, [role="listitem"]').forEach(function (el) {
        var attr = el.querySelector('[data-guesty-listing]');
        var id = attr && attr.getAttribute('data-guesty-listing');
        if (!id) {
          var link = el.querySelector('a[href*="/properties/"]');
          if (link) {
            var slug = (link.getAttribute('href') || '').split('?')[0].split('/').filter(Boolean).pop();
            var rec = INDEX.bySlug[slug];
            if (rec && rec.listingId) id = rec.listingId;
          }
        }
        if (!id) return;
        for (var i = 0; i < cards.length; i += 1) {
          if (cards[i].card.contains(el)) return;
        }
        cards.push({ card: el, id: id });
      });
      return cards;
    },

    apply: function () {
      var sel = readSelection();
      if (!sel.checkIn || !sel.checkOut || sel.nights < 1) return;

      var cards = this.collectCards();
      if (!cards.length) return;

      // One request per date range, however many times the list re-renders.
      var key = sel.checkIn + '|' + sel.checkOut;
      var self = this;
      if (this.resultsKey === key && this.results) {
        this.paint(cards, this.results);
        return;
      }
      if (this.inflight === key) return;
      this.inflight = key;

      api('/api/search', {
        method: 'POST',
        body: {
          listingIds: cards.map(function (c) { return c.id; }),
          checkIn: sel.checkIn,
          checkOut: sel.checkOut,
        },
      })
        .then(function (data) {
          var map = {};
          data.results.forEach(function (r) { map[r.listingId] = r; });
          self.resultsKey = key;
          self.results = map;
          self.inflight = null;
          self.paint(self.collectCards(), map);
          document.dispatchEvent(new CustomEvent('viraalay:searchfiltered', { detail: data }));
        })
        .catch(function (err) {
          self.inflight = null;
          console.warn('[viraalay] availability filter skipped:', err.message);
        });
    },

    paint: function (cards, map) {
      this.applying = true;

      var hidden = 0;
      cards.forEach(function (entry) {
        var r = map[entry.id];
        var card = entry.card;
        if (r && !r.available) {
          card.setAttribute('data-vbk-unavailable', 'true');
          card.style.display = 'none';
          hidden += 1;
        } else {
          card.removeAttribute('data-vbk-unavailable');
          priceCard(card, r);
        }
      });

      var counter = $('[data-vbk-availability-note]');
      if (counter) {
        counter.textContent = hidden
          ? hidden + ' home' + (hidden === 1 ? ' is' : 's are') + ' booked for these dates and hidden.'
          : 'All homes below are available for your dates.';
      }

      // The observer fires as a microtask, so this cannot be cleared inline or
      // the paint's own mutations would schedule another pass, forever.
      var self = this;
      setTimeout(function () { self.applying = false; }, 0);
    },
  };

  /* -------------------------------------------------------------- bootstrap */

  window.ViraalayBooking = {
    apiBase: API_BASE,
    readSelection: readSelection,
    refresh: function () { PropertyPage.refresh(); },
    money: money,
    version: '1.0.0',
  };

  function boot() {
    var path = location.pathname.replace(/\/$/, '') || '/';

    // The search bar appears on every page, including the homepage, so this is
    // wired up before the page-specific setup and regardless of which page it is.
    SearchFlow.init();

    var needsIndex = !/^\/(checkout|booking-confirmed|booking-failed)/.test(path);

    Promise.all([
      api('/api/config')
        .then(function (cfg) {
          CFG.captureMode = cfg.captureMode || CFG.captureMode;
          CFG.depositPercent = cfg.depositPercent || CFG.depositPercent;
          CFG.checkoutPath = cfg.checkoutPath || CFG.checkoutPath;
        })
        .catch(function () { /* defaults are fine */ }),
      needsIndex ? loadIndex() : Promise.resolve(),
    ])
      .then(function () {
        if (/^\/checkout/.test(path)) return CheckoutPage.init();
        if (/^\/booking-confirmed/.test(path)) return ConfirmedPage.init();
        if (/^\/booking-failed/.test(path)) return FailedPage.init();
        if (/^\/properties\/.+/.test(path)) return PropertyPage.init();
        if (/^\/properties$/.test(path)) return ListingPage.init();
        // Any other page that happens to carry a listing id (e.g. a landing page).
        if (listingId()) return PropertyPage.init();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
