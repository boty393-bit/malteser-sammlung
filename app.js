'use strict';

const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

const COLORS = [
  '#E30613', '#1565C0', '#2E7D32', '#E65100',
  '#6A1B9A', '#00838F', '#558B2F', '#4527A0',
];
const SESSION_KEY = 'malt_user_session_v2';
const AUTO_PROGRESS_STREET = '__AUTO_PROGRESS__';
const AUTO_PROGRESS_MIN_DISTANCE_M = 35;
const ROLE_ORDER = { admin: 0, tc: 1, promoter: 2 };

const S = {
  dbUserId: null,
  user: null,
  event: null,
  map: null,
  drawHandler: null,
  isDrawing: false,
  isMarkMode: false,
  isPaused: false,
  locInterval: null,
  currentLat: null,
  currentLng: null,
  pendingMarkPos: null,
  teamLayers: {},
  memberMarkers: {},
  visitedMarkers: [],
  teams: {},
  users: {},
  ownMarker: null,
  lastAutoProgress: null,
  streetToastTimer: null,
  currentStreet: '',
  channels: [],
  requestedPassword: null,
};

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  showLoading('Verbinde...');
  try {
    await ensureDbSession();
    await ensureCurrentEvent();

    const restored = await restoreAppSession();
    hideLoading();

    if (restored) {
      enterApp();
      return;
    }

    showScreen('login');
  } catch (error) {
    console.error(error);
    setLoadingText('Verbindungsfehler - bitte Seite neu laden.');
  }
}

async function ensureDbSession() {
  let session = null;
  const current = await db.auth.getSession();
  session = current.data?.session || null;

  if (!session) {
    const created = await db.auth.signInAnonymously();
    session = created.data?.session || null;
  }

  if (!session?.user?.id) {
    throw userError('Supabase-Session konnte nicht aufgebaut werden.');
  }

  S.dbUserId = session.user.id;
}

async function ensureCurrentEvent() {
  const { data, error } = await db.from('events').select('*').order('created_at', { ascending: false }).limit(1);
  if (error) throw error;

  const row = data?.[0];
  if (row) {
    S.event = row;
    return;
  }

  const name = `Sammlung ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
  const created = await db.from('events')
    .insert({ name, code: genEventCode(), created_by: S.dbUserId })
    .select()
    .single();
  if (created.error) throw created.error;
  S.event = created.data;
}

async function restoreAppSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.userId) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }

    const row = await fetchPromoterById(parsed.userId);
    if (!row || !row.is_active) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }

    S.user = normalizeUser(row);
    return true;
  } catch (_) {
    localStorage.removeItem(SESSION_KEY);
    return false;
  }
}

function saveSession() {
  if (!S.user?.id) return;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: S.user.id }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const target = id(`screen-${name}`);
  if (target) target.classList.add('active');
}

function hideLoading() {
  id('loading').style.display = 'none';
}

function showLoading(message) {
  setLoadingText(message);
  id('loading').style.display = 'flex';
}

function setLoadingText(message) {
  id('loading-text').textContent = message;
}

function showToast(message) {
  const el = id('toast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(el._t);
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  el._t = setTimeout(() => {
    el.style.display = 'none';
  }, 2600);
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

function loginError(message) {
  const el = id('login-error');
  el.textContent = message;
  el.classList.toggle('visible', !!message);
}

function requestError(message) {
  const el = id('request-error');
  el.textContent = message;
  el.classList.toggle('visible', !!message);
}

async function handleLogin() {
  const badge = normalizeBadgeCode(val('input-badge'));
  const password = val('input-password');

  if (badge.length !== 4) {
    loginError('Bitte einen 4-stelligen Ausweiscode eingeben.');
    return;
  }
  if (!password) {
    loginError('Bitte den Anmeldecode eingeben.');
    return;
  }

  loginError('');
  showLoading('Melde an...');

  try {
    const row = await fetchPromoterByBadge(badge);
    if (!row) throw userError('Ausweiscode nicht gefunden.');
    if (!row.password_hash) throw userError('Fuer diesen Code ist noch kein Passwort eingerichtet.');
    if (!row.is_active) throw userError('Dieser Nutzer ist derzeit deaktiviert.');

    const passwordHash = await sha256(password);
    if (passwordHash !== row.password_hash) {
      throw userError('Anmeldecode stimmt nicht.');
    }

    S.user = normalizeUser(row);
    saveSession();

    id('input-password').value = '';
    hideLoading();
    enterApp();
  } catch (error) {
    hideLoading();
    loginError(readableError(error, 'Anmeldung fehlgeschlagen.'));
    if (!error?.userMessage) console.error(error);
  }
}

function openPasswordRequest() {
  S.requestedPassword = null;
  requestError('');
  id('request-result').style.display = 'none';
  id('request-result').innerHTML = '';
  id('request-badge').value = normalizeBadgeCode(id('input-badge').value);
  id('request-first-name').value = '';
  id('request-last-name').value = '';
  id('request-contact').value = '';
  id('request-modal').style.display = 'flex';
}

function closePasswordRequest() {
  id('request-modal').style.display = 'none';
}

async function submitPasswordRequest() {
  const badge = normalizeBadgeCode(val('request-badge'));
  const firstName = val('request-first-name');
  const lastName = val('request-last-name');
  const contact = val('request-contact');

  if (badge.length !== 4) {
    requestError('Bitte einen 4-stelligen Ausweiscode eingeben.');
    return;
  }
  if (!firstName) {
    requestError('Bitte den Vornamen eingeben.');
    return;
  }
  if (!lastName) {
    requestError('Bitte den Nachnamen eingeben.');
    return;
  }
  if (!contact) {
    requestError('Bitte E-Mail oder Telefonnummer eingeben.');
    return;
  }

  requestError('');
  showLoading('Erstelle Anmeldecode...');

  try {
    const existing = await fetchPromoterByBadge(badge);
    if (existing?.password_hash) {
      throw userError('Fuer diesen Ausweiscode ist bereits ein Passwort eingerichtet.');
    }

    const bootstrapAdmin = await shouldBootstrapAdmin(existing);
    const passwordCode = genPasswordCode(6);
    const payload = {
      badge_code: badge,
      first_name: firstName,
      last_name: lastName,
      contact_value: contact,
      contact_type: inferContactType(contact),
      password_hash: await sha256(passwordCode),
      role: existing?.role || (bootstrapAdmin ? 'admin' : 'promoter'),
      manager_user_id: existing?.manager_user_id || null,
      team_id: existing?.team_id || null,
      is_active: true,
      updated_at: nowIso(),
    };

    if (existing) {
      const { error } = await db.from('promoters').update(payload).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('promoters').insert(payload);
      if (error) throw error;
    }

    S.requestedPassword = { badge, passwordCode };
    id('input-badge').value = badge;
    id('input-password').value = passwordCode;
    renderPasswordResult(passwordCode, payload.role, bootstrapAdmin);
    hideLoading();
  } catch (error) {
    hideLoading();
    requestError(readableError(error, 'Passwort konnte nicht angelegt werden.'));
    if (!error?.userMessage) console.error(error);
  }
}

function renderPasswordResult(passwordCode, role, bootstrapAdmin) {
  const el = id('request-result');
  const roleText = roleLabel(role);
  el.innerHTML = `
    <div class="request-result-title">Dein Anmeldecode</div>
    <div class="request-code">${esc(passwordCode)}</div>
    <p>Mit diesem Code meldest du dich kuenftig zusammen mit deinem 4-stelligen Ausweiscode an.</p>
    <p>Rolle: <strong>${esc(roleText)}</strong>${bootstrapAdmin ? ' (erster Nutzer, automatisch als Admin angelegt)' : ''}</p>
    <button class="btn btn-primary btn-full" onclick="useRequestedPassword()">Code uebernehmen</button>
  `;
  el.style.display = 'block';
}

function useRequestedPassword() {
  if (!S.requestedPassword) return;
  id('input-badge').value = S.requestedPassword.badge;
  id('input-password').value = S.requestedPassword.passwordCode;
  closePasswordRequest();
  showToast('Code uebernommen. Jetzt anmelden.');
}

async function shouldBootstrapAdmin(existing) {
  if (existing?.role === 'admin') return true;

  const { count, error } = await db.from('promoters')
    .select('id', { head: true, count: 'exact' })
    .eq('role', 'admin')
    .eq('is_active', true);
  if (error) throw error;
  return (count || 0) === 0;
}

function enterApp() {
  showScreen('map');
  refreshShell();
  setMapStatus('Karte wird geladen...');

  if (!S.map) initMap();

  subscribeUsers();
  subscribeAreas();
  subscribeLocations();
  subscribeVisited();
  startLocTracking();

  window.removeEventListener('beforeunload', clearMyLoc);
  window.addEventListener('beforeunload', clearMyLoc);
}

function refreshShell() {
  id('event-name-display').textContent = S.event?.name || 'Sammlung';
  id('user-chip').textContent = `${S.user.first_name || S.user.firstName || ''} · ${roleLabel(S.user.role)}`;
  id('summary-event-name').textContent = S.event?.name || 'Sammlung';
  id('summary-role').textContent = summaryRoleText();
  id('manage-title').textContent = S.user.role === 'admin' ? 'Verwaltung' : 'Meine Nutzer';
  id('manage-subtitle').textContent = S.user.role === 'admin'
    ? 'Alle Nutzer, Teams und TC-Zuordnungen'
    : 'Nur die dir zugeordneten Nutzer und ihre Teams';
  id('users-section-title').textContent = S.user.role === 'admin' ? 'Alle Nutzer' : 'Meine Nutzer';

  id('admin-controls').style.display = S.user.role === 'admin' ? 'flex' : 'none';
  id('tc-controls').style.display = S.user.role === 'tc' ? 'flex' : 'none';
  id('member-controls').style.display = S.user.role === 'promoter' ? 'flex' : 'none';
  id('add-team-btn').style.display = S.user.role === 'admin' ? 'inline-flex' : 'none';

  const pauseBtn = id('btn-pause');
  pauseBtn.textContent = S.isPaused ? 'Weiter' : 'Pause';
  pauseBtn.classList.toggle('paused', S.isPaused);
}

function summaryRoleText() {
  if (S.user.role === 'admin') return 'Admin sieht alle Nutzer, erstellt Teams und ernennt TCs.';
  if (S.user.role === 'tc') return 'TC sieht nur die eigenen Nutzer und kann sie Teams zuweisen.';
  return `Promoter ${S.user.name} sammelt im zugewiesenen Gebiet.`;
}

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
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  });
  tiles.on('load', () => setMapStatus(''));
  tiles.on('tileerror', () => {
    setMapStatus('Kartendaten konnten nicht geladen werden. Bitte Seite neu laden.', true);
  });
  tiles.addTo(S.map);

  L.control.zoom({ position: 'topright' }).addTo(S.map);

  S.map.on('click', onMapClick);
  S.map.on(L.Draw.Event.CREATED, onPolygonDrawn);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      S.currentLat = pos.coords.latitude;
      S.currentLng = pos.coords.longitude;
      S.map.setView([S.currentLat, S.currentLng], 16);
      updateOwnMarker(S.currentLat, S.currentLng);
    }, null, { enableHighAccuracy: true, timeout: 8000 });
  }
}

function onMapClick(event) {
  if (!S.isMarkMode) return;
  S.pendingMarkPos = { lat: event.latlng.lat, lng: event.latlng.lng };
  openHousePopup('');
}

function startLocTracking() {
  fetchAndSendLoc();
  clearInterval(S.locInterval);
  S.locInterval = setInterval(fetchAndSendLoc, 30_000);
}

function fetchAndSendLoc() {
  if (S.isPaused || !navigator.geolocation || !S.user || !S.event) return;

  navigator.geolocation.getCurrentPosition(
    async pos => {
      S.currentLat = pos.coords.latitude;
      S.currentLng = pos.coords.longitude;
      updateOwnMarker(S.currentLat, S.currentLng);
      await sendMyLoc(S.currentLat, S.currentLng);
      await maybeAutoMarkProgress(S.currentLat, S.currentLng);
    },
    null,
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 25_000 }
  );
}

async function sendMyLoc(lat, lng) {
  if (S.isPaused || !S.user || !S.event) return;

  await db.from('locations').upsert({
    event_id: S.event.id,
    user_uid: S.user.id,
    lat,
    lng,
    name: S.user.name,
    role: S.user.role,
    team_id: S.user.teamId || null,
    is_paused: false,
    updated_at: nowIso(),
  }, { onConflict: 'event_id,user_uid' });
}

async function clearMyLoc() {
  if (!S.user || !S.event) return;
  await db.from('locations')
    .update({ is_paused: true, updated_at: nowIso() })
    .eq('event_id', S.event.id)
    .eq('user_uid', S.user.id);
}

function isAutoProgressRow(row) {
  return row?.street === AUTO_PROGRESS_STREET;
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const toRad = degrees => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && (point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

async function maybeAutoMarkProgress(lat, lng) {
  if (!S.event || !S.user || S.user.role !== 'promoter' || !S.user.teamId || S.isPaused) return;

  const team = S.teams[S.user.teamId];
  if (!team?.area_paths?.length) return;

  const point = { lat, lng };
  if (!pointInPolygon(point, team.area_paths)) return;

  const last = S.lastAutoProgress;
  if (last && last.teamId === S.user.teamId && distanceMeters(last, point) < AUTO_PROGRESS_MIN_DISTANCE_M) {
    return;
  }

  const row = {
    event_id: S.event.id,
    lat,
    lng,
    street: AUTO_PROGRESS_STREET,
    number: null,
    team_id: S.user.teamId || null,
    marked_by: S.user.id,
    marked_by_name: S.user.name,
  };

  const { error } = await db.from('visited').insert(row);
  if (error) {
    console.error(error);
    return;
  }

  S.lastAutoProgress = { lat, lng, teamId: S.user.teamId };
}

function updateOwnMarker(lat, lng) {
  if (!S.map || !S.user) return;
  const fillColor = S.user.role === 'promoter' ? '#1565C0' : '#333333';

  if (!S.ownMarker) {
    S.ownMarker = L.circleMarker([lat, lng], {
      radius: 10,
      fillColor,
      fillOpacity: 1,
      color: 'white',
      weight: 3,
      zIndexOffset: 1000,
    }).addTo(S.map).bindTooltip(`${S.user.name} (Ich)`, { permanent: false });
  } else {
    S.ownMarker.setLatLng([lat, lng]);
  }
}

function subscribeUsers() {
  loadUsers();
  const ch = db.channel('promoters-directory')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'promoters',
    }, () => {
      loadUsers();
    })
    .subscribe();
  S.channels.push(ch);
}

async function loadUsers() {
  const { data, error } = await db.from('promoters').select('*');
  if (error) {
    console.error(error);
    return;
  }

  S.users = {};
  (data || []).forEach(row => {
    S.users[row.id] = row;
  });

  if (S.user) {
    const fresh = S.users[S.user.id];
    if (!fresh) {
      clearSession();
      window.location.reload();
      return;
    }
    S.user = normalizeUser(fresh);
    saveSession();
    refreshShell();
  }

  renderManagePanel();
  if (S.map) loadLocations();
}

function subscribeLocations() {
  loadLocations();
  const ch = db.channel(`loc-${S.event.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'locations',
      filter: `event_id=eq.${S.event.id}`,
    }, payload => {
      const row = payload.new || payload.old;
      if (!row) return;
      handleLocationRow(row);
    })
    .subscribe();
  S.channels.push(ch);
}

async function loadLocations() {
  if (!S.event) return;

  const staleISO = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data, error } = await db.from('locations').select('*')
    .eq('event_id', S.event.id)
    .eq('is_paused', false)
    .gte('updated_at', staleISO);
  if (error) {
    console.error(error);
    return;
  }

  Object.keys(S.memberMarkers).forEach(removeMemberMarker);

  (data || []).forEach(row => {
    if (row.user_uid !== S.user.id) handleLocationRow(row);
  });
}

function handleLocationRow(row) {
  if (!row || row.user_uid === S.user.id) return;

  if (!canSeeUser(row.user_uid)) {
    removeMemberMarker(row.user_uid);
    return;
  }

  const stale = Date.now() - new Date(row.updated_at).getTime() > 6 * 60 * 1000;
  if (row.is_paused || stale) {
    removeMemberMarker(row.user_uid);
    return;
  }

  upsertMemberMarker(row.user_uid, row);
}

function subscribeAreas() {
  loadAreas();
  const ch = db.channel(`teams-${S.event.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'teams',
      filter: `event_id=eq.${S.event.id}`,
    }, () => loadAreas())
    .subscribe();
  S.channels.push(ch);
}

async function loadAreas() {
  const { data, error } = await db.from('teams').select('*').eq('event_id', S.event.id);
  if (error) {
    console.error(error);
    return;
  }

  S.teams = {};
  (data || []).forEach(row => {
    S.teams[row.id] = row;
  });

  Object.values(S.teamLayers).forEach(layer => layer.remove());
  S.teamLayers = {};

  sortedTeams().forEach(team => {
    if (team.area_paths?.length) drawArea(team);
  });

  renderManagePanel();
}

function subscribeVisited() {
  loadVisited();
  const ch = db.channel(`visited-${S.event.id}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'visited',
      filter: `event_id=eq.${S.event.id}`,
    }, payload => {
      if (!payload.new) return;
      addVisitedMarker(payload.new);
      if (isAutoProgressRow(payload.new) && payload.new.marked_by === S.user.id) {
        S.lastAutoProgress = {
          lat: payload.new.lat,
          lng: payload.new.lng,
          teamId: payload.new.team_id || null,
        };
      }
    })
    .subscribe();
  S.channels.push(ch);
}

async function loadVisited() {
  const { data, error } = await db.from('visited').select('*').eq('event_id', S.event.id);
  if (error) {
    console.error(error);
    return;
  }

  S.visitedMarkers.forEach(marker => marker.remove());
  S.visitedMarkers = [];

  let lastOwnAuto = null;
  (data || []).forEach(row => {
    addVisitedMarker(row);
    if (isAutoProgressRow(row) && row.marked_by === S.user.id) {
      if (!lastOwnAuto || new Date(row.created_at) > new Date(lastOwnAuto.created_at)) {
        lastOwnAuto = row;
      }
    }
  });

  S.lastAutoProgress = lastOwnAuto
    ? { lat: lastOwnAuto.lat, lng: lastOwnAuto.lng, teamId: lastOwnAuto.team_id || null }
    : null;
}

function canSeeUser(userId) {
  if (!S.user) return false;
  if (userId === S.user.id) return true;
  if (S.user.role === 'admin') return true;
  if (S.user.role === 'tc') return S.users[userId]?.manager_user_id === S.user.id;
  return false;
}

function canManageUser(user) {
  if (!S.user || !user) return false;
  if (S.user.role === 'admin') return true;
  if (S.user.role === 'tc') return user.role === 'promoter' && user.manager_user_id === S.user.id;
  return false;
}

function canDrawAreas() {
  return S.user?.role === 'admin' || S.user?.role === 'tc';
}

function memberIcon(name, color) {
  const initial = initials(name);
  return L.divIcon({
    className: '',
    html: `<div style="
      width:30px;
      height:30px;
      background:${color};
      border:3px solid white;
      border-radius:50%;
      display:flex;
      align-items:center;
      justify-content:center;
      color:white;
      font-weight:700;
      font-size:12px;
      box-shadow:0 2px 8px rgba(0,0,0,.35);
    ">${esc(initial)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function upsertMemberMarker(userId, row) {
  if (!S.map) return;

  const directoryUser = S.users[userId];
  const name = directoryUser ? displayNameFromRow(directoryUser) : (row.name || 'Nutzer');
  const role = directoryUser?.role || row.role || 'promoter';
  const teamId = directoryUser?.team_id || row.team_id || null;
  const color = role === 'promoter' ? teamColor(teamId) : '#333333';

  if (!S.memberMarkers[userId]) {
    const marker = L.marker([row.lat, row.lng], {
      icon: memberIcon(name, color),
      zIndexOffset: role === 'promoter' ? 800 : 900,
    }).addTo(S.map)
      .bindTooltip(`${name}${role === 'tc' ? ' (TC)' : role === 'admin' ? ' (Admin)' : ''}`, { direction: 'top' });
    S.memberMarkers[userId] = marker;
  } else {
    S.memberMarkers[userId].setLatLng([row.lat, row.lng]);
  }
}

function removeMemberMarker(userId) {
  if (!S.memberMarkers[userId]) return;
  S.memberMarkers[userId].remove();
  delete S.memberMarkers[userId];
}

function sortedTeams() {
  return Object.values(S.teams).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}

function teamColor(teamId) {
  const teams = sortedTeams();
  const index = teams.findIndex(team => team.id === teamId);
  return COLORS[(index < 0 ? 0 : index) % COLORS.length];
}

function drawArea(team) {
  const color = teamColor(team.id);
  const isMine = S.user.teamId === team.id;
  const latLngs = team.area_paths.map(point => [point.lat, point.lng]);

  const polygon = L.polygon(latLngs, {
    color,
    weight: isMine ? 3 : 2,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: isMine ? 0.2 : 0.07,
    interactive: false,
  }).addTo(S.map);
  polygon.bindTooltip(team.name, { sticky: true });
  S.teamLayers[team.id] = polygon;
}

function toggleDrawing() {
  if (!canDrawAreas()) return;

  if (S.isDrawing) {
    if (S.drawHandler) {
      S.drawHandler.disable();
      S.drawHandler = null;
    }
    S.isDrawing = false;
    setDrawButtonsActive(false);
    return;
  }

  S.drawHandler = new L.Draw.Polygon(S.map, {
    shapeOptions: {
      color: '#E30613',
      fillColor: '#E30613',
      fillOpacity: 0.15,
      weight: 2,
    },
    showArea: false,
  });
  S.drawHandler.enable();
  S.isDrawing = true;
  setDrawButtonsActive(true);
  showToast('Punkte setzen, dann doppelklicken zum Abschliessen.');
}

function setDrawButtonsActive(active) {
  ['btn-draw', 'btn-draw-tc'].forEach(key => {
    const button = id(key);
    if (button) button.classList.toggle('active', active);
  });
}

function onPolygonDrawn(event) {
  S.isDrawing = false;
  setDrawButtonsActive(false);

  const latLngs = event.layer.getLatLngs()[0];
  const paths = latLngs.map(point => ({ lat: point.lat, lng: point.lng }));
  event.layer.remove();
  assignAreaToTeam(paths);
}

function assignAreaToTeam(paths) {
  const teams = sortedTeams();
  if (!teams.length) {
    showToast('Zuerst muss ein Team angelegt werden.');
    return;
  }

  const options = teams.map((team, index) => `${index + 1}: ${team.name}`).join('\n');
  const input = prompt(`Welchem Team gehoert dieses Gebiet?\n\n${options}\n\nNummer eingeben:`);
  if (!input) return;

  const index = parseInt(input, 10) - 1;
  if (index < 0 || index >= teams.length) {
    showToast('Team-Auswahl ungueltig.');
    return;
  }

  db.from('teams')
    .update({ area_paths: paths })
    .eq('id', teams[index].id)
    .then(({ error }) => {
      if (error) {
        console.error(error);
        showToast('Gebiet konnte nicht gespeichert werden.');
        return;
      }
      showToast('Gebiet gespeichert.');
    });
}

function addVisitedMarker(row) {
  if (!S.map) return;

  const isAuto = isAutoProgressRow(row);
  const label = isAuto ? '' : [row.street, row.number].filter(Boolean).join(' ');
  const time = new Date(row.created_at).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const marker = L.circleMarker([row.lat, row.lng], isAuto ? {
    radius: 16,
    fillColor: '#2E7D32',
    fillOpacity: 0.14,
    color: '#2E7D32',
    weight: 1,
    opacity: 0.55,
    zIndexOffset: 300,
  } : {
    radius: 8,
    fillColor: '#2E7D32',
    fillOpacity: 0.9,
    color: 'white',
    weight: 2,
    zIndexOffset: 500,
  }).addTo(S.map);

  marker.bindPopup(
    isAuto
      ? `<small style="color:#777">Automatisch markiert ${time} · ${esc(row.marked_by_name || '')}</small>`
      : `${label ? `<strong>${esc(label)}</strong><br>` : ''}<small style="color:#777">Besucht ${time} · ${esc(row.marked_by_name || '')}</small>`
  );
  S.visitedMarkers.push(marker);
}

function toggleMarkMode() {
  if (S.user.role !== 'promoter') return;

  S.isMarkMode = !S.isMarkMode;
  id('btn-mark').classList.toggle('active', S.isMarkMode);
  id('mark-hint').style.display = S.isMarkMode ? 'flex' : 'none';
  if (S.map) S.map.getContainer().style.cursor = S.isMarkMode ? 'crosshair' : '';
  if (!S.isMarkMode) closeHousePopup();
}

function openHousePopup(street) {
  id('house-street-input').value = street || '';
  id('house-number-input').value = '';
  id('house-popup').style.display = 'flex';
  setTimeout(() => id('house-street-input').focus(), 80);
}

function closeHousePopup() {
  id('house-popup').style.display = 'none';
  S.pendingMarkPos = null;
}

function cancelHouseMark() {
  closeHousePopup();
}

async function confirmHouseMark() {
  if (!S.pendingMarkPos) return;

  const street = id('house-street-input').value.trim();
  const number = id('house-number-input').value.trim();
  const { lat, lng } = S.pendingMarkPos;

  const { error } = await db.from('visited').insert({
    event_id: S.event.id,
    lat,
    lng,
    street: street || null,
    number: number || null,
    team_id: S.user.teamId || null,
    marked_by: S.user.id,
    marked_by_name: S.user.name,
  });

  if (error) {
    console.error(error);
    showToast('Fehler beim Speichern.');
    return;
  }

  closeHousePopup();
  if (street) showStreetToast(`${street}${number ? ` ${number}` : ''}`);
  showToast('Haus markiert.');
}

function showStreetToast(name) {
  S.currentStreet = name;
  id('street-name-text').textContent = name;
  id('street-toast').style.display = 'flex';
  clearTimeout(S.streetToastTimer);
  S.streetToastTimer = setTimeout(hideStreetToast, 12_000);
}

function hideStreetToast() {
  id('street-toast').style.display = 'none';
}

function copyStreetName() {
  if (!S.currentStreet) return;
  copyText(S.currentStreet);
  showToast('Strassenname kopiert.');
}

function togglePause() {
  S.isPaused = !S.isPaused;

  if (S.isPaused) {
    clearMyLoc();
    id('pause-overlay').style.display = 'flex';
  } else {
    id('pause-overlay').style.display = 'none';
    fetchAndSendLoc();
  }

  refreshShell();
}

function sharePickupLocation() {
  if (!S.currentLat || !S.currentLng) {
    showToast('Standort wird noch ermittelt.');
    return;
  }

  const url = `https://maps.google.com/maps?q=${S.currentLat},${S.currentLng}`;
  const text = `Abholort:\n${url}`;
  if (navigator.share) {
    navigator.share({ title: 'Abholort', text, url }).catch(() => {});
    return;
  }

  copyText(text);
  showToast('Abholort-Link kopiert.');
}

function centerOnMe() {
  if (!S.currentLat || !S.currentLng || !S.map) {
    showToast('Standort wird noch ermittelt.');
    return;
  }
  S.map.setView([S.currentLat, S.currentLng], 17);
}

function centerOnAll() {
  if (!S.map) return;

  const points = [];
  Object.values(S.teamLayers).forEach(layer => {
    layer.getLatLngs()[0].forEach(point => points.push(point));
  });
  Object.values(S.memberMarkers).forEach(marker => points.push(marker.getLatLng()));
  if (S.ownMarker) points.push(S.ownMarker.getLatLng());

  if (points.length) {
    S.map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
  }
}

function openManagePanel() {
  if (S.user.role !== 'admin' && S.user.role !== 'tc') return;
  renderManagePanel();
  id('manage-panel').classList.add('open');
  id('backdrop').style.display = 'block';
}

function closeManagePanel() {
  id('manage-panel').classList.remove('open');
  id('backdrop').style.display = 'none';
}

function closeAllPanels() {
  closeManagePanel();
}

function renderManagePanel() {
  if (!S.user || (S.user.role !== 'admin' && S.user.role !== 'tc')) return;
  renderTeamsList();
  renderUsersList();
}

async function createTeam(name) {
  const { data, error } = await db.from('teams')
    .insert({ event_id: S.event.id, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function addTeam() {
  if (S.user.role !== 'admin') return;
  const name = prompt('Team-Name eingeben:');
  if (!name?.trim()) return;

  createTeam(name.trim())
    .then(() => showToast('Team erstellt.'))
    .catch(error => {
      console.error(error);
      showToast('Team konnte nicht erstellt werden.');
    });
}

async function deleteTeam(teamId) {
  if (S.user.role !== 'admin') return;
  if (!confirm('Team und zugewiesenes Gebiet wirklich loeschen?')) return;

  const timestamp = nowIso();
  try {
    await db.from('promoters').update({ team_id: null, updated_at: timestamp }).eq('team_id', teamId);
    await db.from('locations').update({ team_id: null, updated_at: timestamp }).eq('event_id', S.event.id).eq('team_id', teamId);
    const { error } = await db.from('teams').delete().eq('id', teamId);
    if (error) throw error;
    showToast('Team geloescht.');
  } catch (error) {
    console.error(error);
    showToast('Team konnte nicht geloescht werden.');
  }
}

function renderTeamsList() {
  const el = id('teams-list');
  const teams = sortedTeams();

  if (!teams.length) {
    el.innerHTML = '<p class="empty-hint">Noch keine Teams.</p>';
    return;
  }

  el.innerHTML = teams.map((team, index) => {
    const color = COLORS[index % COLORS.length];
    const visibleCount = visibleUsersForManagement().filter(user => user.team_id === team.id).length;
    const areaState = team.area_paths?.length ? 'Gebiet vorhanden' : 'Kein Gebiet';
    const deleteButton = S.user.role === 'admin'
      ? `<button class="team-del" onclick="deleteTeam('${team.id}')">Loeschen</button>`
      : '';

    return `<div class="team-item">
      <div class="team-dot" style="background:${color}"></div>
      <div class="team-info">
        <div class="team-name">${esc(team.name)}</div>
        <div class="team-sub">${esc(areaState)} · ${visibleCount} sichtbare Nutzer</div>
      </div>
      ${deleteButton}
    </div>`;
  }).join('');
}

function renderUsersList() {
  const el = id('users-list');
  const users = visibleUsersForManagement();

  if (!users.length) {
    el.innerHTML = '<p class="empty-hint">Noch keine Nutzer sichtbar.</p>';
    return;
  }

  const teamOptions = sortedTeams()
    .map(team => `<option value="${team.id}">${esc(team.name)}</option>`)
    .join('');
  const tcOptions = sortedUsers(Object.values(S.users).filter(user => user.role === 'tc'))
    .map(user => `<option value="${user.id}">${esc(displayNameFromRow(user))}</option>`)
    .join('');

  el.innerHTML = users.map(user => {
    const teamName = user.team_id && S.teams[user.team_id] ? S.teams[user.team_id].name : 'Kein Team';
    const managerName = user.manager_user_id && S.users[user.manager_user_id]
      ? displayNameFromRow(S.users[user.manager_user_id])
      : 'Kein TC';
    const onlineLabel = isUserOnline(user.id) ? 'Online' : 'Offline';
    const disableSelfRole = user.id === S.user.id ? 'disabled' : '';
    const roleSelect = S.user.role === 'admin'
      ? `<div class="field-inline">
          <label>Rolle</label>
          <select class="team-select" onchange="changeUserRole('${user.id}', this.value)" ${disableSelfRole}>
            ${roleOption('promoter', user.role)}
            ${roleOption('tc', user.role)}
            ${roleOption('admin', user.role)}
          </select>
        </div>`
      : '';
    const managerSelect = S.user.role === 'admin'
      ? `<div class="field-inline">
          <label>TC</label>
          <select class="team-select" onchange="changeUserManager('${user.id}', this.value)" ${user.role !== 'promoter' ? 'disabled' : ''}>
            <option value="">Kein TC</option>
            ${selectWithValue(tcOptions, user.manager_user_id || '')}
          </select>
        </div>`
      : '';
    const allowTeamChange = S.user.role === 'admin' || canManageUser(user);
    const teamSelect = `<div class="field-inline">
        <label>Team</label>
        <select class="team-select" onchange="changeUserTeam('${user.id}', this.value)" ${allowTeamChange ? '' : 'disabled'}>
          <option value="">Kein Team</option>
          ${selectWithValue(teamOptions, user.team_id || '')}
        </select>
      </div>`;

    return `<div class="member-item user-item">
      <div class="member-avatar">${esc(initials(displayNameFromRow(user)))}</div>
      <div class="member-info">
        <div class="member-name">
          ${esc(displayNameFromRow(user))}
          <span class="meta-pill">${esc(roleLabel(user.role))}</span>
          <span class="meta-pill ${isUserOnline(user.id) ? 'is-online' : ''}">${esc(onlineLabel)}</span>
        </div>
        <div class="member-status">Code ${esc(user.badge_code)} · ${esc(user.contact_value || 'Kein Kontakt')}</div>
        <div class="member-status">Team: ${esc(teamName)} · TC: ${esc(managerName)}</div>
      </div>
      <div class="user-actions">
        ${roleSelect}
        ${managerSelect}
        ${teamSelect}
      </div>
    </div>`;
  }).join('');
}

function visibleUsersForManagement() {
  const all = Object.values(S.users);
  if (S.user.role === 'admin') return sortedUsers(all);
  if (S.user.role === 'tc') return sortedUsers(all.filter(user => user.manager_user_id === S.user.id));
  return [];
}

function sortedUsers(users) {
  return [...users].sort((a, b) => {
    const roleDiff = (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    const lastDiff = (a.last_name || '').localeCompare(b.last_name || '', 'de');
    if (lastDiff !== 0) return lastDiff;
    return (a.first_name || '').localeCompare(b.first_name || '', 'de');
  });
}

function roleOption(value, current) {
  return `<option value="${value}" ${value === current ? 'selected' : ''}>${esc(roleLabel(value))}</option>`;
}

function selectWithValue(optionsHtml, value) {
  if (!value) return optionsHtml;
  return optionsHtml.replace(`value="${value}"`, `value="${value}" selected`);
}

async function changeUserRole(userId, nextRole) {
  if (S.user.role !== 'admin') return;
  if (userId === S.user.id) {
    showToast('Die eigene Rolle bleibt fixiert.');
    renderUsersList();
    return;
  }

  const current = S.users[userId];
  if (!current) return;

  const patch = { role: nextRole };
  if (nextRole !== 'promoter') patch.manager_user_id = null;

  showLoading('Speichere Rolle...');
  try {
    await updatePromoter(userId, patch);
    await syncLocationProfile(userId, patch);

    if (current.role === 'tc' && nextRole !== 'tc') {
      await db.from('promoters')
        .update({ manager_user_id: null, updated_at: nowIso() })
        .eq('manager_user_id', userId);
    }

    hideLoading();
    showToast('Rolle gespeichert.');
    await loadUsers();
  } catch (error) {
    hideLoading();
    console.error(error);
    showToast('Rolle konnte nicht gespeichert werden.');
    renderUsersList();
  }
}

async function changeUserManager(userId, managerId) {
  if (S.user.role !== 'admin') return;

  const user = S.users[userId];
  if (!user || user.role !== 'promoter') return;
  if (managerId === userId) {
    showToast('Ein Nutzer kann nicht sich selbst als TC haben.');
    renderUsersList();
    return;
  }
  if (managerId && S.users[managerId]?.role !== 'tc') {
    showToast('Zugewiesener Nutzer ist kein TC.');
    renderUsersList();
    return;
  }

  try {
    await updatePromoter(userId, { manager_user_id: managerId || null });
    showToast('TC-Zuordnung gespeichert.');
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast('TC-Zuordnung konnte nicht gespeichert werden.');
    renderUsersList();
  }
}

async function changeUserTeam(userId, teamId) {
  const user = S.users[userId];
  if (!user) return;

  if (S.user.role !== 'admin' && !canManageUser(user)) {
    renderUsersList();
    return;
  }

  const patch = { team_id: teamId || null };

  try {
    await updatePromoter(userId, patch);
    await syncLocationProfile(userId, patch);
    showToast('Team gespeichert.');
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast('Team konnte nicht gespeichert werden.');
    renderUsersList();
  }
}

async function updatePromoter(userId, patch) {
  const { error } = await db.from('promoters')
    .update({ ...patch, updated_at: nowIso() })
    .eq('id', userId);
  if (error) throw error;
}

async function syncLocationProfile(userId, patch = {}) {
  const current = S.users[userId];
  if (!current || !S.event) return;
  const merged = { ...current, ...patch };

  await db.from('locations').update({
    name: displayNameFromRow(merged),
    role: merged.role,
    team_id: merged.team_id || null,
    updated_at: nowIso(),
  }).eq('event_id', S.event.id).eq('user_uid', userId);
}

function isUserOnline(userId) {
  if (userId === S.user.id) return !!S.ownMarker && !S.isPaused;
  return !!S.memberMarkers[userId];
}

async function logout() {
  clearSession();
  try {
    await clearMyLoc();
  } catch (_) {
    // ignore
  }
  window.location.reload();
}

async function fetchPromoterByBadge(badgeCode) {
  const { data, error } = await db.from('promoters').select('*').eq('badge_code', badgeCode).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function fetchPromoterById(userId) {
  const { data, error } = await db.from('promoters').select('*').eq('id', userId).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

function normalizeUser(row) {
  return {
    id: row.id,
    uid: row.id,
    badgeCode: row.badge_code,
    firstName: row.first_name,
    first_name: row.first_name,
    lastName: row.last_name,
    last_name: row.last_name,
    name: displayNameFromRow(row),
    role: row.role || 'promoter',
    teamId: row.team_id || null,
    managerUserId: row.manager_user_id || null,
    contact: row.contact_value || '',
    contactType: row.contact_type || 'email',
  };
}

function displayNameFromRow(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Unbekannt';
}

function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'tc') return 'TC';
  return 'Promoter';
}

function normalizeBadgeCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function inferContactType(value) {
  return String(value).includes('@') ? 'email' : 'phone';
}

function nowIso() {
  return new Date().toISOString();
}

function genEventCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function genPasswordCode(length) {
  const bytes = new Uint32Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => String(value % 10)).join('');
}

async function sha256(text) {
  const input = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function userError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

function readableError(error, fallback) {
  return error?.userMessage || fallback;
}

function id(key) {
  return document.getElementById(key);
}

function val(key) {
  return (id(key)?.value || '').trim();
}

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    return;
  }
  legacyCopy(text);
}

function legacyCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}
