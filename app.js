import { firebaseConfig, FALLBACK_ADMIN_UIDS } from './firebase-config.js';

// Firebase SDK v10 (modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc,
  query, where, onSnapshot, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Init Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// UI elements
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('userInfo');
const userName = document.getElementById('userName');
const userUid = document.getElementById('userUid');
const userAvatar = document.getElementById('userAvatar');
const adminLink = document.getElementById('adminLink');

const addPlaceBtn = document.getElementById('addPlaceBtn');
const modalAdd = document.getElementById('modalAdd');
const closeModalAdd = document.getElementById('closeModalAdd');
const cancelAdd = document.getElementById('cancelAdd');
const addPlaceForm = document.getElementById('addPlaceForm');
const addStatus = document.getElementById('addStatus');

const placeName = document.getElementById('placeName');
const placeDescription = document.getElementById('placeDescription');
const placeSecurity = document.getElementById('placeSecurity');
const placeAccess = document.getElementById('placeAccess');
const placeLoot = document.getElementById('placeLoot');
const placeLat = document.getElementById('placeLat');
const placeLng = document.getElementById('placeLng');

const filterAccess = document.getElementById('filterAccess');
const filterSecurity = document.getElementById('filterSecurity');
const toggleOSM = document.getElementById('toggleOSM');
const onlyFavorites = document.getElementById('onlyFavorites');
const searchInput = document.getElementById('searchInput');
const placesList = document.getElementById('placesList');

// Favorites UI
const openFavoritesBtn = document.getElementById('openFavorites');
const favoritesModal = document.getElementById('favoritesModal');
const closeFavoritesBtn = document.getElementById('closeFavorites');
const favoritesPlacesListEl = document.getElementById('favoritesPlacesList');
const favoritesOsmListEl = document.getElementById('favoritesOsmList');
const favoritesCountBadge = document.getElementById('favoritesCount');

// State
let currentUser = null;
let isAdmin = false;
let unsubApproved = null;
let unsubMine = null;
let unsubFavorites = null;
let unsubFavoritesOSM = null;
let unsubOsmModeration = null;

let clearRouteControl;

const markersMap = new Map(); // placeId -> marker (наши)
const favoritesSet = new Set(); // placeId
const favoritesOsmSet = new Set(); // "node-123" | "way-456"
const osmMarkersMap = new Map(); // osmId -> marker (динамические OSM)
const favoritePlacesCache = new Map(); // placeId -> data|null
const favoritesOsmMap = new Map();     // osmId -> fav data

// OSM moderation
const osmModerationMap = new Map(); // osmId -> { status, note, overrides, lat, lng, baseName, type, tagsSnapshot, updatedAt... }

// Одобренные OSM всегда на карте
let osmVerifiedLayer;                     // всегда добавлен
const osmVerifiedMarkersMap = new Map();  // osmId -> marker

let map, routingControl, placesLayer, osmLayer, tempAddMarker = null;

// Константы
const SECURITY_OPTIONS = ['none','low','medium','high'];
const ACCESS_OPTIONS = ['open','partial','closed'];

// Helpers: route clear/show button
function updateClearRouteBtn() {
  if (clearRouteControl && clearRouteControl._btn) {
    clearRouteControl._btn.style.display = routingControl ? 'block' : 'none';
  }
}
function clearRoute() {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  updateClearRouteBtn();
}

// Initialize map
function initMap() {
  map = L.map('map').setView([55.751244, 37.618423], 10);
  const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });
  tile.addTo(map);

  placesLayer = L.layerGroup().addTo(map);
  osmLayer = L.layerGroup();                // динамические OSM (по тумблеру)
  osmVerifiedLayer = L.layerGroup().addTo(map); // verified OSM (всегда на карте)

  // Добавление по ПКМ
  map.on('contextmenu', (e) => {
    try { L.DomEvent.preventDefault(e.originalEvent); } catch(_) {}
    if (!currentUser) { alert('Чтобы добавить объект, войдите в аккаунт'); return; }
    if (modalAdd?.classList.contains('hidden')) openAddModal();
    placeLat.value = e.latlng.lat.toFixed(6);
    placeLng.value = e.latlng.lng.toFixed(6);
    if (tempAddMarker) {
      tempAddMarker.setLatLng(e.latlng);
    } else {
      tempAddMarker = L.marker(e.latlng, { draggable: true }).addTo(map);
      tempAddMarker.on('dragend', () => {
        const { lat, lng } = tempAddMarker.getLatLng();
        placeLat.value = lat.toFixed(6);
        placeLng.value = lng.toFixed(6);
      });
    }
  });

  // Locate
  L.control.locate = function() {
    const control = L.control({position: 'topleft'});
    control.onAdd = function() {
      const btn = L.DomUtil.create('a', 'leaflet-bar');
      btn.href = '#';
      btn.title = 'Моё местоположение';
      btn.innerHTML = '📍';
      btn.style.padding = '6px 8px';
      btn.style.background = '#fff';
      L.DomEvent.on(btn, 'click', (ev) => {
        ev.preventDefault();
        if (!navigator.geolocation) { alert('Геолокация недоступна'); return; }
        navigator.geolocation.getCurrentPosition(pos => {
          const latlng = [pos.coords.latitude, pos.coords.longitude];
          map.setView(latlng, 14);
          L.circleMarker(latlng, {radius:6, color:'#00c389'}).addTo(map);
        }, () => alert('Не удалось получить геолокацию'));
      });
      return btn;
    };
    return control;
  };
  L.control.locate().addTo(map);

  // Clear route control
  clearRouteControl = L.control({position:'topleft'});
  clearRouteControl.onAdd = function() {
    const btn = L.DomUtil.create('a', 'leaflet-bar');
    btn.href = '#';
    btn.title = 'Сбросить маршрут (Esc)';
    btn.innerHTML = '✖';
    btn.style.padding = '6px 10px';
    btn.style.background = '#fff';
    btn.style.display = 'none';
    L.DomEvent.on(btn, 'click', (e) => { e.preventDefault(); clearRoute(); });
    this._btn = btn;
    return btn;
  };
  clearRouteControl.addTo(map);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearRoute(); });

  // OSM toggle
  if (toggleOSM) {
    toggleOSM.addEventListener('change', () => {
      if (toggleOSM.checked) {
        map.addLayer(osmLayer);
        fetchOSMByView();
      } else {
        map.removeLayer(osmLayer);
        osmLayer.clearLayers();
        osmMarkersMap.clear();
        renderUnifiedList(); // обновим общий список
      }
    });
  }
  map.on('moveend', () => { if (toggleOSM?.checked) throttleFetchOSM(); });
}

initMap();

// UI helpers
function makeDivIcon(color='#ff3b3b') {
  const html = `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>`;
  return L.divIcon({ className: 'custom-div-icon', html, iconSize: [18,18], iconAnchor:[9,9] });
}
function parseLoot(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
}

// ---- Наши места ----
function placeMatchesFilters(place) {
  const byAccess = !filterAccess?.value || place.access === filterAccess.value;
  const bySec = !filterSecurity?.value || place.security === filterSecurity.value;
  const queryText = (searchInput?.value || '').toLowerCase();
  const bySearch = !queryText || (place.name?.toLowerCase().includes(queryText) || place.description?.toLowerCase().includes(queryText));
  const byFav = !onlyFavorites?.checked || favoritesSet.has(place.id);
  return byAccess && bySec && bySearch && byFav;
}
function renderPlaceItem(place) {
  const el = document.createElement('div');
  el.className = 'place-item';
  el.dataset.id = place.id;

  const statusBadge = place.status === 'approved' ? '<span class="badge approved">одобрено</span>' :
                      place.status === 'pending' ? '<span class="badge pending">на модерации</span>' :
                      '<span class="badge rejected">отклонено</span>';

  const lootText = (place.loot && place.loot.length) ? ` • лут: ${place.loot.join(', ')}` : '';
  el.innerHTML = `
    <h4>${place.name} ${statusBadge}</h4>
    <div class="place-meta">${place.access} • охрана: ${place.security}${lootText}</div>
    <div class="place-actions">
      <button type="button" data-action="fly">Показать на карте</button>
      <button type="button" data-action="route">Маршрут</button>
      <button type="button" data-action="favorite">${favoritesSet.has(place.id) ? '★ В избранном' : '☆ В избранное'}</button>
      ${ (currentUser && (place.createdBy === currentUser.uid || isAdmin)) ? '<button type="button" data-action="delete" class="danger">Удалить</button>' : '' }
    </div>
  `;
  el.querySelector('[data-action="fly"]').addEventListener('click', () => map.setView([place.lat, place.lng], 16));
  el.querySelector('[data-action="route"]').addEventListener('click', () => startRoutingTo([place.lat, place.lng]));
  el.querySelector('[data-action="favorite"]').addEventListener('click', () => toggleFavorite(place.id));
  const delBtn = el.querySelector('[data-action="delete"]');
  if (delBtn) delBtn.addEventListener('click', () => deletePlace(place.id));
  return el;
}
function upsertMarker(place) {
  const color = place.status === 'approved' ? '#ff3b3b' : (place.status === 'pending' ? '#ff8a00' : '#555');
  const icon = makeDivIcon(color);
  let marker = markersMap.get(place.id);
  if (!marker) {
    marker = L.marker([place.lat, place.lng], { icon });
    markersMap.set(place.id, marker);
    marker.addTo(placesLayer);
  } else {
    marker.setLatLng([place.lat, place.lng]);
    marker.setIcon(icon);
  }
  const favTxt = favoritesSet.has(place.id) ? '★ Убрать из избранного' : '☆ В избранное';
  const photosHtml = (place.photos && place.photos.length)
    ? `<div class="gallery">${place.photos.map(u => `<img src="${u}" loading="lazy" />`).join('')}</div>` : '';
  const popupHtml = `
    <b>${place.name}</b><br/>
    <small>${place.access} • охрана: ${place.security}</small><br/>
    <div>${(place.description || '').replace(/\n/g,'<br/>')}</div>
    ${photosHtml}
    <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="pm-route">Маршрут</button>
      <button type="button" class="pm-fav" data-id="${place.id}">${favTxt}</button>
      ${ (currentUser && (place.createdBy === currentUser?.uid || isAdmin)) ? '<button type="button" class="pm-del">Удалить</button>' : '' }
      <a href="https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=18/${place.lat}/${place.lng}" target="_blank">OSM</a>
    </div>
  `;
  marker.bindPopup(popupHtml);
  marker.off('popupopen');
  marker.on('popupopen', () => {
    const node = marker.getPopup().getElement();
    node.querySelector('.pm-route').addEventListener('click', () => startRoutingTo([place.lat, place.lng]));
    node.querySelector('.pm-fav').addEventListener('click', () => toggleFavorite(place.id));
    const del = node.querySelector('.pm-del');
    if (del) del.addEventListener('click', () => deletePlace(place.id));
  });
  marker._placeData = place;
  applyFiltersToMarker(marker);
}
function applyFilters() {
  // Маркеры "наших"
  markersMap.forEach(marker => applyFiltersToMarker(marker));
  refreshOpenPopupsFavoritesUI();
  renderUnifiedList(); // общий список
}
function applyFiltersToMarker(marker) {
  const p = marker._placeData;
  if (!p) return;
  const visible = placeMatchesFilters(p);
  if (visible) { if (!placesLayer.hasLayer(marker)) marker.addTo(placesLayer); marker.getElement()?.classList.remove('hidden'); }
  else { placesLayer.removeLayer(marker); }
}

// ---- Favorites (places) UI helpers ----
function refreshOpenPopupsFavoritesUI() {
  document.querySelectorAll('.leaflet-popup .pm-fav').forEach(btn => {
    const id = btn.dataset.id;
    if (!id) return;
    btn.textContent = favoritesSet.has(id) ? '★ Убрать из избранного' : '☆ В избранное';
  });
}
function updateFavoritesBadge() {
  if (!favoritesCountBadge) return;
  const total = favoritesSet.size + favoritesOsmSet.size;
  favoritesCountBadge.textContent = total;
  favoritesCountBadge.style.display = total ? 'inline-block' : 'none';
}
function getPlaceDataById(id) {
  const m = markersMap.get(id);
  if (m && m._placeData) return m._placeData;
  return favoritePlacesCache.get(id) || null;
}

// ---- Favorites modal (без изменений логики) ----
function openFavorites() { if (!currentUser) return alert('Войдите, чтобы видеть избранное'); favoritesModal?.classList.remove('hidden'); renderFavoritesPanel(); }
function closeFavorites() { favoritesModal?.classList.add('hidden'); }
openFavoritesBtn?.addEventListener('click', openFavorites);
closeFavoritesBtn?.addEventListener('click', closeFavorites);

function renderFavoritesPanel() {
  if (!favoritesPlacesListEl || !favoritesOsmListEl) return;

  // Места
  favoritesPlacesListEl.innerHTML = '';
  const placeIds = Array.from(favoritesSet);
  if (placeIds.length === 0) {
    favoritesPlacesListEl.innerHTML = '<div class="muted">Пусто</div>';
  } else {
    const frag = document.createDocumentFragment();
    placeIds.forEach(id => {
      const p = getPlaceDataById(id);
      const el = document.createElement('div');
      el.className = 'fav-item';
      if (!p) {
        el.innerHTML = `<div class="title">[объект недоступен]</div><div class="actions"><button type="button" data-action="remove">Убрать</button></div>`;
        el.querySelector('[data-action="remove"]').addEventListener('click', () => toggleFavorite(id));
      } else {
        el.innerHTML = `
          <div class="title">${p.name}</div>
          <div class="meta">${p.access || ''} ${p.security ? '• охрана: ' + p.security : ''}</div>
          <div class="actions">
            <button type="button" data-action="show">Показать</button>
            <button type="button" data-action="route">Маршрут</button>
            <button type="button" data-action="remove">Убрать</button>
          </div>
        `;
        el.querySelector('[data-action="show"]').addEventListener('click', () => {
          map.setView([p.lat, p.lng], 16);
          const m = markersMap.get(id);
          if (m) m.openPopup();
          closeFavorites();
        });
        el.querySelector('[data-action="route"]').addEventListener('click', () => { startRoutingTo([p.lat, p.lng]); closeFavorites(); });
        el.querySelector('[data-action="remove"]').addEventListener('click', () => toggleFavorite(id));
      }
      frag.appendChild(el);
    });
    favoritesPlacesListEl.appendChild(frag);
  }

  // OSM
  favoritesOsmListEl.innerHTML = '';
  const osmItems = Array.from(favoritesOsmMap.values());
  if (osmItems.length === 0) {
    favoritesOsmListEl.innerHTML = '<div class="muted">Пусто</div>';
  } else {
    const frag = document.createDocumentFragment();
    osmItems.forEach(d => {
      const el = document.createElement('div');
      el.className = 'fav-item';
      const name = d.name || 'OSM объект';
      el.innerHTML = `
        <div class="title">${name}</div>
        <div class="meta">${(d.type || '').toUpperCase()} • ${(+d.lat).toFixed(5)}, ${(+d.lng).toFixed(5)}</div>
        <div class="actions">
          <button type="button" data-action="show">Показать</button>
          <button type="button" data-action="route">Маршрут</button>
          <button type="button" data-action="remove">Убрать</button>
        </div>
      `;
      el.querySelector('[data-action="show"]').addEventListener('click', async () => {
        map.setView([d.lat, d.lng], 16);
        const mv = osmVerifiedMarkersMap.get(d.osmId || d.id);
        if (mv) mv.openPopup();
        else {
          const m = osmMarkersMap.get(d.osmId || d.id);
          if (m) {
            if (toggleOSM && !toggleOSM.checked) { toggleOSM.checked = true; toggleOSM.dispatchEvent(new Event('change')); }
            m.openPopup();
          } else {
            // временный
            const temp = L.marker([d.lat, d.lng], { icon: makeDivIcon('#4ea0ff') })
              .bindPopup(`<b>${name}</b><br/><small>из избранного OSM</small>`)
              .addTo(osmVerifiedLayer)
              .openPopup();
            setTimeout(() => { try { osmVerifiedLayer.removeLayer(temp); } catch(_) {} }, 10000);
          }
        }
        closeFavorites();
      });
      el.querySelector('[data-action="route"]').addEventListener('click', () => { startRoutingTo([d.lat, d.lng]); closeFavorites(); });
      el.querySelector('[data-action="remove"]').addEventListener('click', () => toggleFavoriteOSM(d.osmId || d.id, d));
      frag.appendChild(el);
    });
    favoritesOsmListEl.appendChild(frag);
  }
  updateFavoritesBadge();
}

// Favorites actions
async function toggleFavorite(placeId) {
  if (!currentUser) { alert('Войдите, чтобы использовать избранное'); return; }
  const favRef = doc(db, 'users', currentUser.uid, 'favorites', placeId);
  const wasFav = favoritesSet.has(placeId);
  if (wasFav) favoritesSet.delete(placeId); else favoritesSet.add(placeId);
  updateFavoritesBadge(); applyFilters(); renderUnifiedList();
  try { if (wasFav) await deleteDoc(favRef); else await setDoc(favRef, { createdAt: serverTimestamp() }); }
  catch (err) { if (wasFav) favoritesSet.add(placeId); else favoritesSet.delete(placeId); updateFavoritesBadge(); applyFilters(); renderUnifiedList(); alert('Не удалось обновить избранное: ' + err.message); }
}
function refreshOpenOSMPopupsFavoritesUI() {
  document.querySelectorAll('.leaflet-popup .osm-fav').forEach(btn => {
    const id = btn.dataset.id;
    if (!id) return;
    btn.textContent = favoritesOsmSet.has(id) ? '★ Убрать из избранного' : '☆ В избранное';
  });
}
async function toggleFavoriteOSM(osmId, data) {
  if (!currentUser) { alert('Войдите, чтобы использовать избранное'); return; }
  const favRef = doc(db, 'users', currentUser.uid, 'favorites_osm', osmId);
  const wasFav = favoritesOsmSet.has(osmId);
  if (wasFav) favoritesOsmSet.delete(osmId); else favoritesOsmSet.add(osmId);
  updateFavoritesBadge(); applyFiltersOSM(); renderUnifiedList();
  try {
    if (wasFav) await deleteDoc(favRef);
    else await setDoc(favRef, { osmId, type: data.type, name: data.name || 'OSM объект', lat: data.lat, lng: data.lng, tags: data.tags || {}, addedAt: serverTimestamp() });
  } catch (err) {
    if (wasFav) favoritesOsmSet.add(osmId); else favoritesOsmSet.delete(osmId);
    updateFavoritesBadge(); applyFiltersOSM(); renderUnifiedList();
    alert('Не удалось обновить избранное OSM: ' + err.message);
  }
}
function subscribeFavorites() {
  if (!currentUser) return;
  const favCol = collection(db, 'users', currentUser.uid, 'favorites');
  if (unsubFavorites) unsubFavorites();
  unsubFavorites = onSnapshot(favCol, async (snap) => {
    favoritesSet.clear();
    snap.forEach(d => favoritesSet.add(d.id));
    const missing = Array.from(favoritesSet).filter(id => !markersMap.has(id) && !favoritePlacesCache.has(id));
    if (missing.length) {
      await Promise.all(missing.map(async (id) => {
        try { const r = await getDoc(doc(db, 'places', id)); favoritePlacesCache.set(id, r.exists() ? { id, ...r.data() } : null); }
        catch { favoritePlacesCache.set(id, null); }
      }));
    }
    applyFilters(); renderFavoritesPanel(); updateFavoritesBadge(); renderUnifiedList();
  });
}
function subscribeFavoritesOSM() {
  if (!currentUser) return;
  const favCol = collection(db, 'users', currentUser.uid, 'favorites_osm');
  if (unsubFavoritesOSM) unsubFavoritesOSM();
  unsubFavoritesOSM = onSnapshot(favCol, (snap) => {
    favoritesOsmSet.clear(); favoritesOsmMap.clear();
    snap.forEach(d => { favoritesOsmSet.add(d.id); favoritesOsmMap.set(d.id, { id: d.id, ...d.data() }); });
    applyFiltersOSM(); renderFavoritesPanel(); updateFavoritesBadge(); renderUnifiedList();
  });
}

// ---- Auth ----
loginBtn?.addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider).catch(err => alert(err.message));
});
logoutBtn?.addEventListener('click', () => signOut(auth));

async function loadAdminStatus(uid) {
  try {
    const conf = await getDoc(doc(db, 'config', 'admins'));
    const uids = conf.exists() ? (conf.data().uids || []) : [];
    return uids.includes(uid) || FALLBACK_ADMIN_UIDS.includes(uid);
  } catch(e) {
    return FALLBACK_ADMIN_UIDS.includes(uid);
  }
}
onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  if (currentUser) {
    loginBtn?.classList.add('hidden');
    logoutBtn?.classList.remove('hidden');
    userInfo?.classList.remove('hidden');
    if (userName) userName.textContent = currentUser.displayName || 'Без имени';
    if (userUid) userUid.textContent = currentUser.uid;
    if (userAvatar) userAvatar.src = currentUser.photoURL || 'https://placehold.co/32x32';
    isAdmin = await loadAdminStatus(currentUser.uid);
    if (adminLink) adminLink.classList.toggle('hidden', !isAdmin);

    subscribeData();
    subscribeFavorites();
    subscribeFavoritesOSM();
    subscribeOsmModeration();
    updateFavoritesBadge();
    renderUnifiedList();
  } else {
    loginBtn?.classList.remove('hidden');
    logoutBtn?.classList.add('hidden');
    userInfo?.classList.add('hidden');
    if (adminLink) adminLink.classList.add('hidden');
    isAdmin = false;

    if (unsubFavorites) unsubFavorites(); unsubFavorites = null; favoritesSet.clear();
    if (unsubFavoritesOSM) unsubFavoritesOSM(); unsubFavoritesOSM = null; favoritesOsmSet.clear();

    favoritePlacesCache.clear(); favoritesOsmMap.clear();

    subscribeData(); applyFilters(); applyFiltersOSM(); updateFavoritesBadge(); closeFavorites(); renderUnifiedList();
  }
});

// ---- Data (наши места) ----
function subscribeData() {
  placesLayer?.clearLayers();
  markersMap.clear();
  if (unsubApproved) unsubApproved();
  if (unsubMine) unsubMine();
  unsubApproved = null; unsubMine = null;

  const approvedQ = query(collection(db, 'places'), where('status', '==', 'approved'));
  unsubApproved = onSnapshot(approvedQ, (snap) => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') {
        const m = markersMap.get(ch.doc.id);
        if (m) { placesLayer.removeLayer(m); markersMap.delete(ch.doc.id); }
      } else {
        const d = { id: ch.doc.id, ...ch.doc.data() };
        upsertMarker(d);
      }
    });
    applyFilters(); applyFiltersOSM(); renderUnifiedList();
  });

  if (currentUser) {
    const mineQ = query(collection(db, 'places'), where('createdBy', '==', currentUser.uid));
    unsubMine = onSnapshot(mineQ, (snap) => {
      snap.docChanges().forEach(ch => {
        const d = { id: ch.doc.id, ...ch.doc.data() };
        if (d.status !== 'approved') {
          if (ch.type === 'removed') {
            const m = markersMap.get(d.id);
            if (m) { placesLayer.removeLayer(m); markersMap.delete(d.id); }
          } else {
            upsertMarker(d);
          }
        }
      });
      applyFilters(); applyFiltersOSM(); renderUnifiedList();
    });
  }
}

// ---- Add modal ----
function openAddModal() {
  if (!addPlaceForm || !modalAdd) return;
  addStatus.textContent = '';
  addPlaceForm.reset();
  modalAdd.classList.remove('hidden');
  setTimeout(()=> placeName?.focus(), 0);
}
function closeAddModal() {
  if (!modalAdd) return;
  modalAdd.classList.add('hidden');
  if (tempAddMarker) { tempAddMarker.remove(); tempAddMarker = null; }
}
addPlaceBtn?.addEventListener('click', () => { if (!currentUser) return alert('Войдите, чтобы добавлять объекты'); openAddModal(); });
closeModalAdd?.addEventListener('click', closeAddModal);
cancelAdd?.addEventListener('click', closeAddModal);
addPlaceForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { alert('Войдите'); return; }
  const name = placeName.value.trim();
  const description = placeDescription.value.trim();
  const security = placeSecurity.value;
  const access = placeAccess.value;
  const loot = parseLoot(placeLoot.value);
  const lat = parseFloat(placeLat.value);
  const lng = parseFloat(placeLng.value);
  if (!name || isNaN(lat) || isNaN(lng)) { addStatus.textContent = 'Проверьте название и координаты'; return; }
  addStatus.textContent = 'Сохраняем...';
  try {
    await addDoc(collection(db, 'places'), {
      name, description, security, access, loot, lat, lng,
      status: 'pending', photos: [], createdBy: currentUser.uid, createdAt: serverTimestamp()
    });
    addStatus.textContent = 'Отправлено на модерацию. Спасибо!';
    setTimeout(closeAddModal, 800);
  } catch (err) { console.error(err); addStatus.textContent = 'Ошибка: ' + err.message; }
});

// ---- Delete place ----
async function deletePlace(placeId) {
  if (!confirm('Удалить объект?')) return;
  try { await deleteDoc(doc(db, 'places', placeId)); }
  catch (e) { alert('Ошибка удаления (возможно нет прав): ' + e.message); }
}

// ---- Filters debounce ----
function scheduleApplyAll() {
  if (scheduleApplyAll._t) clearTimeout(scheduleApplyAll._t);
  scheduleApplyAll._t = setTimeout(() => { applyFilters(); applyFiltersOSM(); renderUnifiedList(); }, 200);
}
[filterAccess, filterSecurity, onlyFavorites].forEach(el => el?.addEventListener('change', scheduleApplyAll));
searchInput?.addEventListener('input', scheduleApplyAll);

// ---- Routing ----
function startRoutingTo(targetLatLng) {
  if (!navigator.geolocation) { alert('Геолокация недоступна'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const start = L.latLng(pos.coords.latitude, pos.coords.longitude);
    const end = L.latLng(targetLatLng[0], targetLatLng[1]);
    if (routingControl) map.removeControl(routingControl);
    routingControl = L.Routing.control({
      waypoints: [start, end],
      routeWhileDragging: false,
      showAlternatives: true,
      collapsible: true,
      router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' })
    }).addTo(map);
    updateClearRouteBtn();
  }, () => alert('Не удалось получить геолокацию'));
}

// ---- OSM moderation helpers ----
function getOsmStatusColor(status) {
  switch (status) { case 'verified': return '#2ecc71'; case 'flagged': return '#ff8a00'; case 'hidden': return '#888888'; default: return '#4ea0ff'; }
}
function humanOsmStatus(status) {
  switch (status) { case 'verified': return 'подтверждён'; case 'flagged': return 'помечен'; case 'hidden': return 'скрыт'; default: return 'видим'; }
}
async function setOsmModeration(osmId, status, note, meta) {
  if (!currentUser || !isAdmin) { alert('Недостаточно прав для модерации OSM'); return; }
  try {
    const ref = doc(db, 'osm_moderation', osmId);
    const payload = {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
      updatedByName: currentUser.displayName || ''
    };
    if (note !== undefined) payload.note = note;
    if (meta) {
      if (typeof meta.lat === 'number') payload.lat = meta.lat;
      if (typeof meta.lng === 'number') payload.lng = meta.lng;
      if (meta.type) payload.type = meta.type;
      if (meta.baseName) payload.baseName = meta.baseName;
      else if (meta.name) payload.baseName = meta.name;
      if (meta.tags) payload.tagsSnapshot = meta.tags;
    }
    const prev = osmModerationMap.get(osmId) || {};
    osmModerationMap.set(osmId, { ...prev, ...payload });
    applyFiltersOSM(); renderUnifiedList();
    await setDoc(ref, payload, { merge: true });
  } catch (e) { alert('Не удалось обновить статус OSM: ' + e.message); }
}
async function saveOsmOverrides(osmId, overrides) {
  if (!currentUser || !isAdmin) { alert('Недостаточно прав для сохранения правок'); return; }
  try {
    const ref = doc(db, 'osm_moderation', osmId);
    const payload = { overrides, updatedAt: serverTimestamp(), updatedBy: currentUser.uid, updatedByName: currentUser.displayName || '' };
    const prev = osmModerationMap.get(osmId) || {};
    osmModerationMap.set(osmId, { ...prev, ...payload });
    applyFiltersOSM(); renderUnifiedList();
    await setDoc(ref, payload, { merge: true });
    alert('Правки сохранены');
  } catch (e) { alert('Не удалось сохранить правки: ' + e.message); }
}
async function submitOsmReport(osmId, type, data = {}) {
  if (!currentUser) { alert('Войдите, чтобы отправлять жалобы/заметки'); return; }
  try {
    await addDoc(collection(db, 'osm_reports'), {
      osmId, type, data, createdAt: serverTimestamp(), createdBy: currentUser.uid, createdByName: currentUser.displayName || ''
    });
    alert(type === 'suggestion' ? 'Правка отправлена на модерацию' : 'Отправлено');
  } catch (e) { alert('Не удалось отправить: ' + e.message); }
}
function ensureVerifiedMarkerFromDoc(osmId, d) {
  const lat = d.lat, lng = d.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return;
  const baseName = d.baseName || (d.overrides?.name) || 'OSM: объект без имени';
  const type = d.type || 'node';
  const tags = d.tagsSnapshot || {};
  let marker = osmVerifiedMarkersMap.get(osmId);
  if (!marker) {
    marker = L.marker([lat, lng], { icon: makeDivIcon(getOsmStatusColor(d.status)) }).addTo(osmVerifiedLayer);
    osmVerifiedMarkersMap.set(osmId, marker);
  } else {
    marker.setLatLng([lat, lng]);
    marker.setIcon(makeDivIcon(getOsmStatusColor(d.status)));
  }
  marker._osmData = { osmId, baseName, lat, lng, type, tags };
  renderOsmPopup(marker);
}
function removeVerifiedMarker(osmId) {
  const m = osmVerifiedMarkersMap.get(osmId);
  if (m) { osmVerifiedLayer.removeLayer(m); osmVerifiedMarkersMap.delete(osmId); }
}
function subscribeOsmModeration() {
  if (unsubOsmModeration) unsubOsmModeration();
  const col = collection(db, 'osm_moderation');
  unsubOsmModeration = onSnapshot(col, (snap) => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        osmModerationMap.delete(id);
        removeVerifiedMarker(id);
      } else {
        const data = ch.doc.data();
        osmModerationMap.set(id, data);
        if (data.status === 'verified') ensureVerifiedMarkerFromDoc(id, data);
        else removeVerifiedMarker(id);
      }
    });
    applyFiltersOSM(); renderUnifiedList();
  });
}
subscribeOsmModeration();

// ---- OSM popups (общие для verified и динамических) ----
function renderOsmPopup(marker) {
  const d = marker._osmData; // {osmId, baseName, lat, lng, type, tags}
  const mod = osmModerationMap.get(d.osmId) || {};
  const ov = mod.overrides || {};
  const displayName = ov.name || d.baseName || 'OSM: объект без имени';
  const favTxt = favoritesOsmSet.has(d.osmId) ? '★ Убрать из избранного' : '☆ В избранное';
  const tagsHtml = Object.entries(d.tags || {}).map(([k,v])=>`${k}=${v}`).slice(0,12).join('<br/>');
  const statusText = humanOsmStatus(mod.status);
  const color = getOsmStatusColor(mod.status);

  const adminControls = isAdmin ? `
    <div class="osm-mod-controls" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
      <span>Статус: <b class="osm-mod-status">${statusText}</b></span>
      <button type="button" class="osm-mod-verify">✅ Подтвердить</button>
      <button type="button" class="osm-mod-flag">⚠️ Пометить</button>
      <button type="button" class="osm-mod-hide">${mod.status === 'hidden' ? 'Показать' : 'Скрыть'}</button>
    </div>
  ` : '';

  const reportControls = `
    <div class="osm-report-controls" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="osm-report-flag">⚑ Пометить (спорно)</button>
      <button type="button" class="osm-report-note">✎ Заметка</button>
    </div>
  `;

  const editBox = `
    <details style="margin-top:6px">
      <summary>${isAdmin ? 'Изменить данные (модерация)' : 'Предложить правки'}</summary>
      <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
        <input type="text" class="osm-edit-name" placeholder="Название" />
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <label>Доступ:
            <select class="osm-edit-access">
              <option value="">—</option>
              <option value="open">Открыто</option>
              <option value="partial">Частично</option>
              <option value="closed">Закрыто</option>
            </select>
          </label>
          <label>Охрана:
            <select class="osm-edit-security">
              <option value="">—</option>
              <option value="none">Нет</option>
              <option value="low">Низкая</option>
              <option value="medium">Средняя</option>
              <option value="high">Высокая</option>
            </select>
          </label>
        </div>
        <input type="text" class="osm-edit-loot" placeholder="Лут (через запятую)" />
        <button type="button" class="osm-edit-save">${isAdmin ? 'Сохранить (модератор)' : 'Отправить на модерацию'}</button>
      </div>
    </details>
  `;

  const overridesMeta = (ov.name || ov.access || ov.security || (ov.loot && ov.loot.length))
    ? `<div class="muted" style="margin-top:4px">Применены правки модерации</div>` : '';

  const html = `
    <b class="osm-title">${displayName}</b><br/>
    <small>из OSM/Overpass • <span class="osm-mod-status">${statusText}</span></small><br/>
    <div style="max-width:240px">${tagsHtml}</div>
    ${overridesMeta}
    <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="osm-route">Маршрут</button>
      <button type="button" class="osm-fav" data-id="${d.osmId}">${favTxt}</button>
    </div>
    ${adminControls}
    ${reportControls}
    ${editBox}
  `;

  marker.setIcon(makeDivIcon(color));
  marker.bindPopup(html);
  marker.off('popupopen');
  marker.on('popupopen', () => {
    const node = marker.getPopup().getElement();

    // поля правок
    const nameEl = node.querySelector('.osm-edit-name');
    const accessEl = node.querySelector('.osm-edit-access');
    const secEl = node.querySelector('.osm-edit-security');
    const lootEl = node.querySelector('.osm-edit-loot');

    nameEl.value = displayName || '';
    accessEl.value = (mod.overrides?.access) || '';
    secEl.value = (mod.overrides?.security) || '';
    lootEl.value = Array.isArray(mod.overrides?.loot) ? mod.overrides.loot.join(', ') : '';

    // общие кнопки
    node.querySelector('.osm-route').addEventListener('click', ()=> startRoutingTo([d.lat, d.lng]));
    node.querySelector('.osm-fav').addEventListener('click', () => toggleFavoriteOSM(d.osmId, { name: displayName, lat: d.lat, lng: d.lng, type: d.type, tags: d.tags }));

    // репорты (всем)
    node.querySelector('.osm-report-flag').addEventListener('click', async () => {
      if (!currentUser) return alert('Войдите, чтобы отправлять жалобы');
      const reason = prompt('Почему объект спорный? (необязательно)') || '';
      await submitOsmReport(d.osmId, 'flag', { reason });
    });
    node.querySelector('.osm-report-note').addEventListener('click', async () => {
      if (!currentUser) return alert('Войдите, чтобы отправлять заметки');
      const note = prompt('Заметка (увидит модератор):', '') || '';
      if (note.trim()) await submitOsmReport(d.osmId, 'note', { note });
    });

    // сохранение правок
    node.querySelector('.osm-edit-save').addEventListener('click', async () => {
      const fields = {
        name: nameEl.value.trim().slice(0, 120) || '',
        access: ACCESS_OPTIONS.includes(accessEl.value) ? accessEl.value : '',
        security: SECURITY_OPTIONS.includes(secEl.value) ? secEl.value : '',
        loot: parseLoot(lootEl.value)
      };
      if (isAdmin) {
        const overrides = {};
        if (fields.name) overrides.name = fields.name;
        if (fields.access) overrides.access = fields.access;
        if (fields.security) overrides.security = fields.security;
        if (fields.loot && fields.loot.length) overrides.loot = fields.loot;
        await saveOsmOverrides(d.osmId, overrides);
        renderOsmPopup(marker); marker.openPopup();
      } else {
        await submitOsmReport(d.osmId, 'suggestion', fields);
      }
    });

    // модераторские кнопки
    if (isAdmin) {
      const v = node.querySelector('.osm-mod-verify');
      const f = node.querySelector('.osm-mod-flag');
      const h = node.querySelector('.osm-mod-hide');
      v?.addEventListener('click', async () => {
        await setOsmModeration(d.osmId, 'verified', undefined, d);
        ensureVerifiedMarkerFromDoc(d.osmId, { status: 'verified', lat: d.lat, lng: d.lng, baseName: d.baseName, type: d.type, tagsSnapshot: d.tags });
        renderOsmPopup(marker); marker.openPopup();
      });
      f?.addEventListener('click', async () => {
        await setOsmModeration(d.osmId, 'flagged', undefined, d);
        renderOsmPopup(marker); marker.openPopup();
      });
      h?.addEventListener('click', async () => {
        const curr = (osmModerationMap.get(d.osmId) || {}).status;
        const next = curr === 'hidden' ? 'visible' : 'hidden';
        await setOsmModeration(d.osmId, next, undefined, d);
        if (next === 'hidden') { try { map.closePopup(); } catch(_) {} }
        renderOsmPopup(marker); marker.openPopup();
      });
    }
  });
}

// ---- ЕДИНЫЙ СПИСОК В САЙДБАРЕ ----
function itemMatchesFilters(item) {
  const queryText = (searchInput?.value || '').toLowerCase();
  const bySearch = !queryText || (item.searchText || '').includes(queryText);

  const byAccess = !filterAccess?.value || (item.access && item.access === filterAccess.value);
  const bySec = !filterSecurity?.value || (item.security && item.security === filterSecurity.value);

  // Избранное
  const byFav = !onlyFavorites?.checked || (
    (item.kind === 'place' && favoritesSet.has(item.id)) ||
    (item.kind === 'osm' && favoritesOsmSet.has(item.id))
  );

  return bySearch && byAccess && bySec && byFav;
}

function collectListItems() {
  const items = [];

  // Наши места
  markersMap.forEach((m, id) => {
    const p = m._placeData;
    if (!p) return;
    const it = {
      kind: 'place',
      id: p.id,
      name: p.name || '',
      access: p.access || '',
      security: p.security || '',
      loot: Array.isArray(p.loot) ? p.loot : [],
      status: p.status,
      lat: p.lat, lng: p.lng,
      createdAt: p.createdAt?.seconds || 0,
      searchText: `${(p.name || '').toLowerCase()} ${(p.description || '').toLowerCase()}`
    };
    if (itemMatchesFilters(it)) items.push(it);
  });

  // Verified OSM — всегда
  osmVerifiedMarkersMap.forEach((m, osmId) => {
    const d = m._osmData;
    const mod = osmModerationMap.get(osmId) || {};
    const ov = mod.overrides || {};
    const it = {
      kind: 'osm',
      id: osmId,
      name: ov.name || d.baseName || 'OSM: объект без имени',
      access: ov.access || '',
      security: ov.security || '',
      loot: Array.isArray(ov.loot) ? ov.loot : [],
      status: mod.status || 'verified',
      lat: d.lat, lng: d.lng,
      updatedAt: mod.updatedAt?.seconds || 0,
      searchText: (ov.name || d.baseName || '').toLowerCase()
    };
    if (itemMatchesFilters(it)) items.push(it);
  });

  // Динамические OSM — если включён тумблер, и нет verified дубля, и не hidden
  if (toggleOSM?.checked) {
    osmMarkersMap.forEach((m, osmId) => {
      if (osmVerifiedMarkersMap.has(osmId)) return;
      const d = m._osmData;
      const mod = osmModerationMap.get(osmId) || {};
      if (mod.status === 'hidden') return;
      const ov = mod.overrides || {};
      const it = {
        kind: 'osm',
        id: osmId,
        name: ov.name || d.baseName || 'OSM: объект без имени',
        access: ov.access || '',
        security: ov.security || '',
        loot: Array.isArray(ov.loot) ? ov.loot : [],
        status: mod.status || 'visible',
        lat: d.lat, lng: d.lng,
        updatedAt: mod.updatedAt?.seconds || 0,
        searchText: (ov.name || d.baseName || '').toLowerCase()
      };
      if (itemMatchesFilters(it)) items.push(it);
    });
  }

  // Сортировка: по времени (createdAt/updatedAt) убыв., затем по типу, затем по имени
  items.sort((a,b) => ((b.createdAt||b.updatedAt||0) - (a.createdAt||a.updatedAt||0)) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ru'));

  return items;
}

function renderOsmListItem(item) {
  // item: {kind:'osm', id, name, access, security, loot[], status, lat, lng}
  const el = document.createElement('div');
  el.className = 'place-item'; // тот же стиль
  el.dataset.id = item.id;

  const statusBadge = item.status === 'verified' ? '<span class="badge approved">OSM • подтверждён</span>'
                    : item.status === 'flagged' ? '<span class="badge pending">OSM • помечен</span>'
                    : '<span class="badge">OSM</span>';

  const lootText = (item.loot && item.loot.length) ? ` • лут: ${item.loot.join(', ')}` : '';
  const meta = `${item.access || '—'} • охрана: ${item.security || '—'}${lootText}`;

  el.innerHTML = `
    <h4>${item.name} ${statusBadge}</h4>
    <div class="place-meta">${meta}</div>
    <div class="place-actions">
      <button type="button" data-action="show">Показать на карте</button>
      <button type="button" data-action="route">Маршрут</button>
      <button type="button" data-action="favorite">${favoritesOsmSet.has(item.id) ? '★ В избранном' : '☆ В избранное'}</button>
      <button type="button" data-action="flag">Пометить</button>
      <button type="button" data-action="note">Заметка</button>
    </div>
  `;

  el.querySelector('[data-action="show"]').addEventListener('click', () => showOsmOnMap(item));
  el.querySelector('[data-action="route"]').addEventListener('click', () => startRoutingTo([item.lat, item.lng]));
  el.querySelector('[data-action="favorite"]').addEventListener('click', () => toggleFavoriteOSM(item.id, {
    name: item.name, lat: item.lat, lng: item.lng, type: 'node', tags: {}
  }));
  el.querySelector('[data-action="flag"]').addEventListener('click', async () => {
    if (!currentUser) return alert('Войдите, чтобы отправлять жалобы');
    const reason = prompt('Почему объект спорный? (необязательно)') || '';
    await submitOsmReport(item.id, 'flag', { reason });
  });
  el.querySelector('[data-action="note"]').addEventListener('click', async () => {
    if (!currentUser) return alert('Войдите, чтобы отправлять заметки');
    const note = prompt('Заметка (увидит модератор):', '') || '';
    if (note.trim()) await submitOsmReport(item.id, 'note', { note });
  });

  return el;
}

function showOsmOnMap(item) {
  // Пытаемся открыть verified -> динамический -> временный
  const mv = osmVerifiedMarkersMap.get(item.id);
  if (mv) {
    map.setView([item.lat, item.lng], 16);
    mv.openPopup();
    return;
  }
  const mdyn = osmMarkersMap.get(item.id);
  if (mdyn) {
    if (toggleOSM && !toggleOSM.checked) { toggleOSM.checked = true; toggleOSM.dispatchEvent(new Event('change')); }
    map.setView([item.lat, item.lng], 16);
    mdyn.openPopup();
    return;
  }
  // временный
  map.setView([item.lat, item.lng], 16);
  const temp = L.marker([item.lat, item.lng], { icon: makeDivIcon('#4ea0ff') })
    .bindPopup(`<b>${item.name}</b><br/><small>OSM объект</small>`)
    .addTo(osmVerifiedLayer)
    .openPopup();
  setTimeout(() => { try { osmVerifiedLayer.removeLayer(temp); } catch(_) {} }, 8000);
}

function renderUnifiedList() {
  if (!placesList) return;
  placesList.innerHTML = '';

  const items = collectListItems();
  const frag = document.createDocumentFragment();

  items.forEach(item => {
    if (item.kind === 'place') {
      const pMarker = markersMap.get(item.id);
      const p = pMarker?._placeData;
      if (p) frag.appendChild(renderPlaceItem(p));
    } else {
      frag.appendChild(renderOsmListItem(item));
    }
  });

  placesList.appendChild(frag);
}

// ---- Apply filters to OSM layers ----
function applyFiltersOSM() {
  const queryText = (searchInput?.value || '').toLowerCase();

  // Verified — всегда на карте
  osmVerifiedMarkersMap.forEach((marker, osmId) => {
    const d = marker._osmData;
    const mod = osmModerationMap.get(osmId) || {};
    const ov = mod.overrides || {};
    const displayName = ov.name || d.baseName || '';
    const matchesSearch = !queryText || displayName.toLowerCase().includes(queryText);
    const matchesFav = !onlyFavorites?.checked || favoritesOsmSet.has(osmId);
    const notHidden = mod.status !== 'hidden';
    const visible = matchesSearch && matchesFav && notHidden;

    marker.setIcon(makeDivIcon(getOsmStatusColor(mod.status)));

    if (visible) { if (!osmVerifiedLayer.hasLayer(marker)) marker.addTo(osmVerifiedLayer); marker.getElement()?.classList.remove('hidden'); }
    else { osmVerifiedLayer.removeLayer(marker); }

    const el = marker.getPopup()?.getElement();
    if (el) {
      const st = el.querySelector('.osm-mod-status'); if (st) st.textContent = humanOsmStatus(mod.status);
      const title = el.querySelector('.osm-title'); if (title) title.textContent = displayName || 'OSM: объект без имени';
      const hideBtn = el.querySelector('.osm-mod-hide'); if (hideBtn) hideBtn.textContent = (mod.status === 'hidden') ? 'Показать' : 'Скрыть';
    }
  });

  // Динамические — зависят от тумблера и отсутствия verified дубля
  osmMarkersMap.forEach((marker, osmId) => {
    const d = marker._osmData;
    const mod = osmModerationMap.get(osmId) || {};
    const ov = mod.overrides || {};
    const displayName = ov.name || d.baseName || '';
    const matchesSearch = !queryText || displayName.toLowerCase().includes(queryText);
    const matchesFav = !onlyFavorites?.checked || favoritesOsmSet.has(osmId);
    const notHidden = mod.status !== 'hidden';
    const visible = matchesSearch && matchesFav && notHidden;

    marker.setIcon(makeDivIcon(getOsmStatusColor(mod.status)));

    if (osmVerifiedMarkersMap.has(osmId)) {
      marker.remove();
      return;
    }

    if (visible && toggleOSM?.checked) {
      if (!osmLayer.hasLayer(marker)) marker.addTo(osmLayer);
      marker.getElement()?.classList.remove('hidden');
    } else {
      osmLayer.removeLayer(marker);
    }

    const el = marker.getPopup()?.getElement();
    if (el) {
      const st = el.querySelector('.osm-mod-status'); if (st) st.textContent = humanOsmStatus(mod.status);
      const title = el.querySelector('.osm-title'); if (title) title.textContent = displayName || 'OSM: объект без имени';
      const hideBtn = el.querySelector('.osm-mod-hide'); if (hideBtn) hideBtn.textContent = (mod.status === 'hidden') ? 'Показать' : 'Скрыть';
    }
  });

  refreshOpenOSMPopupsFavoritesUI();
  renderUnifiedList();
}

// ---- Overpass ----
let osmFetchTimer = null;
function throttleFetchOSM() { if (osmFetchTimer) clearTimeout(osmFetchTimer); osmFetchTimer = setTimeout(fetchOSMByView, 600); }
async function fetchOSMByView() {
  const b = map.getBounds();
  const s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
  const bbox = `${s},${w},${n},${e}`;
  const query = `
    [out:json][timeout:25];
    (
      node["abandoned"="yes"](${bbox});
      way["abandoned"="yes"](${bbox});
      node["disused"="yes"](${bbox});
      way["disused"="yes"](${bbox});
      node["building"="ruins"](${bbox});
      way["building"="ruins"](${bbox});
      node["historic"="ruins"](${bbox});
      way["historic"="ruins"](${bbox});
    );
    out center 100;
  `;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ data: query })
    });
    const data = await res.json();

    osmLayer.clearLayers();
    osmMarkersMap.clear();

    (data.elements || []).forEach(el => {
      const type = el.type; // 'node' | 'way'
      const id = el.id;
      const osmId = `${type}-${id}`;
      const lat = el.lat || el.center?.lat;
      const lng = el.lon || el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      const baseName = el.tags?.name || el.tags?.['name:ru'] || 'OSM: объект без имени';
      const tags = el.tags || {};

      const mod = osmModerationMap.get(osmId);
      if (mod?.status === 'hidden') return;

      // Если уже есть verified-маркер — актуализируем его и не создаём динамический
      if (osmVerifiedMarkersMap.has(osmId)) {
        const mv = osmVerifiedMarkersMap.get(osmId);
        mv._osmData = { osmId, baseName, lat, lng, type, tags };
        renderOsmPopup(mv);
        return;
      }

      const marker = L.marker([lat, lng], { icon: makeDivIcon(getOsmStatusColor(mod?.status)) })
        .addTo(osmLayer);

      marker._osmData = { osmId, baseName, lat, lng, type, tags };
      osmMarkersMap.set(osmId, marker);
      renderOsmPopup(marker);
    });

    applyFiltersOSM(); // и перерисует unified list
  } catch (e) {
    console.warn('Overpass error', e);
  }
}
