/* viraalaymap v1.0.0 — StayVista-style property map (MapLibre + OpenFreeMap/MapTiler)
 *
 * Renders the Viraalay /map page: a scrollable list of property cards on the
 * left and a live interactive map on the right. Markers are maroon price pills;
 * clicking a marker opens a popup card and highlights + scrolls to the matching
 * list card; hovering a card highlights its marker; a "Search for a location"
 * field and the Location buttons filter the list and the markers together; a
 * mobile List/Map toggle expands the map full-screen.
 *
 * TWO MODES for the left list:
 *   • NATIVE (preferred): a Webflow CMS Collection List renders the cards
 *     (.map_card, bound to Properties, fully editable in the Designer). The
 *     script READS those cards — coordinates from a hidden .map_card-coords
 *     node bound to the Map Coordinates field — and drives the markers from
 *     them. No backend call is needed for the list.
 *   • FALLBACK: if no .map_card elements are present, fetch
 *     <apiBase>/api/properties-geo and render the cards from JSON.
 * Either way the marker/popup/filter code is identical, because both paths
 * produce the same .map_card DOM.
 *
 * All of the page's LAYOUT / responsive CSS lives here so it is reliable across
 * breakpoints. The CARD look does NOT — those classes are real Webflow styles,
 * so the design is edited in the Designer, not here.
 *
 * Self-contained: injects MapLibre GL JS v5 + its CSS if absent. No Mapbox,
 * no Google, no key.
 */
(function () {
  'use strict';

  if (!document.getElementById('map')) return; // guard: only on /map

  var CFG = window.VIRAALAY_MAP || {};
  var BRAND = CFG.brand || '#74263c';
  var API =
    CFG.apiBase ||
    (window.VIRAALAY_BOOKING && window.VIRAALAY_BOOKING.apiBase) ||
    'https://viraalay-production.up.railway.app';

  var MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';
  var MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js';

  /* ---- helpers ---------------------------------------------------------- */

  function styleUrl() {
    if (CFG.styleUrl) return CFG.styleUrl;
    if (CFG.provider === 'maptiler' && CFG.maptilerKey) {
      return 'https://api.maptiler.com/maps/streets-v2/style.json?key=' + CFG.maptilerKey;
    }
    return 'https://tiles.openfreemap.org/styles/liberty';
  }

  function inr(value) {
    var n = Number(String(value == null ? '' : value).replace(/[^\d.]/g, ''));
    return isFinite(n) ? n.toLocaleString('en-IN') : '';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function metaFrom(p) {
    if (p.meta) return p.meta;
    var bits = [];
    if (p.guests) bits.push('Upto ' + p.guests + ' Guests');
    if (p.bedrooms) bits.push(p.bedrooms + ' Room' + (p.bedrooms > 1 ? 's' : ''));
    if (p.bathrooms) bits.push(p.bathrooms + ' Bath' + (p.bathrooms > 1 ? 's' : ''));
    return bits.join(' · ') || p.location || '';
  }

  /** Fan out markers that share a coordinate (same-building units) ~40 m. */
  function spread(list) {
    var groups = {};
    list.forEach(function (p) {
      var key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
      (groups[key] = groups[key] || []).push(p);
    });
    var pos = {};
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      if (g.length === 1) {
        pos[g[0].slug] = { lat: g[0].lat, lng: g[0].lng };
        return;
      }
      var R = 0.0004;
      g.forEach(function (p, i) {
        var a = (2 * Math.PI * i) / g.length;
        pos[p.slug] = { lat: p.lat + R * Math.cos(a), lng: p.lng + R * Math.sin(a) };
      });
    });
    return pos;
  }

  function injectCSS() {
    if (document.getElementById('viraalay-map-css')) return;
    var s = document.createElement('style');
    s.id = 'viraalay-map-css';
    s.textContent =
      /* ---- layout (owns the page so it is reliable at every breakpoint) --- */
      '.section_map{position:relative;width:100%;background:#fff}' +
      '.map_component{display:flex;width:100%;height:calc(100svh - 4.75rem);min-height:34rem;position:relative}' +
      '.map_sidebar{position:relative;width:42%;max-width:40rem;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;border-right:1px solid #ececec;display:flex;flex-direction:column;background:#f6f3f4}' +
      '.map_filters{position:sticky;top:0;z-index:3;display:flex;flex-wrap:wrap;gap:.5rem;padding:1rem 1.25rem;background:#f6f3f4;border-bottom:1px solid #ece8ea}' +
      '.map_filter_btn{border:1px solid #e4d8dd;background:#fff;color:' + BRAND + ';font:600 .8125rem/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:.55rem .9rem;border-radius:10px;cursor:pointer;transition:background .15s,color .15s}' +
      '.map_filter_btn.is-active{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}' +
      '.map_count{padding:.85rem 1.25rem .25rem;color:#6b6b6b;font-size:.875rem}' +
      '.map_list{display:flex;flex-direction:column;gap:.9rem;padding:.75rem 1.25rem 2rem}' +
      '.map_canvas-wrap{position:relative;flex:1;height:100%;min-height:20rem}' +
      '.map_canvas{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%}' +
      /* the CMS Collection List sits inside .map_list — lay its wrapper/list out
         so the native cards stack like the script-rendered ones did */
      '.map_list .w-dyn-items{display:flex;flex-direction:column;gap:.9rem;width:100%}' +
      '.map_list .w-dyn-item{width:100%}' +
      /* card SELECTED state is JS-driven, so it stays here; the rest of the
         card look is native Webflow styles, edited in the Designer */
      '.map_card.is-active{border-color:' + BRAND + ' !important;box-shadow:0 6px 20px rgba(116,38,60,.18) !important}' +
      /* ---- search-for-a-location field (top-left overlay on the map) ------ */
      '.map_search{position:absolute;top:16px;left:16px;z-index:4;display:flex;align-items:center;gap:9px;width:min(340px,calc(100% - 32px));background:#fff;border-radius:999px;box-shadow:0 3px 14px rgba(0,0,0,.18);padding:11px 16px}' +
      '.map_search svg{flex:0 0 auto}' +
      '.map_search input{border:0;outline:0;background:transparent;width:100%;font:400 14px/1.2 system-ui,-apple-system,sans-serif;color:#222}' +
      '.map_search input::placeholder{color:#9a9a9a}' +
      /* ---- markers ------------------------------------------------------- */
      '.viraalay-marker{background:' + BRAND + ';color:#fff;font:600 12px/1 system-ui,-apple-system,sans-serif;padding:6px 10px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;white-space:nowrap;border:1.5px solid #fff;transition:transform .12s,background .12s}' +
      '.viraalay-marker:hover{transform:translateY(-2px)}' +
      '.viraalay-marker.is-active{background:#1a1a1a;z-index:5}' +
      /* ---- popup (explicit white bg so it never bleeds the map through) --- */
      '.viraalay-popup .maplibregl-popup-content{padding:0;border-radius:14px;overflow:hidden;width:240px;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.28)}' +
      '.viraalay-popup .maplibregl-popup-tip{display:none}' +
      '.viraalay-popup .maplibregl-popup-close-button{width:24px;height:24px;font-size:16px;line-height:1;color:#fff;background:rgba(0,0,0,.4);border-radius:50%;right:8px;top:8px;z-index:2}' +
      '.vp-img{width:100%;height:140px;object-fit:cover;display:block;background:#eee}' +
      '.vp-body{padding:11px 13px 13px;font:400 13px/1.35 system-ui,sans-serif;color:#222;background:#fff}' +
      '.vp-name{font-weight:600;margin:0 0 3px;font-size:14px}' +
      '.vp-meta{color:#666;font-size:12px;margin:0 0 6px}' +
      '.vp-price{font-weight:700}.vp-price small{font-weight:400;color:#888}' +
      '.vp-cta{display:inline-block;margin-top:9px;font:600 11px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:' + BRAND + ';text-decoration:none}' +
      '.map_empty{padding:24px 20px;color:#777;font-size:14px}' +
      /* ---- mobile List/Map toggle --------------------------------------- */
      '.map_toggle{display:none}' +
      '@media(max-width:991px){' +
      '.map_component{flex-direction:column;height:calc(100svh - 4.25rem)}' +
      '.map_sidebar{width:100%;max-width:none;border-right:none;height:100%}' +
      '.map_canvas-wrap{display:none}' +
      '.map_search{top:12px;left:12px;right:12px;width:auto}' +
      '.map_toggle{display:inline-flex;align-items:center;gap:7px;position:fixed;left:50%;transform:translateX(-50%);bottom:20px;z-index:1200;background:' + BRAND + ';color:#fff;border:none;padding:12px 26px;border-radius:999px;font:600 13px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 6px 18px rgba(0,0,0,.32);cursor:pointer;text-decoration:none;white-space:nowrap}' +
      '.map_component.is-map-view .map_sidebar{display:none}' +
      '.map_component.is-map-view .map_canvas-wrap{display:block;position:fixed;left:0;right:0;bottom:0;top:var(--vmap-nav,4.25rem);z-index:900;height:auto}' +
      '}';
    document.head.appendChild(s);
  }

  var SEARCH_ICON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="' +
    BRAND +
    '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

  function cardInnerHTML(p) {
    return (
      '<div class="map_card-image-wrap">' +
      (p.image ? '<img class="map_card-image" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy">' : '') +
      '</div>' +
      '<div class="map_card-body">' +
      '<div class="map_card-title">' + esc(p.name) + '</div>' +
      (p.location ? '<div class="map_card-location">' + esc(p.location) + '</div>' : '') +
      '<div class="map_card-meta">' + esc(metaFrom(p)) + '</div>' +
      '<div class="map_card-price">₹' + inr(p.price) + ' <span class="map_card-price-suffix">/ night</span></div>' +
      '</div>'
    );
  }

  function popupHTML(p) {
    return (
      (p.image ? '<img class="vp-img" src="' + esc(p.image) + '" alt="' + esc(p.name) + '">' : '') +
      '<div class="vp-body">' +
      '<p class="vp-name">' + esc(p.name) + '</p>' +
      '<p class="vp-meta">' + esc(metaFrom(p)) + '</p>' +
      '<span class="vp-price">₹' + inr(p.price) + ' <small>/ night</small></span><br>' +
      '<a class="vp-cta" href="' + esc(p.url) + '">View villa →</a>' +
      '</div>'
    );
  }

  /* ---- read a native Webflow Collection List ---------------------------- */

  function textOf(el, sel) {
    var n = el.querySelector(sel);
    return n ? (n.textContent || '').trim() : '';
  }

  function readNativeCards(els) {
    return [].slice
      .call(els)
      .map(function (el, i) {
        var coordsRaw = textOf(el, '.map_card-coords') || el.getAttribute('data-coords') || '';
        var parts = coordsRaw.split(',');
        var lat = parseFloat(parts[0]);
        var lng = parseFloat(parts[1]);
        var link = el.matches('a') ? el : el.querySelector('a');
        var url = link ? link.getAttribute('href') || '#' : '#';
        var slug =
          el.getAttribute('data-slug') ||
          (url && url.indexOf('/') > -1 ? url.split('/').filter(Boolean).pop() : '') ||
          'p' + i;
        var img = el.querySelector('.map_card-image');
        return {
          el: el,
          lat: lat,
          lng: lng,
          slug: slug,
          url: url,
          name: textOf(el, '.map_card-title') || el.getAttribute('data-name') || 'Villa',
          price: (textOf(el, '.map_card-price') || el.getAttribute('data-price') || '').replace(/[^\d]/g, ''),
          location: textOf(el, '.map_card-location'),
          meta: textOf(el, '.map_card-meta'),
          image: img ? img.currentSrc || img.src || img.getAttribute('src') || '' : '',
          city: textOf(el, '.map_card-location'),
        };
      })
      .filter(function (p) {
        return isFinite(p.lat) && isFinite(p.lng);
      });
  }

  /* ---- app -------------------------------------------------------------- */

  function app(all, native) {
    injectCSS();

    var listEl = document.querySelector('[data-map-list]') || document.querySelector('.map_list');
    var countEl = document.querySelector('[data-map-count]') || document.querySelector('.map_count');
    var filterBtns = [].slice.call(document.querySelectorAll('[data-map-filter]'));
    var canvasWrap = document.querySelector('.map_canvas-wrap');

    var sidebarEl = document.querySelector('.map_sidebar');
    if (sidebarEl) sidebarEl.setAttribute('data-lenis-prevent', '');

    var searchInput = null;
    if (canvasWrap) {
      var box = document.createElement('div');
      box.className = 'map_search';
      box.innerHTML = SEARCH_ICON + '<input type="text" placeholder="Search for a location" aria-label="Search for a location" autocomplete="off">';
      canvasWrap.appendChild(box);
      searchInput = box.querySelector('input');
      searchInput.addEventListener('input', function () {
        applyView(searchInput.value);
      });
    }

    var map = null;
    var mapReady = false;
    var markers = {};
    var cards = {};
    var currentList = all;

    function layout() {
      var nav = document.querySelector('.navbar_component, .w-nav, [class*="navbar"]');
      var navH = nav ? Math.round(nav.getBoundingClientRect().height) : 74;
      var overlays = nav && /fixed|sticky|absolute/.test(getComputedStyle(nav).position);
      document.documentElement.style.setProperty('--vmap-nav', navH + 'px');
      var section = document.querySelector('.section_map');
      var comp = document.querySelector('.map_component');
      if (section) section.style.paddingTop = overlays ? navH + 'px' : '0px';
      if (comp) comp.style.height = 'calc(100svh - ' + navH + 'px)';
      if (map) map.resize();
    }
    layout();

    function setActive(slug) {
      Object.keys(markers).forEach(function (k) {
        markers[k].getElement().classList.toggle('is-active', k === slug);
      });
      Object.keys(cards).forEach(function (k) {
        cards[k].classList.toggle('is-active', k === slug);
      });
    }

    function wireCard(p, el) {
      el.addEventListener('mouseenter', function () {
        setActive(p.slug);
      });
      el.addEventListener('click', function (e) {
        if (!mapReady || !markers[p.slug]) return; // no map → follow the link
        e.preventDefault();
        setActive(p.slug);
        var mk = markers[p.slug];
        map.flyTo({ center: mk.getLngLat(), zoom: Math.max(map.getZoom(), 12), speed: 0.8 });
        if (!mk.getPopup().isOpen()) mk.togglePopup();
      });
    }

    // In native mode the cards already exist — wire them once and reuse them.
    if (native) {
      all.forEach(function (p) {
        cards[p.slug] = p.el;
        wireCard(p, p.el);
      });
    }

    function showList(list) {
      if (native) {
        var show = {};
        list.forEach(function (p) {
          show[p.slug] = 1;
        });
        all.forEach(function (p) {
          if (p.el) p.el.style.display = show[p.slug] ? '' : 'none';
        });
        return;
      }
      // fallback: build the cards
      cards = {};
      if (!listEl) return;
      listEl.innerHTML = '';
      if (!list.length) {
        listEl.innerHTML = '<div class="map_empty">No villas match that search.</div>';
        return;
      }
      list.forEach(function (p) {
        var card = document.createElement('a');
        card.className = 'map_card';
        card.href = p.url;
        card.setAttribute('data-slug', p.slug);
        card.setAttribute('data-coords', p.lat + ',' + p.lng);
        card.innerHTML = cardInnerHTML(p);
        listEl.appendChild(card);
        cards[p.slug] = card;
        wireCard(p, card);
      });
    }

    function clearMarkers() {
      Object.keys(markers).forEach(function (k) {
        markers[k].remove();
      });
      markers = {};
    }

    function plotMarkers(list) {
      if (!map || !mapReady) return;
      clearMarkers();
      if (!list.length) return;
      var pos = spread(list);
      var bounds = new maplibregl.LngLatBounds();
      list.forEach(function (p) {
        var at = pos[p.slug] || { lat: p.lat, lng: p.lng };
        var el = document.createElement('div');
        el.className = 'viraalay-marker';
        el.textContent = '₹' + inr(p.price);
        var popup = new maplibregl.Popup({ offset: 18, closeButton: true, className: 'viraalay-popup' }).setHTML(popupHTML(p));
        var mk = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([at.lng, at.lat])
          .setPopup(popup)
          .addTo(map);
        markers[p.slug] = mk;
        el.addEventListener('click', function () {
          setActive(p.slug);
          var card = cards[p.slug];
          if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        bounds.extend([at.lng, at.lat]);
      });
      try {
        map.fitBounds(bounds, { padding: CFG.fitPadding || 60, maxZoom: CFG.maxZoom || 13, duration: 500 });
      } catch (e) {
        /* single point */
      }
    }

    function applyView(query) {
      var q = String(query || '').trim().toLowerCase();
      var list = !q
        ? all
        : all.filter(function (p) {
            return (p.name + ' ' + (p.location || '') + ' ' + (p.city || '')).toLowerCase().indexOf(q) > -1;
          });
      currentList = list;
      filterBtns.forEach(function (b) {
        var c = b.getAttribute('data-map-filter') || '';
        var active = (c === 'all' && !q) || (c !== 'all' && c.toLowerCase() === q);
        b.classList.toggle('is-active', active);
      });
      if (countEl) {
        if (!q) countEl.textContent = 'Showing ' + list.length + ' villas';
        else countEl.textContent = list.length + ' ' + (list.length === 1 ? 'villa' : 'villas') + ' found';
      }
      showList(list);
      plotMarkers(list);
    }

    filterBtns.forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var c = b.getAttribute('data-map-filter') || 'all';
        var v = c === 'all' ? '' : c;
        if (searchInput) searchInput.value = v;
        applyView(v);
      });
    });

    var toggle = document.querySelector('[data-map-toggle]') || document.querySelector('.map_toggle');
    var comp = document.querySelector('.map_component');
    if (toggle && document.body) document.body.appendChild(toggle);
    if (toggle && comp) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        var mapView = comp.classList.toggle('is-map-view');
        toggle.textContent = mapView ? 'List' : 'Map';
        if (map) {
          setTimeout(function () {
            map.resize();
          }, 260);
        }
      });
    }

    applyView('');

    withMapLibre(function () {
      map = new maplibregl.Map({
        container: 'map',
        style: styleUrl(),
        center: [74.0, 25.4],
        zoom: 5,
        attributionControl: true,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('load', function () {
        mapReady = true;
        plotMarkers(currentList);
        setTimeout(function () {
          map.resize();
        }, 150);
      });
      window.addEventListener('resize', function () {
        layout();
      });
    });
  }

  /* ---- data + MapLibre loader ------------------------------------------- */

  function withMapLibre(cb) {
    if (window.maplibregl) return cb();
    if (!document.querySelector('link[data-viraalay-maplibre]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = MAPLIBRE_CSS;
      l.setAttribute('data-viraalay-maplibre', '1');
      document.head.appendChild(l);
    }
    var existing = document.querySelector('script[data-viraalay-maplibre]');
    if (existing) {
      existing.addEventListener('load', cb);
      return;
    }
    var sc = document.createElement('script');
    sc.src = MAPLIBRE_JS;
    sc.setAttribute('data-viraalay-maplibre', '1');
    sc.onload = cb;
    sc.onerror = function () {
      console.error('[viraalaymap] failed to load MapLibre GL JS — list still works');
    };
    document.head.appendChild(sc);
  }

  function start() {
    injectCSS();

    // NATIVE path: a Webflow CMS Collection List already rendered the cards.
    var nativeEls = document.querySelectorAll('.map_card');
    if (nativeEls.length) {
      var props = readNativeCards(nativeEls);
      if (props.length) {
        app(props, true);
        return;
      }
    }

    // FALLBACK path: no native cards — build them from the backend.
    var countEl = document.querySelector('[data-map-count]');
    fetch(API + '/api/properties-geo', { credentials: 'omit' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var list = ((data && data.properties) || []).filter(function (p) {
          return isFinite(Number(p.lat)) && isFinite(Number(p.lng));
        });
        if (!list.length) {
          if (countEl) countEl.textContent = 'Map data is unavailable right now.';
          return;
        }
        app(list, false);
      })
      .catch(function (err) {
        console.error('[viraalaymap] could not load properties-geo:', err);
        if (countEl) countEl.textContent = 'Map data is unavailable right now.';
      });
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
