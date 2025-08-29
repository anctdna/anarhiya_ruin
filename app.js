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

let clearRouteControl; // кнопка сброса маршрута

const markersMap = new Map(); // placeId -> marker
const favoritesSet = new Set(); // placeId
const favoritesOsmSet = new Set(); // "node-123" / "way-456"
const osmMarkersMap = new Map(); // 'type-id' -> marker

// Кеши для списков избранного
const favoritePlacesCache = new Map(); // placeId -> placeData | null
const favoritesOsmMap = new Map();     // osmId -> { id, osmId, name, lat, lng, type, tags, ... }

let map, routingControl, placesLayer, osmLayer, tempAddMarker = null;

// Helpers: Route clear/show button
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
  osmLayer = L.layerGroup();

  // Добавление по клику на карту
  map.on('click', (e) => {
    // если модалка закрыта — открыть её (при наличии авторизации)
    if (modalAdd?.classList.contains('hidden')) {
      if (!currentUser) {
        alert('Чтобы добавить объект, войдите в аккаунт');
        return;
      }
      openAddModal();
    }
    // если модалка открыта — проставить координаты и временный маркер
    if (!modalAdd?.classList.contains('hidden')) {
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
    }
  });

  // Simple locate button
  L.control.locate = function() {
    const control = L.control({position: 'topleft'});
    control.onAdd = function() {
      const btn = L.DomUtil.create('a', 'leaflet-bar');
      btn.href = '#';
      btn.title = 'Моё местоположение';
      btn.innerHTML = '📍';
      btn.style.padding = '6px 8px';
      btn.style.background = '#fff';
      L.DomEvent.on(btn, 'click', (e) => {
        e.preventDefault();
        if (!navigator.geolocation) {
          alert('Геолокация недоступна');
          return;
        }
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
    btn.title = 'Сбросить маршрут (Esc или ПКМ по карте)';
    btn.innerHTML = '✖';
    btn.style.padding = '6px 10px';
    btn.style.background = '#fff';
    btn.style.display = 'none'; // по умолчанию скрыта
    L.DomEvent.on(btn, 'click', (e) => { e.preventDefault(); clearRoute(); });
    this._btn = btn;
    return btn;
  };
  clearRouteControl.addTo(map);

  // Доп. способы сбросить маршрут
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearRoute(); });
  map.on('contextmenu', () => { if (routingControl) clearRoute(); });

  // OSM toggle handling
  if (toggleOSM) {
    toggleOSM.addEventListener('change', () => {
      if (toggleOSM.checked) {
        map.addLayer(osmLayer);
        fetchOSMByView();
      } else {
        map.removeLayer(osmLayer);
        osmLayer.clearLayers();
        osmMarkersMap.clear();
      }
    });
  }
  map.on('moveend', () => {
    if (toggleOSM?.checked) throttleFetchOSM();
  });
}

initMap();

// Markers and rendering
function makeDivIcon(color='#ff3b3b') {
  const html = `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>`;
  return L.divIcon({ className: 'custom-div-icon', html, iconSize: [18,18], iconAnchor:[9,9] });
}

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

  el.querySelector('[data-action="fly"]').addEventListener('click', () => {
    map.setView([place.lat, place.lng], 16);
  });
  el.querySelector('[data-action="route"]').addEventListener('click', () => {
    startRoutingTo([place.lat, place.lng]);
  });
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

  marker._placeData = place; // attach for filtering
  applyFiltersToMarker(marker);
}

// Apply filters
function applyFilters() {
  if (!placesList) return;
  placesList.innerHTML = '';
  const allPlaces = Array.from(markersMap.values()).map(m => m._placeData);
  const filtered = allPlaces
    .filter(p => p && placeMatchesFilters(p))
    .sort((a,b)=> (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  for (const p of filtered) {
    placesList.appendChild(renderPlaceItem(p));
  }
  // markers
  markersMap.forEach(marker => applyFiltersToMarker(marker));
  refreshOpenPopupsFavoritesUI();
}

function applyFiltersOSM() {
  const queryText = (searchInput?.value || '').toLowerCase();
  osmMarkersMap.forEach((marker, osmId) => {
    const d = marker._osmData; // { id, name, lat, lng, type, tags }
    const matchesSearch = !queryText || (d.name || '').toLowerCase().includes(queryText);
    const matchesFav = !onlyFavorites?.checked || favoritesOsmSet.has(osmId);
    const visible = matchesSearch && matchesFav;

    if (visible) {
      if (!osmLayer.hasLayer(marker)) marker.addTo(osmLayer);
      marker.getElement()?.classList.remove('hidden');
    } else {
      osmLayer.removeLayer(marker);
    }
  });
  refreshOpenOSMPopupsFavoritesUI();
}

function applyFiltersToMarker(marker) {
  const p = marker._placeData;
  if (!p) return;
  const visible = placeMatchesFilters(p);
  if (visible) {
    if (!placesLayer.hasLayer(marker)) marker.addTo(placesLayer);
    marker.getElement()?.classList.remove('hidden');
  } else {
    placesLayer.removeLayer(marker);
  }
}

// Favorites UI helpers
function refreshOpenPopupsFavoritesUI() {
  document.querySelectorAll('.leaflet-popup .pm-fav').forEach(btn => {
    const id = btn.dataset.id;
    if (!id) return;
    btn.textContent = favoritesSet.has(id) ? '★ Убрать из избранного' : '☆ В избранное';
  });
}
function refreshOpenOSMPopupsFavoritesUI() {
  document.querySelectorAll('.leaflet-popup .osm-fav').forEach(btn => {
    const id = btn.dataset.id;
    if (!id) return;
    btn.textContent = favoritesOsmSet.has(id) ? '★ Убрать из избранного' : '☆ В избранное';
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

// Favorites panel (modal)
function openFavorites() {
  if (!currentUser) {
    alert('Войдите, чтобы видеть избранное');
    return;
  }
  favoritesModal?.classList.remove('hidden');
  renderFavoritesPanel();
}
function closeFavorites() {
  favoritesModal?.classList.add('hidden');
}
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
        el.innerHTML = `
          <div class="title">[объект недоступен]</div>
          <div class="actions">
            <button type="button" data-action="remove">Убрать</button>
          </div>
        `;
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
        el.querySelector('[data-action="route"]').addEventListener('click', () => {
          startRoutingTo([p.lat, p.lng]);
          closeFavorites();
        });
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
        <div class="meta">${d.type?.toUpperCase() || ''} • ${d.lat?.toFixed ? d.lat.toFixed(5) : d.lat}, ${d.lng?.toFixed ? d.lng.toFixed(5) : d.lng}</div>
        <div class="actions">
          <button type="button" data-action="show">Показать</button>
          <button type="button" data-action="route">Маршрут</button>
          <button type="button" data-action="remove">Убрать</button>
        </div>
      `;
      el.querySelector('[data-action="show"]').addEventListener('click', async () => {
        map.setView([d.lat, d.lng], 16);
        // Включим слой OSM при необходимости
        if (typeof toggleOSM !== 'undefined' && toggleOSM && !toggleOSM.checked) {
          toggleOSM.checked = true;
          toggleOSM.dispatchEvent(new Event('change'));
        } else {
          map.addLayer(osmLayer);
        }
        // Если маркер уже есть — откроем попап, иначе добавим временный
        const m = osmMarkersMap.get(d.osmId || d.id);
        if (m) {
          m.openPopup();
        } else {
          const temp = L.marker([d.lat, d.lng], { icon: makeDivIcon('#4ea0ff') })
            .bindPopup(`<b>${name}</b><br/><small>из избранного OSM</small>`)
            .addTo(osmLayer)
            .openPopup();
          setTimeout(() => { try { osmLayer.removeLayer(temp); } catch(_){} }, 10000);
        }
        closeFavorites();
      });
      el.querySelector('[data-action="route"]').addEventListener('click', () => {
        startRoutingTo([d.lat, d.lng]);
        closeFavorites();
      });
      el.querySelector('[data-action="remove"]').addEventListener('click', () => {
        toggleFavoriteOSM(d.osmId || d.id, d);
      });
      frag.appendChild(el);
    });
    favoritesOsmListEl.appendChild(frag);
  }
  updateFavoritesBadge();
}

// Favorites actions
async function toggleFavorite(placeId) {
  if (!currentUser) {
    alert('Войдите, чтобы использовать избранное');
    return;
  }
  const favRef = doc(db, 'users', currentUser.uid, 'favorites', placeId);
  const wasFav = favoritesSet.has(placeId);

  // Оптимистичное обновление UI
  if (wasFav) favoritesSet.delete(placeId); else favoritesSet.add(placeId);
  updateFavoritesBadge();
  applyFilters();
  try {
    if (wasFav) {
      await deleteDoc(favRef);
    } else {
      await setDoc(favRef, { createdAt: serverTimestamp() });
    }
  } catch (err) {
    // Откат при ошибке
    if (wasFav) favoritesSet.add(placeId); else favoritesSet.delete(placeId);
    updateFavoritesBadge();
    applyFilters();
    alert('Не удалось обновить избранное: ' + err.message);
  }
}

async function toggleFavoriteOSM(osmId, data) {
  if (!currentUser) {
    alert('Войдите, чтобы использовать избранное');
    return;
  }
  const favRef = doc(db, 'users', currentUser.uid, 'favorites_osm', osmId);
  const wasFav = favoritesOsmSet.has(osmId);

  // Оптимистичное обновление UI
  if (wasFav) favoritesOsmSet.delete(osmId); else favoritesOsmSet.add(osmId);
  updateFavoritesBadge();
  applyFiltersOSM();
  try {
    if (wasFav) {
      await deleteDoc(favRef);
    } else {
      await setDoc(favRef, {
        osmId,
        type: data.type,     // 'node' | 'way'
        name: data.name || 'OSM объект',
        lat: data.lat,
        lng: data.lng,
        tags: data.tags || {},
        addedAt: serverTimestamp()
      });
    }
  } catch (err) {
    if (wasFav) favoritesOsmSet.add(osmId); else favoritesOsmSet.delete(osmId);
    updateFavoritesBadge();
    applyFiltersOSM();
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

    // подгрузим недостающие документы избранного
    const missing = Array.from(favoritesSet).filter(id => !markersMap.has(id) && !favoritePlacesCache.has(id));
    if (missing.length) {
      await Promise.all(missing.map(async (id) => {
        try {
          const r = await getDoc(doc(db, 'places', id));
          favoritePlacesCache.set(id, r.exists() ? { id, ...r.data() } : null);
        } catch {
          favoritePlacesCache.set(id, null);
        }
      }));
    }

    applyFilters();
    renderFavoritesPanel();
    updateFavoritesBadge();
  });
}

function subscribeFavoritesOSM() {
  if (!currentUser) return;
  const favCol = collection(db, 'users', currentUser.uid, 'favorites_osm');
  if (unsubFavoritesOSM) unsubFavoritesOSM();
  unsubFavoritesOSM = onSnapshot(favCol, (snap) => {
    favoritesOsmSet.clear();
    favoritesOsmMap.clear();
    snap.forEach(d => {
      favoritesOsmSet.add(d.id);
      favoritesOsmMap.set(d.id, { id: d.id, ...d.data() });
    });
    applyFiltersOSM();
    renderFavoritesPanel();
    updateFavoritesBadge();
  });
}

// Auth UI
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
    updateFavoritesBadge();
  } else {
    loginBtn?.classList.remove('hidden');
    logoutBtn?.classList.add('hidden');
    userInfo?.classList.add('hidden');
    if (adminLink) adminLink.classList.add('hidden');
    isAdmin = false;

    if (unsubFavorites) unsubFavorites();
    unsubFavorites = null;
    favoritesSet.clear();

    if (unsubFavoritesOSM) unsubFavoritesOSM();
    unsubFavoritesOSM = null;
    favoritesOsmSet.clear();

    favoritePlacesCache.clear();
    favoritesOsmMap.clear();

    subscribeData(); // reload approved only
    applyFilters();
    applyFiltersOSM();
    updateFavoritesBadge();
    closeFavorites();
  }
});

// Subscribe data (approved + my pending/rejected)
function subscribeData() {
  // remove all current markers
  placesLayer?.clearLayers();
  markersMap.clear();

  if (unsubApproved) unsubApproved();
  if (unsubMine) unsubMine();
  unsubApproved = null;
  unsubMine = null;

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
    applyFilters();
    applyFiltersOSM();
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
      applyFilters();
      applyFiltersOSM();
    });
  }
}

// Add modal
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
addPlaceBtn?.addEventListener('click', () => {
  if (!currentUser) {
    alert('Войдите, чтобы добавлять объекты');
    return;
  }
  openAddModal();
});
closeModalAdd?.addEventListener('click', closeAddModal);
cancelAdd?.addEventListener('click', closeAddModal);

addPlaceForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { alert('Войдите'); return; }

  const name = placeName.value.trim();
  const description = placeDescription.value.trim();
  const security = placeSecurity.value;
  const access = placeAccess.value;
  const loot = placeLoot.value.trim().length
    ? placeLoot.value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,20)
    : [];
  const lat = parseFloat(placeLat.value);
  const lng = parseFloat(placeLng.value);

  if (!name || isNaN(lat) || isNaN(lng)) {
    addStatus.textContent = 'Проверьте название и координаты';
    return;
  }

  addStatus.textContent = 'Сохраняем...';
  try {
    await addDoc(collection(db, 'places'), {
      name, description, security, access, loot,
      lat, lng,
      status: 'pending',
      photos: [],            // фото временно отключены
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });
    addStatus.textContent = 'Отправлено на модерацию. Спасибо!';
    setTimeout(closeAddModal, 800);
  } catch (err) {
    console.error(err);
    addStatus.textContent = 'Ошибка: ' + err.message;
  }
});

// Delete place
async function deletePlace(placeId) {
  if (!confirm('Удалить объект?')) return;
  try {
    await deleteDoc(doc(db, 'places', placeId));
  } catch (e) {
    alert('Ошибка удаления (возможно нет прав): ' + e.message);
  }
}

// Filters + debounce both lists
function scheduleApplyAll() {
  if (scheduleApplyAll._t) clearTimeout(scheduleApplyAll._t);
  scheduleApplyAll._t = setTimeout(() => {
    applyFilters();
    applyFiltersOSM();
  }, 200);
}
[filterAccess, filterSecurity, onlyFavorites].forEach(el => el?.addEventListener('change', scheduleApplyAll));
searchInput?.addEventListener('input', scheduleApplyAll);

// Routing
function startRoutingTo(targetLatLng) {
  if (!navigator.geolocation) {
    alert('Геолокация недоступна');
    return;
  }
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
      // Для своего ключа: L.Routing.openrouteservice('YOUR_KEY')
    }).addTo(map);
    updateClearRouteBtn();
  }, () => alert('Не удалось получить геолокацию'));
}

// OSM/Overpass
let osmFetchTimer = null;
function throttleFetchOSM() {
  if (osmFetchTimer) clearTimeout(osmFetchTimer);
  osmFetchTimer = setTimeout(fetchOSMByView, 600);
}
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
      const type = el.type;            // 'node' | 'way'
      const id = el.id;
      const osmId = `${type}-${id}`;

      const lat = el.lat || el.center?.lat;
      const lng = el.lon || el.center?.lon;
      if (!lat || !lng) return;

      const name = el.tags?.name || el.tags?.["name:ru"] || 'OSM: объект без имени';
      const tags = el.tags || {};

      const favTxt = favoritesOsmSet.has(osmId) ? '★ Убрать из избранного' : '☆ В избранное';
      const tagsHtml = Object.entries(tags).map(([k,v])=>`${k}=${v}`).slice(0,12).join('<br/>');

      const marker = L.marker([lat, lng], { icon: makeDivIcon('#4ea0ff') })
        .bindPopup(`
          <b>${name}</b><br/>
          <small>из OSM/Overpass</small><br/>
          <div style="max-width:240px">${tagsHtml}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="osm-route">Маршрут</button>
            <button type="button" class="osm-fav" data-id="${osmId}">${favTxt}</button>
          </div>
        `)
        .addTo(osmLayer);

      marker._osmData = { id: osmId, name, lat, lng, type, tags };
      osmMarkersMap.set(osmId, marker);

      marker.on('popupopen', () => {
        const node = marker.getPopup().getElement();
        node.querySelector('.osm-route').addEventListener('click', ()=> startRoutingTo([lat, lng]));
        node.querySelector('.osm-fav').addEventListener('click', () => {
          toggleFavoriteOSM(osmId, { name, lat, lng, type, tags });
        });
      });
    });

    applyFiltersOSM();
  } catch (e) {
    console.warn('Overpass error', e);
  }
}
