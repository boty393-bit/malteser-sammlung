/* =========================================
   MALTESER SAMMLUNG APP — app.js
   PWA | Supabase Realtime | Leaflet + OSM
   ─────────────────────────────────────────
   Kein API Key nötig. Kein Geocoding.
   Standort alle 30 s. Pause blendet aus.
   ========================================= */

'use strict';

// ─── Supabase Client ─────────────────────────────────────────────────────────
const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

// ─── Team-Farben ─────────────────────────────────────────────────────────────
const COLORS = [
  '#E30613','#1565C0','#2E7D32','#E65100',
  '#6A1B9A','#00838F','#558B2F','#4527A0',
];

// ─── App-State ───────────────────────────────────────────────────────────────
const S = {
  user:           null,
  event:          null,
  map:            null,
  drawHandler:    null,
  isDrawing:      false,
  isMarkMode:     false,
  isPaused:       false,
  locInterval:    null,
  currentLat:     null,
  currentLng:     null,
  pendingMarkPos: null,
  teamLayers:     {},   // teamId → Leaflet Polygon
  memberMarkers:  {},   // uid   → Leaflet Marker
  visitedMarkers: [],
  teams:          {},
  members:        {},
  ownMarker:      null,
  streetToastTimer: null,
  currentStreet:  '',
  channels:       [],
  userId:         null,
};

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    let { data: { session } } = await db.auth.getSession();
    if (!session) {
      const res = await db.auth.signInAnonymously();
      session = res.data?.session;
    }
    if (!session) { setLoadingText('Auth-Fehler – bitte Seite neu laden.'); return; }
    S.userId = session.user.id;
  } catch (e) {
    setLoadingText('Verbindungsfehler – bitte Seite neu laden.');
    console.error(e); return;
  }

  const saved = sessionStorage.getItem('malt_session');
  if (saved) {
    try {
      const sess = JSON.parse(saved);
      S.user  = sess.user;
      S.event = sess.event;
      hideLoading();
      enterApp();
      return;
    } catch (_) { sessionStorage.removeItem('malt_session'); }
  }

  hideLoading();
  showScreen('login');
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOADING / SCREENS / TOAST
// ─────────────────────────────────────────────────────────────────────────────

function hideLoading()     { id('loading').style.display = 'none'; }
function showLoading(t)    { setLoadingText(t); id('loading').style.display = 'flex'; }
function setLoadingText(t) { id('loading-text').textContent = t; }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = id('screen-' + name);
  if (el) el.classList.add('active');
}

function showToast(msg) {
  const el = id('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  el._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
}

function setMapStatus(message, isError = false) {
  const el = id('map-status');
  if (!el) return;
  if (!message) {
    el.style.display = 'none';
    el.textContent = '';
    el.classList.remove('error');
    return;
  }
  el.textContent = message;
  el.style.display = 'block';
  el.classList.toggle('error', !!isError);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────────────────────

let _role = 'member';

function selectRole(role) {
  _role = role;
  document.querySelectorAll('.role-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.role === role)
  );
  id('join-section').style.display = role === 'member' ? 'block' : 'none';
  id('tc-section').style.display   = role === 'tc'     ? 'block' : 'none';
  loginError('');
}

function loginError(msg) {
  const el = id('login-error');
  el.textContent = msg;
  el.classList.toggle('visible', !!msg);
}

async function handleJoin() {
  const name = val('input-name');
  const code = val('input-code').toUpperCase();
  if (!name) { loginError('Bitte deinen Namen eingeben.'); return; }
  if (code.length < 4) { loginError('Bitte einen gültigen Event-Code eingeben.'); return; }
  await joinEvent(name, code, 'member');
}

async function handleCreateEvent() {
  const name = val('input-name');
  if (!name) { loginError('Bitte deinen Namen eingeben.'); return; }
  showLoading('Erstelle Event…');
  try {
    const code      = genCode();
    const eventName = 'Sammlung ' + new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const { data, error } = await db.from('events')
      .insert({ name: eventName, code, created_by: S.userId })
      .select().single();
    if (error) throw error;
    S.event = { id: data.id, name: data.name, code: data.code };
    S.user  = { uid: S.userId, name, role: 'tc', teamId: null };
    await db.from('participants').upsert(
      { event_id: data.id, user_uid: S.userId, name, role: 'tc' },
      { onConflict: 'event_id,user_uid' }
    );
    saveSession(); hideLoading(); enterApp();
  } catch (e) {
    hideLoading();
    loginError('Fehler beim Erstellen. Bitte erneut versuchen.');
    console.error(e);
  }
}

async function handleTCJoin() {
  const name = val('input-name');
  const code = val('input-tc-code').toUpperCase();
  if (!name) { loginError('Bitte deinen Namen eingeben.'); return; }
  if (code.length < 4) { loginError('Bitte Event-Code eingeben.'); return; }
  await joinEvent(name, code, 'tc');
}

async function joinEvent(name, code, role) {
  showLoading('Verbinde…');
  try {
    const { data, error } = await db.from('events').select().eq('code', code).single();
    if (error || !data) { hideLoading(); loginError('Event-Code nicht gefunden.'); return; }
    S.event = { id: data.id, name: data.name, code: data.code };
    S.user  = { uid: S.userId, name, role, teamId: null };
    const { data: ex } = await db.from('participants')
      .select('team_id').eq('event_id', data.id).eq('user_uid', S.userId).single();
    if (ex?.team_id) S.user.teamId = ex.team_id;
    await db.from('participants').upsert(
      { event_id: data.id, user_uid: S.userId, name, role },
      { onConflict: 'event_id,user_uid' }
    );
    saveSession(); hideLoading(); enterApp();
  } catch (e) {
    hideLoading();
    loginError('Verbindungsfehler. Bitte erneut versuchen.');
    console.error(e);
  }
}

function saveSession() {
  sessionStorage.setItem('malt_session', JSON.stringify({ user: S.user, event: S.event }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENTER APP
// ─────────────────────────────────────────────────────────────────────────────

function enterApp() {
  showScreen('map');
  setMapStatus('Karte wird geladen…');
  const isTc = S.user.role === 'tc';
  id('tc-controls').style.display     = isTc ? 'flex' : 'none';
  id('member-controls').style.display = 'flex';
  id('btn-pause').style.display       = isTc ? 'none' : 'inline-flex';
  id('event-name-display').textContent = S.event.name;
  id('event-code-display').textContent = S.event.code;
  id('tc-code-big').textContent        = S.event.code;

  initMap();
  subscribeAreas();
  subscribeLocations();
  subscribeVisited();
  subscribeMembers();
  startLocTracking();
  window.addEventListener('beforeunload', clearMyLoc);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LEAFLET MAP
// ─────────────────────────────────────────────────────────────────────────────

function initMap() {
  if (typeof window.L === 'undefined') {
    setMapStatus('Die Karte konnte nicht geladen werden. Bitte Seite neu laden.', true);
    return;
  }

  S.map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
  }).setView([48.2085, 16.3721], 15);

  window.setTimeout(() => {
    if (S.map) S.map.invalidateSize();
  }, 0);

  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  });
  tiles.on('load', () => setMapStatus(''));
  tiles.on('tileerror', () => {
    setMapStatus('Kartendaten konnten nicht geladen werden. Bitte Seite neu laden oder ohne strikten Tracking-Schutz öffnen.', true);
  });
  tiles.addTo(S.map);

  // Zoom-Buttons oben rechts mit Abstand zum Header
  L.control.zoom({ position: 'topright' }).addTo(S.map);

  S.map.on('click', onMapClick);

  // Listen for completed polygon draw
  S.map.on(L.Draw.Event.CREATED, onPolygonDrawn);

  // Eigenen Standort sofort holen
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      S.currentLat = pos.coords.latitude;
      S.currentLng = pos.coords.longitude;
      S.map.setView([S.currentLat, S.currentLng], 16);
      updateOwnMarker(S.currentLat, S.currentLng);
    }, null, { enableHighAccuracy: true, timeout: 8000 });
  }
}

function onMapClick(e) {
  if (!S.isMarkMode) return;
  S.pendingMarkPos = { lat: e.latlng.lat, lng: e.latlng.lng };
  openHousePopup('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOCATION TRACKING  (alle 30 s)
// ─────────────────────────────────────────────────────────────────────────────

function startLocTracking() {
  fetchAndSendLoc();
  S.locInterval = setInterval(fetchAndSendLoc, 30_000);
}

function fetchAndSendLoc() {
  if (S.isPaused || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      S.currentLat = pos.coords.latitude;
      S.currentLng = pos.coords.longitude;
      sendMyLoc(S.currentLat, S.currentLng);
      updateOwnMarker(S.currentLat, S.currentLng);
    },
    null,
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 25_000 }
  );
}

async function sendMyLoc(lat, lng) {
  if (S.isPaused || !S.event) return;
  await db.from('locations').upsert({
    event_id: S.event.id, user_uid: S.user.uid,
    lat, lng, name: S.user.name, role: S.user.role,
    team_id: S.user.teamId || null,
    is_paused: false, updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id,user_uid' });
}

async function clearMyLoc() {
  if (!S.event) return;
  await db.from('locations')
    .update({ is_paused: true, updated_at: new Date().toISOString() })
    .eq('event_id', S.event.id).eq('user_uid', S.user.uid);
}

// ─────────────────────────────────────────────────────────────────────────────
//  OWN MARKER (blauer Kreis)
// ─────────────────────────────────────────────────────────────────────────────

function updateOwnMarker(lat, lng) {
  if (!S.map) return;
  if (!S.ownMarker) {
    S.ownMarker = L.circleMarker([lat, lng], {
      radius: 10, fillColor: '#1565C0', fillOpacity: 1,
      color: 'white', weight: 3, zIndexOffset: 1000,
    }).addTo(S.map).bindTooltip(S.user.name + ' (Ich)', { permanent: false });
  } else {
    S.ownMarker.setLatLng([lat, lng]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUPABASE REALTIME
// ─────────────────────────────────────────────────────────────────────────────

function subscribeLocations() {
  loadLocations();
  const ch = db.channel(`loc-${S.event.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'locations',
      filter: `event_id=eq.${S.event.id}`,
    }, payload => {
      const row = payload.new || payload.old;
      if (!row || row.user_uid === S.user.uid) return;
      const stale = Date.now() - new Date(row.updated_at).getTime() > 6 * 60 * 1000;
      if (row.is_paused || stale) removeMemberMarker(row.user_uid);
      else upsertMemberMarker(row.user_uid, row);
    }).subscribe();
  S.channels.push(ch);
}

async function loadLocations() {
  const staleISO = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data } = await db.from('locations').select('*')
    .eq('event_id', S.event.id).eq('is_paused', false).gte('updated_at', staleISO);
  (data || []).forEach(row => {
    if (row.user_uid !== S.user.uid) upsertMemberMarker(row.user_uid, row);
  });
}

function subscribeAreas() {
  loadAreas();
  const ch = db.channel(`teams-${S.event.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'teams',
      filter: `event_id=eq.${S.event.id}`,
    }, () => loadAreas()).subscribe();
  S.channels.push(ch);
}

async function loadAreas() {
  const { data } = await db.from('teams').select('*').eq('event_id', S.event.id);
  const rows = data || [];
  S.teams = {};
  rows.forEach(t => { S.teams[t.id] = t; });

  Object.values(S.teamLayers).forEach(l => l.remove());
  S.teamLayers = {};
  rows.forEach(t => { if (t.area_paths) drawArea(t); });

  if (S.user.role === 'tc') renderTeamsList();
}

function subscribeVisited() {
  loadVisited();
  const ch = db.channel(`visited-${S.event.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'visited',
      filter: `event_id=eq.${S.event.id}`,
    }, payload => { if (payload.new) addVisitedMarker(payload.new); }).subscribe();
  S.channels.push(ch);
}

async function loadVisited() {
  const { data } = await db.from('visited').select('*').eq('event_id', S.event.id);
  S.visitedMarkers.forEach(m => m.remove());
  S.visitedMarkers = [];
  (data || []).forEach(addVisitedMarker);
}

function subscribeMembers() {
  loadMembers();
  const ch = db.channel(`members-${S.event.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'participants',
      filter: `event_id=eq.${S.event.id}`,
    }, payload => {
      if (!payload.new) return;
      const row = payload.new;
      S.members[row.user_uid] = row;
      if (row.user_uid === S.user.uid && row.team_id) {
        S.user.teamId = row.team_id;
        saveSession();
        loadAreas();
      }
      if (S.user.role === 'tc') renderMembersList();
    }).subscribe();
  S.channels.push(ch);
}

async function loadMembers() {
  const { data } = await db.from('participants').select('*').eq('event_id', S.event.id);
  S.members = {};
  (data || []).forEach(m => { S.members[m.user_uid] = m; });
  if (S.user.role === 'tc') renderMembersList();
}

// ─────────────────────────────────────────────────────────────────────────────
//  MEMBER MARKERS (farbige Kreise mit Anfangsbuchstabe)
// ─────────────────────────────────────────────────────────────────────────────

function memberIcon(name, color) {
  const initial = (name || '?')[0].toUpperCase();
  return L.divIcon({
    className: '',
    html: `<div style="
      width:30px;height:30px;
      background:${color};
      border:3px solid white;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:12px;
      box-shadow:0 2px 8px rgba(0,0,0,.35);
    ">${initial}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function upsertMemberMarker(uid, row) {
  const color = row.team_id ? teamColor(row.team_id) : '#555';
  const isTC  = row.role === 'tc';
  if (!S.memberMarkers[uid]) {
    const marker = L.marker([row.lat, row.lng], {
      icon: memberIcon(row.name, isTC ? '#333' : color),
      zIndexOffset: isTC ? 900 : 800,
    }).addTo(S.map)
      .bindTooltip(`${row.name}${isTC ? ' 👑' : ''}`, { direction: 'top' });
    S.memberMarkers[uid] = marker;
  } else {
    S.memberMarkers[uid].setLatLng([row.lat, row.lng]);
  }
}

function removeMemberMarker(uid) {
  if (S.memberMarkers[uid]) {
    S.memberMarkers[uid].remove();
    delete S.memberMarkers[uid];
  }
}

function teamColor(teamId) {
  const keys = Object.keys(S.teams);
  const idx  = keys.indexOf(teamId);
  return COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
//  TEAM AREA POLYGONE
// ─────────────────────────────────────────────────────────────────────────────

function drawArea(team) {
  const idx    = Object.keys(S.teams).indexOf(team.id);
  const color  = COLORS[idx % COLORS.length];
  const isMine = S.user.teamId === team.id;
  const latlngs = team.area_paths.map(p => [p.lat, p.lng]);
  const poly = L.polygon(latlngs, {
    color, weight: isMine ? 3 : 2, opacity: 0.9,
    fillColor: color, fillOpacity: isMine ? 0.2 : 0.07,
    interactive: false,
  }).addTo(S.map);
  poly.bindTooltip(team.name, { sticky: true });
  S.teamLayers[team.id] = poly;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DRAWING (TC) – Leaflet.draw
// ─────────────────────────────────────────────────────────────────────────────

function toggleDrawing() {
  if (S.isDrawing) {
    if (S.drawHandler) { S.drawHandler.disable(); S.drawHandler = null; }
    S.isDrawing = false;
    id('btn-draw').classList.remove('active');
  } else {
    S.drawHandler = new L.Draw.Polygon(S.map, {
      shapeOptions: {
        color: '#E30613', fillColor: '#E30613', fillOpacity: 0.15, weight: 2,
      },
      showArea: false,
    });
    S.drawHandler.enable();
    S.isDrawing = true;
    id('btn-draw').classList.add('active');
    showToast('Klicke Punkte → Doppelklick zum Abschließen');
  }
}

function onPolygonDrawn(e) {
  S.isDrawing = false;
  id('btn-draw').classList.remove('active');
  const latlngs = e.layer.getLatLngs()[0];
  const paths   = latlngs.map(ll => ({ lat: ll.lat, lng: ll.lng }));
  e.layer.remove();
  assignAreaToTeam(paths);
}

function assignAreaToTeam(paths) {
  const teamKeys = Object.keys(S.teams);
  const save = async (teamId) => {
    await db.from('teams').update({ area_paths: paths }).eq('id', teamId);
    showToast('✅ Gebiet gespeichert');
  };

  if (!teamKeys.length) {
    const name = prompt('Noch kein Team – neuen Namen eingeben:');
    if (!name) return;
    createTeam(name.trim()).then(save);
    return;
  }
  const opts = teamKeys.map((tid, i) => `${i + 1}: ${S.teams[tid].name}`).join('\n');
  const inp  = prompt(`Welchem Team gehört dieses Gebiet?\n\n${opts}\n\nNummer eingeben:`);
  if (!inp) return;
  const idx = parseInt(inp) - 1;
  if (idx >= 0 && idx < teamKeys.length) save(teamKeys[idx]);
}

// ─────────────────────────────────────────────────────────────────────────────
//  VISITED HOUSES
// ─────────────────────────────────────────────────────────────────────────────

function addVisitedMarker(row) {
  if (!S.map) return;
  const label = [row.street, row.number].filter(Boolean).join(' ');
  const time  = new Date(row.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const m = L.circleMarker([row.lat, row.lng], {
    radius: 8, fillColor: '#2E7D32', fillOpacity: 0.9,
    color: 'white', weight: 2, zIndexOffset: 500,
  }).addTo(S.map);
  m.bindPopup(`${label ? `<strong>${esc(label)}</strong><br>` : ''}<small style="color:#777">Besucht ${time} · ${esc(row.marked_by_name || '')}</small>`);
  S.visitedMarkers.push(m);
}

// ─────────────────────────────────────────────────────────────────────────────
//  MARK MODE
// ─────────────────────────────────────────────────────────────────────────────

function toggleMarkMode() {
  S.isMarkMode = !S.isMarkMode;
  id('btn-mark').classList.toggle('active', S.isMarkMode);
  id('mark-hint').style.display = S.isMarkMode ? 'flex' : 'none';
  if (S.map) S.map.getContainer().style.cursor = S.isMarkMode ? 'crosshair' : '';
  if (!S.isMarkMode) closeHousePopup();
}

function openHousePopup(street) {
  id('house-street-input').value  = street || '';
  id('house-number-input').value  = '';
  id('house-popup').style.display = 'flex';
  setTimeout(() => id('house-street-input').focus(), 100);
}

function closeHousePopup() { id('house-popup').style.display = 'none'; S.pendingMarkPos = null; }
function cancelHouseMark() { closeHousePopup(); }

async function confirmHouseMark() {
  if (!S.pendingMarkPos) return;
  const street = id('house-street-input').value.trim();
  const number = id('house-number-input').value.trim();
  const { lat, lng } = S.pendingMarkPos;
  const { error } = await db.from('visited').insert({
    event_id: S.event.id, lat, lng,
    street: street || null, number: number || null,
    team_id: S.user.teamId || null,
    marked_by: S.user.uid, marked_by_name: S.user.name,
  });
  if (error) { console.error(error); showToast('Fehler beim Speichern'); return; }
  closeHousePopup();
  if (street) showStreetToast(`${street}${number ? ' ' + number : ''}`);
  showToast('✅ Haus markiert');
}

// ─────────────────────────────────────────────────────────────────────────────
//  STREET TOAST
// ─────────────────────────────────────────────────────────────────────────────

function showStreetToast(name) {
  S.currentStreet = name;
  id('street-name-text').textContent = name;
  id('street-toast').style.display   = 'flex';
  clearTimeout(S.streetToastTimer);
  S.streetToastTimer = setTimeout(hideStreetToast, 12_000);
}
function hideStreetToast() { id('street-toast').style.display = 'none'; }
function copyStreetName()  { copyText(S.currentStreet); showToast('📋 Straßenname kopiert!'); }

// ─────────────────────────────────────────────────────────────────────────────
//  PAUSE
// ─────────────────────────────────────────────────────────────────────────────

function togglePause() {
  S.isPaused = !S.isPaused;
  const btn = id('btn-pause');
  if (S.isPaused) {
    clearMyLoc();
    id('pause-overlay').style.display = 'flex';
    btn.textContent = '▶ Weiter';
    btn.classList.add('paused');
  } else {
    id('pause-overlay').style.display = 'none';
    btn.textContent = '⏸ Pause';
    btn.classList.remove('paused');
    fetchAndSendLoc();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ABHOLORT TEILEN
// ─────────────────────────────────────────────────────────────────────────────

function sharePickupLocation() {
  if (!S.currentLat) { showToast('Standort wird noch ermittelt…'); return; }
  const url  = `https://maps.google.com/maps?q=${S.currentLat},${S.currentLng}`;
  const text = `📍 Abholort:\n${url}`;
  if (navigator.share) navigator.share({ title: 'Abholort', text, url }).catch(() => {});
  else { copyText(text); showToast('📋 Abholort-Link kopiert!'); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAP CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

function centerOnMe() {
  if (S.currentLat && S.map) S.map.setView([S.currentLat, S.currentLng], 17);
  else showToast('Standort wird noch ermittelt…');
}

function centerOnAll() {
  if (!S.map) return;
  const points = [];
  Object.values(S.teamLayers).forEach(l => l.getLatLngs()[0].forEach(ll => points.push(ll)));
  Object.values(S.memberMarkers).forEach(m => points.push(m.getLatLng()));
  if (S.ownMarker) points.push(S.ownMarker.getLatLng());
  if (points.length) S.map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
}

// ─────────────────────────────────────────────────────────────────────────────
//  EVENT CODE
// ─────────────────────────────────────────────────────────────────────────────

function copyEventCode() { copyText(S.event.code); showToast(`Code "${S.event.code}" kopiert!`); }

function shareEventCode() {
  const text = `Malteser Sammlung\nEvent-Code: ${S.event.code}\n\nApp: ${location.href}`;
  if (navigator.share) navigator.share({ title: 'Malteser Sammlung', text }).catch(() => {});
  else { copyText(text); showToast('📋 Einladung kopiert!'); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TC PANEL
// ─────────────────────────────────────────────────────────────────────────────

function openTCPanel()   { id('tc-panel').classList.add('open');    id('backdrop').style.display = 'block'; }
function closeTCPanel()  { id('tc-panel').classList.remove('open'); id('backdrop').style.display = 'none'; }
function closeAllPanels(){ closeTCPanel(); }

async function createTeam(name) {
  const { data, error } = await db.from('teams')
    .insert({ event_id: S.event.id, name }).select().single();
  if (error) throw error;
  return data.id;
}

function addTeam() {
  const name = prompt('Team-Name (z.B. "Team 1" oder "Anna & Max"):');
  if (!name?.trim()) return;
  createTeam(name.trim()).then(() => showToast('✅ Team erstellt')).catch(console.error);
}

async function deleteTeam(teamId) {
  if (!confirm('Team und Gebiet wirklich löschen?')) return;
  await db.from('teams').delete().eq('id', teamId);
}

function renderTeamsList() {
  const el   = id('teams-list');
  const keys = Object.keys(S.teams);
  if (!keys.length) { el.innerHTML = '<p class="empty-hint">Noch keine Teams.</p>'; return; }
  el.innerHTML = keys.map((tid, i) => {
    const t     = S.teams[tid];
    const color = COLORS[i % COLORS.length];
    const mems  = Object.values(S.members).filter(m => m.team_id === tid).map(m => m.name).join(', ') || 'Niemand';
    return `<div class="team-item">
      <div class="team-dot" style="background:${color}"></div>
      <div class="team-info">
        <div class="team-name">${esc(t.name)}</div>
        <div class="team-sub">${esc(mems)}</div>
      </div>
      <button class="team-del" onclick="deleteTeam('${tid}')">🗑</button>
    </div>`;
  }).join('');
}

async function assignMemberTeam(uid, teamId) {
  await db.from('participants')
    .update({ team_id: teamId || null })
    .eq('event_id', S.event.id).eq('user_uid', uid);
}

function renderMembersList() {
  const el      = id('members-list');
  const entries = Object.entries(S.members);
  if (!entries.length) { el.innerHTML = '<p class="empty-hint">Noch niemand beigetreten.</p>'; return; }
  const teamOpts = Object.entries(S.teams).map(([tid, t]) => `<option value="${tid}">${esc(t.name)}</option>`).join('');
  el.innerHTML = entries.map(([uid, m]) => {
    const init   = (m.name || '?')[0].toUpperCase();
    const online = S.memberMarkers[uid] ? '🟢' : '⚪';
    const selVal = m.team_id || '';
    return `<div class="member-item">
      <div class="member-avatar">${init}</div>
      <div class="member-info">
        <div class="member-name">${online} ${esc(m.name)}${m.role === 'tc' ? ' 👑' : ''}</div>
        <div class="member-status">${m.team_id && S.teams[m.team_id] ? esc(S.teams[m.team_id].name) : 'Kein Team'}</div>
      </div>
      <select class="team-select" onchange="assignMemberTeam('${uid}', this.value)">
        <option value="">Team wählen</option>
        ${teamOpts.replace(`value="${selVal}"`, `value="${selVal}" selected`)}
      </select>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function id(i)  { return document.getElementById(i); }
function val(i) { return (id(i)?.value || '').trim(); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function copyText(t) {
  if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
  else legacyCopy(t);
}

function legacyCopy(t) {
  const el = Object.assign(document.createElement('textarea'), { value: t, style: 'position:fixed;opacity:0' });
  document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
}
