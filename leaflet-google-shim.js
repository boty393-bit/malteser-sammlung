'use strict';

(function () {
  if (window.L) return;

  let googleReadyResolve;
  const googleReady = new Promise(resolve => { googleReadyResolve = resolve; });

  function loadGoogleMaps() {
    if (window.google?.maps) {
      googleReadyResolve();
      return;
    }
    if (document.querySelector('script[data-google-maps-shim]')) return;
    const callbackName = '__leafletGoogleShimReady';
    window[callbackName] = () => {
      delete window[callbackName];
      googleReadyResolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(window.GOOGLE_MAPS_KEY || '')}&libraries=drawing&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsShim = 'true';
    script.onerror = () => console.error('Google Maps failed to load');
    document.head.appendChild(script);
  }

  function toLatLng(input) {
    if (!input) return null;
    if (input.lat && typeof input.lat === 'function') return input;
    if (Array.isArray(input)) return new google.maps.LatLng(input[0], input[1]);
    return new google.maps.LatLng(input.lat, input.lng);
  }

  function fromLatLng(latLng) {
    return { lat: latLng.lat(), lng: latLng.lng() };
  }

  function makeTooltip(markerLike) {
    return {
      bind(text) {
        markerLike.__tooltip = text;
        if (markerLike.__gm) markerLike.__gm.setTitle(String(text).replace(/<[^>]+>/g, ''));
        return markerLike;
      },
    };
  }

  function iconFromDivIcon(icon) {
    if (!icon?.html) return undefined;
    const colorMatch = icon.html.match(/background:([^;"]+)/i);
    const labelMatch = icon.html.match(/>([^<])<\/div>/i);
    const color = (colorMatch?.[1] || '#555').trim();
    const label = (labelMatch?.[1] || '?').trim();
    const width = icon.iconSize?.[0] || 30;
    const height = icon.iconSize?.[1] || 30;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <circle cx="${width / 2}" cy="${height / 2}" r="${(width / 2) - 2}" fill="${color}" stroke="white" stroke-width="3"/>
        <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="white">${label}</text>
      </svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(width, height),
      anchor: new google.maps.Point(icon.iconAnchor?.[0] || width / 2, icon.iconAnchor?.[1] || height / 2),
    };
  }

  class MapWrapper {
    constructor(elId) {
      this.el = typeof elId === 'string' ? document.getElementById(elId) : elId;
      this.listeners = {};
      this.pendingCenter = { lat: 48.2085, lng: 16.3721 };
      this.pendingZoom = 15;
      this.gm = null;
      this.drawingManager = null;
      this.overlayCompleteListener = null;

      googleReady.then(() => {
        this.gm = new google.maps.Map(this.el, {
          center: this.pendingCenter,
          zoom: this.pendingZoom,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        this.gm.addListener('click', e => this.fire('click', { latlng: { lat: e.latLng.lat(), lng: e.latLng.lng() } }));
      });
    }

    whenReady(fn) {
      googleReady.then(() => {
        if (this.gm) fn(this.gm);
      });
    }

    fire(event, payload) {
      (this.listeners[event] || []).forEach(fn => fn(payload));
    }

    on(event, handler) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(handler);
      if (event === L.Draw.Event.CREATED) this.__createdHandler = handler;
      return this;
    }

    setView(center, zoom) {
      const nextCenter = Array.isArray(center) ? { lat: center[0], lng: center[1] } : center;
      this.pendingCenter = nextCenter;
      this.pendingZoom = zoom;
      this.whenReady(gm => {
        gm.setCenter(nextCenter);
        gm.setZoom(zoom);
      });
      return this;
    }

    fitBounds(bounds) {
      this.whenReady(gm => {
        gm.fitBounds(bounds.__gmBounds || bounds);
      });
      return this;
    }

    invalidateSize() { return this; }
    getContainer() { return this.el; }
  }

  class MarkerWrapper {
    constructor(latlng, options = {}, circle = false) {
      this.latlng = Array.isArray(latlng) ? { lat: latlng[0], lng: latlng[1] } : latlng;
      this.options = options;
      this.circle = circle;
      this.__gm = null;
      this.__info = null;
    }

    addTo(map) {
      this.map = map;
      map.whenReady(gm => {
        if (this.circle) {
          this.__gm = new google.maps.Marker({
            map: gm,
            position: this.latlng,
            zIndex: this.options.zIndexOffset || 0,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: this.options.radius || 8,
              fillColor: this.options.fillColor || '#1565C0',
              fillOpacity: this.options.fillOpacity ?? 1,
              strokeColor: this.options.color || 'white',
              strokeWeight: this.options.weight || 2,
            },
            title: this.__tooltip || '',
          });
        } else {
          this.__gm = new google.maps.Marker({
            map: gm,
            position: this.latlng,
            zIndex: this.options.zIndexOffset || 0,
            icon: iconFromDivIcon(this.options.icon),
            title: this.__tooltip || '',
          });
        }
        if (this.__popupHtml) {
          this.__info = new google.maps.InfoWindow({ content: this.__popupHtml });
          this.__gm.addListener('click', () => this.__info.open({ anchor: this.__gm, map: gm }));
        }
      });
      return this;
    }

    bindTooltip(text) { return makeTooltip(this).bind(text); }
    bindPopup(html) {
      this.__popupHtml = html;
      return this;
    }
    setLatLng(latlng) {
      this.latlng = Array.isArray(latlng) ? { lat: latlng[0], lng: latlng[1] } : latlng;
      if (this.__gm) this.__gm.setPosition(this.latlng);
      return this;
    }
    getLatLng() { return this.latlng; }
    remove() { if (this.__gm) this.__gm.setMap(null); }
  }

  class PolygonWrapper {
    constructor(latlngs, options = {}) {
      this.latlngs = latlngs.map(ll => Array.isArray(ll) ? { lat: ll[0], lng: ll[1] } : ll);
      this.options = options;
      this.__gm = null;
    }

    addTo(map) {
      this.map = map;
      map.whenReady(gm => {
        this.__gm = new google.maps.Polygon({
          map: gm,
          paths: this.latlngs,
          strokeColor: this.options.color,
          strokeWeight: this.options.weight,
          strokeOpacity: this.options.opacity ?? 1,
          fillColor: this.options.fillColor,
          fillOpacity: this.options.fillOpacity ?? 0.1,
          clickable: this.options.interactive !== false,
        });
        if (this.__tooltip) {
          this.__gm.addListener('click', e => {
            const info = new google.maps.InfoWindow({ content: String(this.__tooltip) });
            info.setPosition(e.latLng);
            info.open(gm);
          });
        }
      });
      return this;
    }

    bindTooltip(text) { this.__tooltip = text; return this; }
    getLatLngs() { return [this.latlngs]; }
    remove() { if (this.__gm) this.__gm.setMap(null); }
  }

  class DrawPolygon {
    constructor(map, options = {}) {
      this.map = map;
      this.options = options;
      this.enabled = false;
    }

    enable() {
      this.enabled = true;
      this.map.whenReady(gm => {
        if (!this.map.drawingManager) {
          this.map.drawingManager = new google.maps.drawing.DrawingManager({
            drawingControl: false,
            polygonOptions: {
              strokeColor: this.options.shapeOptions?.color || '#E30613',
              fillColor: this.options.shapeOptions?.fillColor || '#E30613',
              fillOpacity: this.options.shapeOptions?.fillOpacity ?? 0.15,
              strokeWeight: this.options.shapeOptions?.weight || 2,
              clickable: false,
              editable: false,
            },
          });
          this.map.drawingManager.setMap(gm);
          this.map.overlayCompleteListener = google.maps.event.addListener(this.map.drawingManager, 'overlaycomplete', evt => {
            if (evt.type !== google.maps.drawing.OverlayType.POLYGON) return;
            const path = evt.overlay.getPath();
            const latlngs = [];
            for (let i = 0; i < path.getLength(); i++) latlngs.push(fromLatLng(path.getAt(i)));
            const layer = {
              getLatLngs() { return [latlngs]; },
              remove() { evt.overlay.setMap(null); },
            };
            if (this.map.__createdHandler) this.map.__createdHandler({ layer });
          });
        }
        this.map.drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
      });
    }

    disable() {
      this.enabled = false;
      this.map.whenReady(() => {
        if (this.map.drawingManager) this.map.drawingManager.setDrawingMode(null);
      });
    }
  }

  function latLngBounds(points) {
    const bounds = new google.maps.LatLngBounds();
    points.forEach(point => bounds.extend(toLatLng(point)));
    return { __gmBounds: bounds };
  }

  loadGoogleMaps();

  window.L = {
    map(elId) { return new MapWrapper(elId); },
    tileLayer() {
      return {
        on(event, handler) {
          if (event === 'load') googleReady.then(() => setTimeout(handler, 0));
          return this;
        },
        addTo() { return this; },
      };
    },
    control: {
      zoom() {
        return { addTo() { return this; } };
      },
    },
    circleMarker(latlng, options) { return new MarkerWrapper(latlng, options, true); },
    marker(latlng, options) { return new MarkerWrapper(latlng, options, false); },
    polygon(latlngs, options) { return new PolygonWrapper(latlngs, options); },
    divIcon(options) { return options; },
    latLngBounds,
    Draw: {
      Event: { CREATED: 'draw:created' },
      Polygon: DrawPolygon,
    },
  };
})();
