/* viraalaymap v1.0.0 — StayVista-style property map (MapLibre + OpenFreeMap/MapTiler)
 *
 * Renders the Viraalay /map page: a scrollable list of property cards on the
 * left and a live interactive map on the right, both driven from one data
 * source — GET <apiBase>/api/properties-geo. Markers are maroon price pills;
 * clicking a marker opens a popup card and highlights + scrolls to the matching
 * list card; hovering a card highlights its marker; the Location filter (All /
 * city) drives the list and the markers together; a mobile List/Map toggle
 * expands the map full-screen.
 *
 * This is the code-fallback data path from the build spec (§5.5): the left
 * cards are rendered here from the JSON rather than by a native Finsweet
 * Collection List, so the list and the map can never disagree — they are the
 * same array. Everything downstream (markers, popups, filter) reads the same
 * card DOM the spec describes (.map_card with data-coords / data-slug /
 * data-price / data-name), so a future switch to a native list needs no change
 * to the interaction code.
 *
 * Self-contained: injects MapLibre GL JS (pinned major v5) and its CSS if the
 * page does not already carry them, then boots. No Mapbox, no Google, no key.
 */
(function () {
  'use strict';

  // Guard: only ever run on the map page.
  if (!document.getElementById('map')) return;

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
    return 'https://tiles.openfreemap.org/styles/liberty'; // keyless default
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

  /**
   * Several Viraalay listings are separate bookable units in the same building
   * (the five BlueRoot rooms, the four Lakecity flats) and therefore share one
   * coordinate. Stacked exactly, only the top pill would be visible or
   * clickable. Fan same-point markers out around a tiny circle (~40m) so every
   * one can be seen and opened. Deterministic, so the layout never jitters
   * between renders.
   */
  function spread(props) {
    var groups = {};
    props.forEach(function (p) {
      var key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
      (groups[key] = groups[key] || []).push(p);
    });
    var out = [];
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      if (g.length === 1) {
        out.push({ p: g[0], lat: g[0].lat, lng: g[0].lng });
        return;
      }
      var R = 0.0004; // ~40m
      g.forEach(function (p, i) {
        var a = (2 * Math.PI * i) / g.length;
        out.push({ p: p, lat: p.lat + R * Math.cos(a), lng: p.lng + R * Math.sin(a) });
      });
    });
    return out;
  }

  function injectCSS() {
    if (document.getElementById('viraalay-map-css')) return;
    var s = document.createElement('style');
    s.id = 'viraalay-map-css';
    s.textContent = [
      /* markers */
      '.viraalay-marker{background:' +
        BRAND +
        ';color:#fff;font:600 12px/1 system-ui,-apple-system,sans-serif;padding:6px 10px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;white-space:nowrap;border:1.5px solid #fff;transition:transform .12s,background .12s}',
      '.viraalay-marker:hover{transform:translateY(-2px)}',
      '.viraalay-marker.is-active{background:#1a1a1a;z-index:5}',
      /* popup */
      '.viraalay-popup .maplibregl-popup-content{padding:0;border-radius:12px;overflow:hidden;width:230px;box-shadow:0 6px 24px rgba(0,0,0,.25)}',
      '.viraalay-popup .maplibregl-popup-close-button{width:22px;height:22px;font-size:16px;color:#fff;background:rgba(0,0,0,.35);border-radius:50%;right:6px;top:6px}',
      '.vp-img{width:100%;height:130px;object-fit:cover;display:block;background:#eee}',
      '.vp-body{padding:10px 12px;font:400 13px/1.35 system-ui,sans-serif;color:#222}',
      '.vp-name{font-weight:600;margin:0 0 2px}',
      '.vp-meta{color:#666;font-size:12px;margin:0 0 6px}',
      '.vp-price{font-weight:700}.vp-price small{font-weight:400;color:#666}',
      '.vp-cta{display:inline-block;margin-top:8px;font:600 11px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:' +
        BRAND +
        ';text-decoration:none}',
      /* cards (rendered by this script into .map_list) */
      '.map_card{display:flex;gap:12px;padding:10px;border:1px solid #ececec;border-radius:14px;text-decoration:none;color:inherit;background:#fff;transition:box-shadow .15s,border-color .15s}',
      '.map_card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08)}',
      '.map_card.is-active{border-color:' + BRAND + ';box-shadow:0 6px 20px rgba(116,38,60,.18)}',
      '.map_card-image-wrap{flex:0 0 116px;width:116px;height:98px;border-radius:10px;overflow:hidden;background:#f2edef}',
      '.map_card-image{width:100%;height:100%;object-fit:cover;display:block}',
      '.map_card-body{display:flex;flex-direction:column;min-width:0;padding:2px 4px 2px 0}',
      '.map_card-title{font:600 15px/1.25 system-ui,sans-serif;color:#1a1a1a;margin:0 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.map_card-location{font-size:12.5px;color:#8a6b74;letter-spacing:.02em;margin:0 0 6px}',
      '.map_card-meta{font-size:12.5px;color:#666;margin:0 0 auto}',
      '.map_card-price{font:700 15px/1.2 system-ui,sans-serif;color:#1a1a1a;margin-top:6px}',
      '.map_card-price small{font-weight:400;font-size:12px;color:#888}',
      /* filter active state (whtml css cannot express a combo class) */
      '.map_filter_btn.is-active{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}',
      '.map_empty{padding:24px 20px;color:#777;font-size:14px}',
      /* mobile List/Map toggle state (combo/descendant selectors) */
      '@media(max-width:991px){',
      '.map_component.is-map-view .map_sidebar{display:none}',
      '.map_component.is-map-view .map_canvas-wrap{display:block;position:fixed;left:0;right:0;bottom:0;top:4.5rem;z-index:900;height:auto}',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ---- boot ------------------------------------------------------------- */

  function boot(all) {
    injectCSS();

    var listEl = document.querySelector('[data-map-list]') || document.querySelector('.map_list');
    var countEl = document.querySelector('[data-map-count]') || document.querySelector('.map_count');
    var filterBtns = [].slice.call(document.querySelectorAll('[data-map-filter]'));

    var map = new maplibregl.Map({
      container: 'map',
      style: styleUrl(),
      center: [74.0, 25.4],
      zoom: 5,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    var markers = {}; // slug -> maplibre Marker
    var cards = {}; // slug -> card element
    var currentFilter = 'all';

    function setActive(slug) {
      Object.keys(markers).forEach(function (k) {
        markers[k].getElement().classList.toggle('is-active', k === slug);
      });
      Object.keys(cards).forEach(function (k) {
        cards[k].classList.toggle('is-active', k === slug);
      });
    }

    function clearMarkers() {
      Object.keys(markers).forEach(function (k) {
        markers[k].remove();
      });
      markers = {};
      cards = {};
    }

    function cardHTML(p) {
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

    function render(list) {
      clearMarkers();
      if (listEl) listEl.innerHTML = '';

      if (!list.length) {
        if (listEl) listEl.innerHTML = '<div class="map_empty">No villas in this area yet.</div>';
        if (countEl) countEl.textContent = 'No villas found';
        return;
      }

      var bounds = new maplibregl.LngLatBounds();
      var placed = spread(list);

      placed.forEach(function (row) {
        var p = row.p;

        // --- left card ---
        var card = document.createElement('a');
        card.className = 'map_card';
        card.href = p.url;
        card.setAttribute('data-slug', p.slug);
        card.setAttribute('data-coords', p.lat + ',' + p.lng);
        card.setAttribute('data-price', String(p.price));
        card.setAttribute('data-name', p.name);
        card.innerHTML = cardHTML(p);
        if (listEl) listEl.appendChild(card);
        cards[p.slug] = card;

        // --- marker (price pill) ---
        var el = document.createElement('div');
        el.className = 'viraalay-marker';
        el.textContent = '₹' + inr(p.price);

        var popup = new maplibregl.Popup({ offset: 18, closeButton: true, className: 'viraalay-popup' }).setHTML(
          popupHTML(p)
        );

        var mk = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([row.lng, row.lat])
          .setPopup(popup)
          .addTo(map);
        markers[p.slug] = mk;

        // marker click -> highlight + scroll the matching card into view
        el.addEventListener('click', function () {
          setActive(p.slug);
          if (card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        // card hover -> highlight the marker; card click -> pan + open popup
        card.addEventListener('mouseenter', function () {
          setActive(p.slug);
        });
        card.addEventListener('click', function (e) {
          e.preventDefault();
          setActive(p.slug);
          map.flyTo({ center: [row.lng, row.lat], zoom: Math.max(map.getZoom(), 12), speed: 0.8 });
          if (!mk.getPopup().isOpen()) mk.togglePopup();
        });

        bounds.extend([row.lng, row.lat]);
      });

      try {
        map.fitBounds(bounds, { padding: CFG.fitPadding || 60, maxZoom: CFG.maxZoom || 13, duration: 500 });
      } catch (e) {
        /* single point or empty — leave the current view */
      }
    }

    function applyFilter(city) {
      currentFilter = city;
      filterBtns.forEach(function (b) {
        b.classList.toggle('is-active', (b.getAttribute('data-map-filter') || '') === city);
      });
      var list =
        city === 'all'
          ? all
          : all.filter(function (p) {
              return (p.city || '').toLowerCase() === city.toLowerCase();
            });
      if (countEl) {
        countEl.textContent =
          city === 'all'
            ? 'Showing ' + list.length + ' ' + (list.length === 1 ? 'villa' : 'villas')
            : list.length + ' ' + (list.length === 1 ? 'villa' : 'villas') + ' in ' + city;
      }
      render(list);
    }

    filterBtns.forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        applyFilter(b.getAttribute('data-map-filter') || 'all');
      });
    });

    // Mobile List/Map toggle.
    var toggle = document.querySelector('[data-map-toggle]') || document.querySelector('.map_toggle');
    var comp = document.querySelector('.map_component');
    if (toggle && comp) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        var mapView = comp.classList.toggle('is-map-view');
        toggle.textContent = mapView ? 'List' : 'Map';
        setTimeout(function () {
          map.resize();
        }, 260);
      });
    }

    map.on('load', function () {
      applyFilter('all');
      // The canvas can be laid out (or unhidden on mobile) after init; make sure
      // the map fills it.
      setTimeout(function () {
        map.resize();
      }, 150);
    });
    window.addEventListener('resize', function () {
      map.resize();
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
    var s = document.createElement('script');
    s.src = MAPLIBRE_JS;
    s.onload = cb;
    s.onerror = function () {
      console.error('[viraalaymap] failed to load MapLibre GL JS');
    };
    document.head.appendChild(s);
  }

  function start() {
    fetch(API + '/api/properties-geo', { credentials: 'omit' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var props = (data && data.properties) || [];
        // Degrade gracefully: skip anything without a finite coordinate.
        props = props.filter(function (p) {
          return isFinite(Number(p.lat)) && isFinite(Number(p.lng));
        });
        if (!props.length) {
          var countEl = document.querySelector('[data-map-count]');
          if (countEl) countEl.textContent = 'Map data is unavailable right now.';
          return;
        }
        withMapLibre(function () {
          boot(props);
        });
      })
      .catch(function (err) {
        console.error('[viraalaymap] could not load properties-geo:', err);
        var countEl = document.querySelector('[data-map-count]');
        if (countEl) countEl.textContent = 'Map data is unavailable right now.';
      });
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
