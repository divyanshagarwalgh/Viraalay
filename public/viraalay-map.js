/* viraalaymap v1.0.0 — StayVista-style property map (MapLibre + OpenFreeMap/MapTiler)
 *
 * Renders the Viraalay /map page: a scrollable list of property cards on the
 * left and a live interactive map on the right, both driven from one data
 * source — GET <apiBase>/api/properties-geo. Markers are maroon price pills;
 * clicking a marker opens a popup card and highlights + scrolls to the matching
 * list card; hovering a card highlights its marker; a "Search for a location"
 * field and the Location buttons filter the list and the markers together; a
 * mobile List/Map toggle expands the map full-screen.
 *
 * All of the page's layout / responsive CSS lives here (not in the Designer
 * styles) so it is reliable across breakpoints — the WHTML-generated mobile
 * rules did not apply cleanly. The card list is rendered as soon as the data
 * arrives, independently of the map, so the list works even if tiles are slow.
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

  function metaLine(p) {
    var bits = [];
    if (p.guests) bits.push('Upto ' + p.guests + ' Guests');
    if (p.bedrooms) bits.push(p.bedrooms + ' Room' + (p.bedrooms > 1 ? 's' : ''));
    if (p.bathrooms) bits.push(p.bathrooms + ' Bath' + (p.bathrooms > 1 ? 's' : ''));
    return bits.join(' · ');
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
      /* ---- list cards ---------------------------------------------------- */
      '.map_card{display:flex;gap:12px;padding:10px;border:1px solid #eae6e8;border-radius:14px;text-decoration:none;color:inherit;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);transition:box-shadow .15s,border-color .15s}' +
      '.map_card:hover{box-shadow:0 4px 16px rgba(0,0,0,.10)}' +
      '.map_card.is-active{border-color:' + BRAND + ';box-shadow:0 6px 20px rgba(116,38,60,.18)}' +
      '.map_card-image-wrap{flex:0 0 116px;width:116px;height:98px;border-radius:10px;overflow:hidden;background:#f2edef}' +
      '.map_card-image{width:100%;height:100%;object-fit:cover;display:block}' +
      '.map_card-body{display:flex;flex-direction:column;min-width:0;padding:2px 4px 2px 0}' +
      '.map_card-title{font:600 15px/1.25 system-ui,sans-serif;color:#1a1a1a;margin:0 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.map_card-location{font-size:12.5px;color:#8a6b74;letter-spacing:.02em;margin:0 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.map_card-meta{font-size:12.5px;color:#666;margin:0 0 auto}' +
      '.map_card-price{font:700 15px/1.2 system-ui,sans-serif;color:#1a1a1a;margin-top:6px}' +
      '.map_card-price small{font-weight:400;font-size:12px;color:#888}' +
      '.map_empty{padding:24px 20px;color:#777;font-size:14px}' +
      /* ---- mobile List/Map toggle (base hidden; shown under 992px) -------- */
      '.map_toggle{display:none}' +
      /* ================= mobile ================= */
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
      '<p class="map_card-title">' + esc(p.name) + '</p>' +
      (p.location ? '<p class="map_card-location">' + esc(p.location) + '</p>' : '') +
      '<p class="map_card-meta">' + esc(metaLine(p)) + '</p>' +
      '<p class="map_card-price">₹' + inr(p.price) + ' <small>/ night</small></p>' +
      '</div>'
    );
  }

  function popupHTML(p) {
    return (
      (p.image ? '<img class="vp-img" src="' + esc(p.image) + '" alt="' + esc(p.name) + '">' : '') +
      '<div class="vp-body">' +
      '<p class="vp-name">' + esc(p.name) + '</p>' +
      '<p class="vp-meta">' + esc(metaLine(p)) + '</p>' +
      '<span class="vp-price">₹' + inr(p.price) + ' <small>/ night</small></span><br>' +
      '<a class="vp-cta" href="' + esc(p.url) + '">View villa →</a>' +
      '</div>'
    );
  }

  /* ---- app -------------------------------------------------------------- */

  function app(all) {
    injectCSS();

    var listEl = document.querySelector('[data-map-list]') || document.querySelector('.map_list');
    var countEl = document.querySelector('[data-map-count]') || document.querySelector('.map_count');
    var filterBtns = [].slice.call(document.querySelectorAll('[data-map-filter]'));
    var canvasWrap = document.querySelector('.map_canvas-wrap');

    // The site runs Lenis smooth-scroll, which preventDefaults wheel/touch and so
    // swallows the sidebar's own scroll. data-lenis-prevent makes Lenis skip it.
    var sidebarEl = document.querySelector('.map_sidebar');
    if (sidebarEl) sidebarEl.setAttribute('data-lenis-prevent', '');

    // Search-for-a-location field, overlaid on the top-left of the map.
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

    // The site nav is position:fixed (74px, z-1000) and overlays the top of the
    // page, so without this the map top, the top markers and the search field sit
    // behind it. Offset the map section below the nav by its measured height (so
    // it adapts to whatever the nav is at each breakpoint) and expose that height
    // as --vmap-nav for the mobile full-screen map view.
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

    function renderList(list) {
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
        card.setAttribute('data-price', String(p.price));
        card.setAttribute('data-name', p.name);
        card.innerHTML = cardInnerHTML(p);
        listEl.appendChild(card);
        cards[p.slug] = card;

        card.addEventListener('mouseenter', function () {
          setActive(p.slug);
        });
        card.addEventListener('click', function (e) {
          if (!mapReady || !markers[p.slug]) return; // no map → follow the link
          e.preventDefault();
          setActive(p.slug);
          var mk = markers[p.slug];
          map.flyTo({ center: mk.getLngLat(), zoom: Math.max(map.getZoom(), 12), speed: 0.8 });
          if (!mk.getPopup().isOpen()) mk.togglePopup();
        });
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

    // One filter, driven by a text query. The Location buttons are shortcuts
    // that fill the query, so the search field and the buttons never disagree.
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
      renderList(list);
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

    // Mobile List/Map toggle. It lives inside .map_canvas-wrap, which is
    // display:none in the mobile List view — a fixed element inside a hidden
    // subtree does not render, so move it onto <body> where it always shows.
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

    applyView(''); // list renders immediately

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
    var countEl = document.querySelector('[data-map-count]');
    fetch(API + '/api/properties-geo', { credentials: 'omit' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var props = ((data && data.properties) || []).filter(function (p) {
          return isFinite(Number(p.lat)) && isFinite(Number(p.lng));
        });
        if (!props.length) {
          if (countEl) countEl.textContent = 'Map data is unavailable right now.';
          return;
        }
        app(props);
      })
      .catch(function (err) {
        console.error('[viraalaymap] could not load properties-geo:', err);
        if (countEl) countEl.textContent = 'Map data is unavailable right now.';
      });
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
