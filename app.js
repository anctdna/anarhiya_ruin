import { firebaseConfig, FALLBACK_ADMIN_UIDS } from './firebase-config.js';

// Firebase SDK v10 (modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc,
  query, where, onSnapshot, deleteDoc, serverTimestamp
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

// Favorites UI (опционально — модалка)
const openFavoritesBtn = document.getElementById('openFavorites');
const favoritesModal = document.getElementById('favoritesModal');
const closeFavoritesBtn = document.getElementById('closeFavorites');
const favoritesPlacesListEl = document.getElementById('favoritesPlacesList');
const favoritesOsmListEl = document.getElementById('favoritesOsmList');

// ---- Favorites modal ----
function openFavorites() {
  if (!currentUser) {
    alert('Войдите, чтобы видеть избранное');
    return;
  }
  if (!favoritesModal) return;
  favoritesModal.classList.remove('hidden');
  renderFavoritesPanel();
}
function closeFavorites() {
  if (!favoritesModal) return;
  favoritesModal.classList.add('hidden');
}

// Навешиваем обработчики
if (openFavoritesBtn) openFavoritesBtn.addEventListener('click', openFavorites);
if (closeFavoritesBtn) closeFavoritesBtn.addEventListener('click', closeFavorites);

// Вспомогательное получение данных места
function getFavPlaceData(id) {
  if (typeof getPlaceDataById === 'function') return getPlaceDataById(id);
  var m = markersMap.get(id);
  if (m && m._placeData) return m._placeData;
  return favoritePlacesCache.get ? (favoritePlacesCache.get(id) || null) : null;
}

// Рендер модалки
function renderFavoritesPanel() {
  if (!favoritesPlacesListEl || !favoritesOsmListEl) return;

  // Места
  favoritesPlacesListEl.innerHTML = '';
  var placeIds = Array.from(favoritesSet);
  if (placeIds.length === 0) {
    favoritesPlacesListEl.innerHTML = '<div class="muted">Пусто</div>';
  } else {
    var fragP = document.createDocumentFragment();
    placeIds.forEach(function(id) {
      var p = getFavPlaceData(id);
      var el = document.createElement('div');
      el.className = 'fav-item';
      if (!p) {
        el.innerHTML = ''+
          '<div class="title">[объект недоступен]</div>'+
          '<div class="actions"><button type="button" data-action="remove">Убрать</button></div>';
        var rm = el.querySelector('[data-action="remove"]');
        if (rm) rm.addEventListener('click', function(){ toggleFavorite(id); });
      } else {
        el.innerHTML = ''+
          '<div class="title">'+(p.name||'Без названия')+'</div>'+
          '<div class="meta">'+(p.access||'')+(p.security?(' • охрана: '+p.security):'')+'</div>'+
          '<div class="actions">'+
            '<button type="button" data-action="show">Показать</button>'+
            '<button type="button" data-action="route">Маршрут</button>'+
            '<button type="button" data-action="remove">Убрать</button>'+
          '</div>';
        var sh = el.querySelector('[data-action="show"]');
        if (sh) sh.addEventListener('click', function(){
          map.setView([p.lat, p.lng], 16);
          var m = markersMap.get(id);
          if (m && m.openPopup) m.openPopup();
          closeFavorites();
        });
        var rt = el.querySelector('[data-action="route"]');
        if (rt) rt.addEventListener('click', function(){
          startRoutingTo([p.lat, p.lng]);
          closeFavorites();
        });
        var rm2 = el.querySelector('[data-action="remove"]');
        if (rm2) rm2.addEventListener('click', function(){ toggleFavorite(id); });
      }
      fragP.appendChild(el);
    });
    favoritesPlacesListEl.appendChild(fragP);
  }

  // OSM
  favoritesOsmListEl.innerHTML = '';
  var osmItems = Array.from(favoritesOsmMap.values ? favoritesOsmMap.values() : []).map(function(v){return v;});
  if (osmItems.length === 0) {
    favoritesOsmListEl.innerHTML = '<div class="muted">Пусто</div>';
  } else {
    var fragO = document.createDocumentFragment();
    osmItems.forEach(function(d) {
      var lat = d.data ? d.data.lat : d.lat;
      var lng = d.data ? d.data.lng : d.lng;
      var name = (d.data ? d.data.name : d.name) || 'OSM объект';
      var osmId = d.id || d.osmId;

      var el = document.createElement('div');
      el.className = 'fav-item';
      el.innerHTML = ''+
        '<div class="title">'+name+'</div>'+
        '<div class="meta">'+((d.data?d.data.type:d.type)||'').toString().toUpperCase()+' • '+(+lat).toFixed(5)+', '+(+lng).toFixed(5)+'</div>'+
        '<div class="actions">'+
          '<button type="button" data-action="show">Показать</button>'+
          '<button type="button" data-action="route">Маршрут</button>'+
          '<button type="button" data-action="remove">Убрать</button>'+
        '</div>';

      var sh = el.querySelector('[data-action="show"]');
      if (sh) sh.addEventListener('click', function(){
        map.setView([lat, lng], 16);
        // пробуем открыть verified, затем dynamic, иначе временный маркер
        var mv = osmVerifiedMarkersMap.get(osmId);
        if (mv && mv.openPopup) mv.openPopup();
        else {
          var md = osmMarkersMap.get(osmId);
          if (md && md.openPopup) {
            if (toggleOSM && !toggleOSM.checked) {
              toggleOSM.checked = true;
              toggleOSM.dispatchEvent(new Event('change'));
            }
            md.openPopup();
          } else {
            var temp = L.marker([lat, lng], { icon: makeDivIcon('#4ea0ff') })
              .bindPopup('<b>'+name+'</b><br/><small>из избранного OSM</small>')
              .addTo(osmVerifiedLayer)
              .openPopup();
            setTimeout(function(){ try { osmVerifiedLayer.removeLayer(temp); } catch(_){} }, 8000);
          }
        }
        closeFavorites();
      });

      var rt = el.querySelector('[data-action="route"]');
      if (rt) rt.addEventListener('click', function(){
        startRoutingTo([lat, lng]);
        closeFavorites();
      });

      var rm = el.querySelector('[data-action="remove"]');
      if (rm) rm.addEventListener('click', function(){
        toggleFavoriteOSM(osmId, { name:name, lat:lat, lng:lng, type:(d.data?d.data.type:d.type)||'node', tags:(d.data?d.data.tags:d.tags)||{} });
      });

      fragO.appendChild(el);
    });
    favoritesOsmListEl.appendChild(fragO);
  }
}

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

const markersMap = new Map();            // placeId -> marker (наши)
const favoritesSet = new Set();          // placeId
const favoritesOsmSet = new Set();       // osmId ("node-123"|"way-456")
const osmMarkersMap = new Map();         // osmId -> marker (динамические OSM)

const favoritePlacesCache = new Map();   // placeId -> data|null
const favoritesOsmMap = new Map();       // osmId -> fav data

// OSM moderation
const osmModerationMap = new Map();      // osmId -> { status, note, overrides, lat, lng, baseName, type, tagsSnapshot, ... }
const verifiedHydrateInFlight = new Set();

// Verified OSM — всегда видны
let osmVerifiedLayer;                     // слой всегда на карте
const osmVerifiedMarkersMap = new Map();  // osmId -> marker

let map, routingControl, placesLayer, osmLayer, tempAddMarker = null;

// Consts
const SECURITY_OPTIONS = ['none','low','medium','high'];
const ACCESS_OPTIONS = ['open','partial','closed'];

// Helpers
function makeDivIcon(color) {
  const c = color || '#ff3b3b';
  const html = '<div style="width:14px;height:14px;border-radius:50%;background:'+c+';border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>';
  return L.divIcon({ className: 'custom-div-icon', html, iconSize: [18,18], iconAnchor:[9,9] });
}
function parseLoot(str) {
  return (str || '').split(',').map(function(s){return s.trim();}).filter(Boolean).slice(0,20);
}
function updateFavoritesBadge() {
  if (!favoritesCountBadge) return;
  var total = favoritesSet.size + favoritesOsmSet.size;
  favoritesCountBadge.textContent = total;
  favoritesCountBadge.style.display = total ? 'inline-block' : 'none';
}

// Map init
function initMap() {
  map = L.map('map').setView([55.751244, 37.618423], 10);
  var tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  });
  tile.addTo(map);

  placesLayer = L.layerGroup().addTo(map);
  osmLayer = L.layerGroup();                 // по тумблеру
  osmVerifiedLayer = L.layerGroup().addTo(map); // всегда

  // Добавление по ПКМ
  map.on('contextmenu', function(e){
    try { if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent); } catch(_){}
    if (!currentUser) { alert('Чтобы добавить объект, войдите в аккаунт'); return; }
    if (modalAdd && modalAdd.classList.contains('hidden')) openAddModal();
    if (placeLat) placeLat.value = e.latlng.lat.toFixed(6);
    if (placeLng) placeLng.value = e.latlng.lng.toFixed(6);
    if (tempAddMarker) {
      tempAddMarker.setLatLng(e.latlng);
    } else {
      tempAddMarker = L.marker(e.latlng, { draggable: true }).addTo(map);
      tempAddMarker.on('dragend', function() {
        var ll = tempAddMarker.getLatLng();
        if (placeLat) placeLat.value = ll.lat.toFixed(6);
        if (placeLng) placeLng.value = ll.lng.toFixed(6);
      });
    }
  });

  // Глобальный безопасный обработчик попапов
  map.on('popupopen', onPopupOpen);

  // Locate
  L.control.locate = function() {
    var control = L.control({position: 'topleft'});
    control.onAdd = function() {
      var btn = L.DomUtil.create('a', 'leaflet-bar');
      btn.href = '#';
      btn.title = 'Моё местоположение';
      btn.innerHTML = '📍';
      btn.style.padding = '6px 8px';
      btn.style.background = '#fff';
      L.DomEvent.on(btn, 'click', function(ev){
        ev.preventDefault();
        if (!navigator.geolocation) { alert('Геолокация недоступна'); return; }
        navigator.geolocation.getCurrentPosition(function(pos){
          var latlng = [pos.coords.latitude, pos.coords.longitude];
          map.setView(latlng, 14);
          L.circleMarker(latlng, {radius:6, color:'#00c389'}).addTo(map);
        }, function(){ alert('Не удалось получить геолокацию'); });
      });
      return btn;
    };
    return control;
  };
  L.control.locate().addTo(map);

  // Clear route control
  clearRouteControl = L.control({position:'topleft'});
  clearRouteControl.onAdd = function() {
    var btn = L.DomUtil.create('a', 'leaflet-bar');
    btn.href = '#';
    btn.title = 'Сбросить маршрут (Esc)';
    btn.innerHTML = '✖';
    btn.style.padding = '6px 10px';
    btn.style.background = '#fff';
    btn.style.display = 'none';
    L.DomEvent.on(btn, 'click', function(e){ e.preventDefault(); clearRoute(); });
    this._btn = btn;
    return btn;
  };
  clearRouteControl.addTo(map);
  window.addEventListener('keydown', function(e){ if (e.key === 'Escape') clearRoute(); });

  // OSM toggle
  if (toggleOSM) {
    toggleOSM.addEventListener('change', function(){
      if (toggleOSM.checked) {
        map.addLayer(osmLayer);
        fetchOSMByView();
      } else {
        map.removeLayer(osmLayer);
        osmLayer.clearLayers();
        osmMarkersMap.clear();
        renderUnifiedList();
      }
    });
  }
  map.on('moveend', function(){ if (toggleOSM && toggleOSM.checked) throttleFetchOSM(); });
}
initMap();

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

// Popupopen handler
function onPopupOpen(e) {
  var container = e && e.popup && e.popup.getElement ? e.popup.getElement() : null;
  if (!container) return;
  var src = e.popup._source;

  // OSM
  if (src && src._osmData) {
    var d = src._osmData;
    var mod = osmModerationMap.get(d.osmId) || {};
    var ov = mod.overrides || {};

    var nameEl = container.querySelector('.osm-edit-name');
    var accessEl = container.querySelector('.osm-edit-access');
    var secEl = container.querySelector('.osm-edit-security');
    var lootEl = container.querySelector('.osm-edit-loot');
    if (nameEl) nameEl.value = ov.name || d.baseName || '';
    if (accessEl) accessEl.value = ov.access || '';
    if (secEl) secEl.value = ov.security || '';
    if (lootEl) lootEl.value = Array.isArray(ov.loot) ? ov.loot.join(', ') : '';

    var btn;
    btn = container.querySelector('.osm-route'); if (btn) btn.addEventListener('click', function(ev){ ev.preventDefault(); startRoutingTo([d.lat, d.lng]); });
    btn = container.querySelector('.osm-fav'); if (btn) btn.addEventListener('click', function(ev){ ev.preventDefault(); toggleFavoriteOSM(d.osmId, { name: ov.name || d.baseName || '', lat: d.lat, lng: d.lng, type: d.type, tags: d.tags }); });

    btn = container.querySelector('.osm-report-flag'); if (btn) btn.addEventListener('click', async function(ev){
      ev.preventDefault();
      if (!currentUser) { alert('Войдите, чтобы отправлять жалобы'); return; }
      var reason = prompt('Почему объект спорный? (необязательно)') || '';
      await submitOsmReport(d.osmId, 'flag', { reason: reason });
    });
    btn = container.querySelector('.osm-report-note'); if (btn) btn.addEventListener('click', async function(ev){
      ev.preventDefault();
      if (!currentUser) { alert('Войдите, чтобы отправлять заметки'); return; }
      var note = prompt('Заметка (увидит модератор):', '') || '';
      if (note.trim()) await submitOsmReport(d.osmId, 'note', { note: note });
    });

    btn = container.querySelector('.osm-edit-save'); if (btn) btn.addEventListener('click', async function(ev){
      ev.preventDefault();
      var fields = {
        name: (nameEl && nameEl.value ? nameEl.value : '').trim().slice(0,120),
        access: (accessEl && ACCESS_OPTIONS.indexOf(accessEl.value)>=0) ? accessEl.value : '',
        security: (secEl && SECURITY_OPTIONS.indexOf(secEl.value)>=0) ? secEl.value : '',
        loot: parseLoot(lootEl ? lootEl.value : '')
      };
      if (isAdmin) {
        var overrides = {};
        if (fields.name) overrides.name = fields.name;
        if (fields.access) overrides.access = fields.access;
        if (fields.security) overrides.security = fields.security;
        if (fields.loot && fields.loot.length) overrides.loot = fields.loot;
        await saveOsmOverrides(d.osmId, overrides);
        renderOsmPopup(src); src.openPopup();
      } else {
        await submitOsmReport(d.osmId, 'suggestion', fields);
      }
    });

    if (isAdmin) {
      btn = container.querySelector('.osm-mod-verify'); if (btn) btn.addEventListener('click', async function(ev){
        ev.preventDefault();
        await setOsmModeration(d.osmId, 'verified', undefined, d);
        ensureVerifiedMarkerFromDoc(d.osmId, { status:'verified', lat:d.lat, lng:d.lng, baseName:d.baseName, type:d.type, tagsSnapshot:d.tags });
        renderOsmPopup(src); src.openPopup();
      });
      btn = container.querySelector('.osm-mod-unverify'); if (btn) btn.addEventListener('click', async function(ev){
        ev.preventDefault();
        await setOsmModeration(d.osmId, 'visible', undefined, d); // отмена подтверждения
        renderOsmPopup(src); src.openPopup();
      });
      btn = container.querySelector('.osm-mod-flag'); if (btn) btn.addEventListener('click', async function(ev){
        ev.preventDefault();
        await setOsmModeration(d.osmId, 'flagged', undefined, d);
        renderOsmPopup(src); src.openPopup();
      });
      btn = container.querySelector('.osm-mod-hide'); if (btn) btn.addEventListener('click', async function(ev){
        ev.preventDefault();
        var curr = (osmModerationMap.get(d.osmId) || {}).status;
        var next = curr === 'hidden' ? 'visible' : 'hidden';
        await setOsmModeration(d.osmId, next, undefined, d);
        renderOsmPopup(src); src.openPopup();
      });
    }
  }

  // Наше место — подстраховка
  if (src && src._placeData) {
    var p = src._placeData;
    var btn2;
    btn2 = container.querySelector('.pm-route'); if (btn2) btn2.addEventListener('click', function(ev){ ev.preventDefault(); startRoutingTo([p.lat, p.lng]); });
    btn2 = container.querySelector('.pm-fav'); if (btn2) btn2.addEventListener('click', function(ev){ ev.preventDefault(); toggleFavorite(p.id); });
    btn2 = container.querySelector('.pm-del'); if (btn2) btn2.addEventListener('click', function(ev){ ev.preventDefault(); deletePlace(p.id); });
  }
}

// Places
function placeMatchesFilters(place) {
  var byAccess = !filterAccess || !filterAccess.value || place.access === filterAccess.value;
  var bySec = !filterSecurity || !filterSecurity.value || place.security === filterSecurity.value;
  var q = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase();
  var bySearch = !q || (place.name && place.name.toLowerCase().includes(q)) || (place.description && place.description.toLowerCase().includes(q));
  var byFav = !onlyFavorites || !onlyFavorites.checked || favoritesSet.has(place.id);
  return byAccess && bySec && bySearch && byFav;
}
function renderPlaceItem(place) {
  var el = document.createElement('div');
  el.className = 'place-item';
  el.dataset.id = place.id;
  var statusBadge = place.status === 'approved' ? '<span class="badge approved">одобрено</span>' :
                    place.status === 'pending'  ? '<span class="badge pending">на модерации</span>' :
                                                   '<span class="badge rejected">отклонено</span>';
  var lootText = (place.loot && place.loot.length) ? ' • лут: ' + place.loot.join(', ') : '';
  el.innerHTML = ''+
    '<h4>'+place.name+' '+statusBadge+'</h4>'+
    '<div class="place-meta">'+(place.access||'')+' • охрана: '+(place.security||'')+lootText+'</div>'+
    '<div class="place-actions">'+
      '<button type="button" data-action="fly">Показать на карте</button>'+
      '<button type="button" data-action="route">Маршрут</button>'+
      '<button type="button" data-action="favorite">'+(favoritesSet.has(place.id)?'★ В избранном':'☆ В избранное')+'</button>'+
      ((currentUser && (place.createdBy === currentUser.uid || isAdmin)) ? '<button type="button" data-action="delete" class="danger">Удалить</button>' : '')+
    '</div>';
  var b;
  b = el.querySelector('[data-action="fly"]'); if (b) b.addEventListener('click', function(){ map.setView([place.lat, place.lng], 16); });
  b = el.querySelector('[data-action="route"]'); if (b) b.addEventListener('click', function(){ startRoutingTo([place.lat, place.lng]); });
  b = el.querySelector('[data-action="favorite"]'); if (b) b.addEventListener('click', function(){ toggleFavorite(place.id); });
  b = el.querySelector('[data-action="delete"]'); if (b) b.addEventListener('click', function(){ deletePlace(place.id); });
  return el;
}
function upsertMarker(place) {
  var color = place.status === 'approved' ? '#ff3b3b' : (place.status === 'pending' ? '#ff8a00' : '#555');
  var icon = makeDivIcon(color);
  var marker = markersMap.get(place.id);
  if (!marker) {
    marker = L.marker([place.lat, place.lng], { icon: icon }).addTo(placesLayer);
    markersMap.set(place.id, marker);
  } else {
    marker.setLatLng([place.lat, place.lng]);
    marker.setIcon(icon);
  }
  var favTxt = favoritesSet.has(place.id) ? '★ Убрать из избранного' : '☆ В избранное';
  var photosHtml = (place.photos && place.photos.length)
    ? '<div class="gallery">'+place.photos.map(function(u){return '<img src="'+u+'" loading="lazy" />';}).join('')+'</div>' : '';
  var popupHtml = ''+
    '<b>'+place.name+'</b><br/>'+
    '<small>'+(place.access||'')+' • охрана: '+(place.security||'')+'</small><br/>'+
    '<div>'+((place.description||'').replace(/\n/g,'<br/>'))+'</div>'+
    photosHtml+
    '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+
      '<button type="button" class="pm-route">Маршрут</button>'+
      '<button type="button" class="pm-fav" data-id="'+place.id+'">'+favTxt+'</button>'+
      ((currentUser && (place.createdBy === (currentUser ? currentUser.uid : '') || isAdmin))?'<button type="button" class="pm-del">Удалить</button>':'')+
      '<a href="https://www.openstreetmap.org/?mlat='+place.lat+'&mlon='+place.lng+'#map=18/'+place.lat+'/'+place.lng+'" target="_blank">OSM</a>'+
    '</div>';
  marker.bindPopup(popupHtml);
  marker._placeData = place;
  applyFiltersToMarker(marker);
}
function applyFiltersToMarker(marker) {
  var p = marker._placeData;
  if (!p) return;
  var visible = placeMatchesFilters(p);
  if (visible) { if (!placesLayer.hasLayer(marker)) marker.addTo(placesLayer); var el = marker.getElement(); if (el) el.classList.remove('hidden'); }
  else { placesLayer.removeLayer(marker); }
}
function applyFilters() {
  markersMap.forEach(function(marker){ applyFiltersToMarker(marker); });
  refreshOpenPopupsFavoritesUI();
  renderUnifiedList();
}

// Favorites (places)
function refreshOpenPopupsFavoritesUI() {
  var list = document.querySelectorAll('.leaflet-popup .pm-fav');
  for (var i=0;i<list.length;i++) {
    var btn = list[i];
    var id = btn.dataset.id;
    if (!id) continue;
    btn.textContent = favoritesSet.has(id) ? '★ Убрать из избранного' : '☆ В избранное';
  }
}
async function toggleFavorite(placeId) {
  if (!currentUser) { alert('Войдите, чтобы использовать избранное'); return; }
  var favRef = doc(db, 'users', currentUser.uid, 'favorites', placeId);
  var wasFav = favoritesSet.has(placeId);
  if (wasFav) favoritesSet.delete(placeId); else favoritesSet.add(placeId);
  updateFavoritesBadge(); applyFilters(); renderUnifiedList();
  try {
    if (wasFav) await deleteDoc(favRef);
    else await setDoc(favRef, { createdAt: serverTimestamp() });
  } catch (err) {
    if (wasFav) favoritesSet.add(placeId); else favoritesSet.delete(placeId);
    updateFavoritesBadge(); applyFilters(); renderUnifiedList();
    alert('Не удалось обновить избранное: ' + err.message);
  }
}
function subscribeFavorites() {
  if (!currentUser) return;
  var favCol = collection(db, 'users', currentUser.uid, 'favorites');
  if (unsubFavorites) unsubFavorites();
  unsubFavorites = onSnapshot(favCol, async function(snap){
    favoritesSet.clear();
    snap.forEach(function(d){ favoritesSet.add(d.id); });
    applyFilters(); updateFavoritesBadge(); renderUnifiedList();
  });
}

// Favorites (OSM)
function refreshOpenOSMPopupsFavoritesUI() {
  var list = document.querySelectorAll('.leaflet-popup .osm-fav');
  for (var i=0;i<list.length;i++) {
    var btn = list[i];
    var id = btn.dataset.id;
    if (!id) continue;
    btn.textContent = favoritesOsmSet.has(id) ? '★ Убрать из избранного' : '☆ В избранное';
  }
}
async function toggleFavoriteOSM(osmId, data) {
  if (!currentUser) { alert('Войдите, чтобы использовать избранное'); return; }
  var favRef = doc(db, 'users', currentUser.uid, 'favorites_osm', osmId);
  var wasFav = favoritesOsmSet.has(osmId);
  if (wasFav) favoritesOsmSet.delete(osmId); else favoritesOsmSet.add(osmId);
  updateFavoritesBadge(); applyFiltersOSM(); renderUnifiedList();
  try {
    if (wasFav) await deleteDoc(favRef);
    else await setDoc(favRef, {
      osmId: osmId, type: data.type, name: data.name || 'OSM объект',
      lat: data.lat, lng: data.lng, tags: data.tags || {}, addedAt: serverTimestamp()
    });
  } catch (err) {
    if (wasFav) favoritesOsmSet.add(osmId); else favoritesOsmSet.delete(osmId);
    updateFavoritesBadge(); applyFiltersOSM(); renderUnifiedList();
    alert('Не удалось обновить избранное OSM: ' + err.message);
  }
}
function subscribeFavoritesOSM() {
  if (!currentUser) return;
  var favCol = collection(db, 'users', currentUser.uid, 'favorites_osm');
  if (unsubFavoritesOSM) unsubFavoritesOSM();
  unsubFavoritesOSM = onSnapshot(favCol, function(snap){
    favoritesOsmSet.clear(); favoritesOsmMap.clear();
    snap.forEach(function(d){ favoritesOsmSet.add(d.id); favoritesOsmMap.set(d.id, { id: d.id, data: d.data() }); });
    applyFiltersOSM(); updateFavoritesBadge(); renderUnifiedList();
  });
}

// Auth
if (loginBtn) loginBtn.addEventListener('click', async function(){
  var provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); } catch (err) { alert(err.message); }
});
if (logoutBtn) logoutBtn.addEventListener('click', function(){ signOut(auth); });

async function loadAdminStatus(uid) {
  try {
    var conf = await getDoc(doc(db, 'config', 'admins'));
    var uids = conf.exists() ? (conf.data().uids || []) : [];
    return (uids && uids.includes && uids.includes(uid)) || (FALLBACK_ADMIN_UIDS && FALLBACK_ADMIN_UIDS.includes && FALLBACK_ADMIN_UIDS.includes(uid));
  } catch(e) {
    return (FALLBACK_ADMIN_UIDS && FALLBACK_ADMIN_UIDS.includes && FALLBACK_ADMIN_UIDS.includes(uid));
  }
}

onAuthStateChanged(auth, async function(user){
  currentUser = user || null;
  if (currentUser) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.remove('hidden');
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
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (userInfo) userInfo.classList.add('hidden');
    if (adminLink) adminLink.classList.add('hidden');
    isAdmin = false;

    if (unsubFavorites) unsubFavorites(); unsubFavorites = null; favoritesSet.clear();
    if (unsubFavoritesOSM) unsubFavoritesOSM(); unsubFavoritesOSM = null; favoritesOsmSet.clear();

    favoritePlacesCache.clear(); favoritesOsmMap.clear();

    subscribeData(); applyFilters(); applyFiltersOSM(); updateFavoritesBadge(); renderUnifiedList();
  }
});

// Data (places)
function subscribeData() {
  if (placesLayer) placesLayer.clearLayers();
  markersMap.clear();
  if (unsubApproved) unsubApproved();
  if (unsubMine) unsubMine();
  unsubApproved = null; unsubMine = null;

  var approvedQ = query(collection(db, 'places'), where('status', '==', 'approved'));
  unsubApproved = onSnapshot(approvedQ, function(snap){
    snap.docChanges().forEach(function(ch){
      if (ch.type === 'removed') {
        var m = markersMap.get(ch.doc.id);
        if (m) { placesLayer.removeLayer(m); markersMap.delete(ch.doc.id); }
      } else {
        var d = Object.assign({ id: ch.doc.id }, ch.doc.data());
        upsertMarker(d);
      }
    });
    applyFilters(); applyFiltersOSM(); renderUnifiedList();
  });

  if (currentUser) {
    var mineQ = query(collection(db, 'places'), where('createdBy', '==', currentUser.uid));
    unsubMine = onSnapshot(mineQ, function(snap){
      snap.docChanges().forEach(function(ch){
        var d = Object.assign({ id: ch.doc.id }, ch.doc.data());
        if (d.status !== 'approved') {
          if (ch.type === 'removed') {
            var m = markersMap.get(d.id);
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

// Add modal
function openAddModal() {
  if (!addPlaceForm || !modalAdd) return;
  if (addStatus) addStatus.textContent = '';
  addPlaceForm.reset();
  modalAdd.classList.remove('hidden');
  setTimeout(function(){ if (placeName) placeName.focus(); }, 0);
}
function closeAddModal() {
  if (!modalAdd) return;
  modalAdd.classList.add('hidden');
  if (tempAddMarker) { tempAddMarker.remove(); tempAddMarker = null; }
}
if (addPlaceBtn) addPlaceBtn.addEventListener('click', function(){
  if (!currentUser) { alert('Войдите, чтобы добавлять объекты'); return; }
  openAddModal();
});
if (closeModalAdd) closeModalAdd.addEventListener('click', closeAddModal);
if (cancelAdd) cancelAdd.addEventListener('click', closeAddModal);
if (addPlaceForm) addPlaceForm.addEventListener('submit', async function(e){
  e.preventDefault();
  if (!currentUser) { alert('Войдите'); return; }
  var name = (placeName && placeName.value ? placeName.value : '').trim();
  var description = (placeDescription && placeDescription.value ? placeDescription.value : '').trim();
  var security = placeSecurity ? placeSecurity.value : '';
  var access = placeAccess ? placeAccess.value : '';
  var loot = parseLoot(placeLoot ? placeLoot.value : '');
  var lat = placeLat ? parseFloat(placeLat.value) : NaN;
  var lng = placeLng ? parseFloat(placeLng.value) : NaN;
  if (!name || isNaN(lat) || isNaN(lng)) {
    if (addStatus) addStatus.textContent = 'Проверьте название и координаты';
    return;
  }
  if (addStatus) addStatus.textContent = 'Сохраняем...';
  try {
    await addDoc(collection(db, 'places'), {
      name: name, description: description, security: security, access: access, loot: loot,
      lat: lat, lng: lng, status: 'pending', photos: [],
      createdBy: currentUser.uid, createdAt: serverTimestamp()
    });
    if (addStatus) addStatus.textContent = 'Отправлено на модерацию. Спасибо!';
    setTimeout(closeAddModal, 800);
  } catch (err) {
    console.error(err);
    if (addStatus) addStatus.textContent = 'Ошибка: ' + err.message;
  }
});

// Delete place
async function deletePlace(placeId) {
  if (!confirm('Удалить объект?')) return;
  try { await deleteDoc(doc(db, 'places', placeId)); }
  catch (e) { alert('Ошибка удаления (возможно нет прав): ' + e.message); }
}

// Filters debounce
function scheduleApplyAll() {
  if (scheduleApplyAll._t) clearTimeout(scheduleApplyAll._t);
  scheduleApplyAll._t = setTimeout(function(){ applyFilters(); applyFiltersOSM(); renderUnifiedList(); }, 200);
}
[filterAccess, filterSecurity, onlyFavorites].forEach(function(el){ if (el) el.addEventListener('change', scheduleApplyAll); });
if (searchInput) searchInput.addEventListener('input', scheduleApplyAll);

// Routing
function startRoutingTo(targetLatLng) {
  if (!navigator.geolocation) { alert('Геолокация недоступна'); return; }
  navigator.geolocation.getCurrentPosition(function(pos){
    var start = L.latLng(pos.coords.latitude, pos.coords.longitude);
    var end = L.latLng(targetLatLng[0], targetLatLng[1]);
    if (routingControl) map.removeControl(routingControl);
    routingControl = L.Routing.control({
      waypoints: [start, end],
      routeWhileDragging: false,
      showAlternatives: true,
      collapsible: true,
      router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' })
    }).addTo(map);
    updateClearRouteBtn();
  }, function(){ alert('Не удалось получить геолокацию'); });
}

// OSM moderation helpers
function getOsmStatusColor(status) {
  if (status === 'verified') return '#2ecc71';
  if (status === 'flagged') return '#ff8a00';
  if (status === 'hidden') return '#888888';
  return '#4ea0ff';
}
function humanOsmStatus(status) {
  if (status === 'verified') return 'подтверждён';
  if (status === 'flagged') return 'помечен';
  if (status === 'hidden') return 'скрыт';
  if (status === 'visible') return 'видим';
  return 'видим';
}
async function setOsmModeration(osmId, status, note, meta) {
  if (!currentUser || !isAdmin) { alert('Недостаточно прав для модерации OSM'); return; }
  try {
    var ref = doc(db, 'osm_moderation', osmId);
    var payload = {
      status: status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
      updatedByName: currentUser.displayName || ''
    };
    if (typeof note !== 'undefined') payload.note = note;
    if (meta) {
      if (typeof meta.lat === 'number') payload.lat = meta.lat;
      if (typeof meta.lng === 'number') payload.lng = meta.lng;
      if (meta.type) payload.type = meta.type;
      if (meta.baseName) payload.baseName = meta.baseName; else if (meta.name) payload.baseName = meta.name;
      if (meta.tags) payload.tagsSnapshot = meta.tags;
    }
    var prev = osmModerationMap.get(osmId) || {};
    osmModerationMap.set(osmId, Object.assign({}, prev, payload));
    applyFiltersOSM(); renderUnifiedList();
    await setDoc(ref, payload, { merge: true });
  } catch (e) {
    alert('Не удалось обновить статус OSM: ' + e.message);
  }
}
async function saveOsmOverrides(osmId, overrides) {
  if (!currentUser || !isAdmin) { alert('Недостаточно прав для сохранения правок'); return; }
  try {
    var ref = doc(db, 'osm_moderation', osmId);
    var payload = {
      overrides: overrides,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
      updatedByName: currentUser.displayName || ''
    };
    var prev = osmModerationMap.get(osmId) || {};
    osmModerationMap.set(osmId, Object.assign({}, prev, payload));
    applyFiltersOSM(); renderUnifiedList();
    await setDoc(ref, payload, { merge: true });
    alert('Правки сохранены');
  } catch (e) {
    alert('Не удалось сохранить правки: ' + e.message);
  }
}
async function submitOsmReport(osmId, type, data) {
  if (!currentUser) { alert('Войдите, чтобы отправлять жалобы/заметки'); return; }
  try {
    await addDoc(collection(db, 'osm_reports'), {
      osmId: osmId, type: type, data: data || {},
      createdAt: serverTimestamp(), createdBy: currentUser.uid, createdByName: currentUser.displayName || ''
    });
    alert(type === 'suggestion' ? 'Правка отправлена на модерацию' : 'Отправлено');
  } catch (e) {
    alert('Не удалось отправить: ' + e.message);
  }
}

// Overpass helpers
function parseOsmId(osmId) {
  var parts = (osmId || '').split('-');
  var type = parts[0], idStr = parts[1];
  var id = Number(idStr);
  if (['node','way'].indexOf(type) === -1 || !isFinite(id)) return null;
  return { type: type, id: id };
}
async function fetchOsmById(osmId) {
  var p = parseOsmId(osmId);
  if (!p) return null;
  var queryStr = '[out:json][timeout:25];'+p.type+'('+p.id+');out center tags;';
  var res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ data: queryStr })
  });
  var data = await res.json();
  var el = (data.elements || [])[0];
  if (!el) return null;
  var lat = (typeof el.lat === 'number') ? el.lat : (el.center ? el.center.lat : undefined);
  var lng = (typeof el.lon === 'number') ? el.lon : (el.center ? el.center.lon : undefined);
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  var name = (el.tags && (el.tags.name || el.tags['name:ru'])) || 'OSM: объект без имени';
  var tags = el.tags || {};
  return { lat: lat, lng: lng, name: name, type: p.type, tags: tags };
}
async function hydrateVerifiedFromOverpass(osmId) {
  if (verifiedHydrateInFlight.has(osmId)) return;
  verifiedHydrateInFlight.add(osmId);
  try {
    var el = await fetchOsmById(osmId);
    if (el) {
      if (isAdmin && currentUser) {
        await setDoc(doc(db, 'osm_moderation', osmId), {
          lat: el.lat, lng: el.lng, type: el.type, baseName: el.name, tagsSnapshot: el.tags
        }, { merge: true });
      }
      ensureVerifiedMarkerFromDoc(osmId, { status: 'verified', lat: el.lat, lng: el.lng, baseName: el.name, type: el.type, tagsSnapshot: el.tags });
      applyFiltersOSM(); renderUnifiedList();
    }
  } catch (e) {
    console.warn('hydrateVerifiedFromOverpass error', e);
  } finally {
    verifiedHydrateInFlight.delete(osmId);
  }
}
async function ensureVerifiedMarkerFromDoc(osmId, d) {
  var lat = d && d.lat, lng = d && d.lng, type = d && d.type, baseName = d && d.baseName, tags = d && d.tagsSnapshot;

  if (!(typeof lat === 'number' && typeof lng === 'number')) {
    var mdyn = osmMarkersMap.get(osmId);
    if (mdyn && mdyn._osmData) {
      var x = mdyn._osmData;
      lat = x.lat; lng = x.lng; type = x.type; baseName = x.baseName; tags = x.tags;
      if (isAdmin && currentUser) {
        await setDoc(doc(db, 'osm_moderation', osmId), { lat: lat, lng: lng, type: type, baseName: baseName, tagsSnapshot: tags }, { merge: true });
      }
    } else {
      await hydrateVerifiedFromOverpass(osmId);
      return;
    }
  }

  var markerData = {
    osmId: osmId,
    baseName: baseName || (d && d.overrides && d.overrides.name) || 'OSM: объект без имени',
    lat: lat, lng: lng,
    type: type || 'node',
    tags: tags || {}
  };

  var marker = osmVerifiedMarkersMap.get(osmId);
  if (!marker) {
    marker = L.marker([lat, lng], { icon: makeDivIcon(getOsmStatusColor(d && d.status)) }).addTo(osmVerifiedLayer);
    osmVerifiedMarkersMap.set(osmId, marker);
  } else {
    marker.setLatLng([lat, lng]);
    marker.setIcon(makeDivIcon(getOsmStatusColor(d && d.status)));
  }
  marker._osmData = markerData;
  renderOsmPopup(marker);
}
function removeVerifiedMarker(osmId) {
  var m = osmVerifiedMarkersMap.get(osmId);
  if (m) { osmVerifiedLayer.removeLayer(m); osmVerifiedMarkersMap.delete(osmId); }
}
function subscribeOsmModeration() {
  if (unsubOsmModeration) unsubOsmModeration();
  var col = collection(db, 'osm_moderation');
  unsubOsmModeration = onSnapshot(col, function(snap){
    snap.docChanges().forEach(function(ch){
      var id = ch.doc.id;
      if (ch.type === 'removed') {
        osmModerationMap.delete(id);
        removeVerifiedMarker(id);
      } else {
        var data = ch.doc.data();
        osmModerationMap.set(id, data);
        if (data.status === 'verified') ensureVerifiedMarkerFromDoc(id, data);
        else removeVerifiedMarker(id);
      }
    });
    applyFiltersOSM(); renderUnifiedList();
  });
}
subscribeOsmModeration();

// OSM popup
function renderOsmPopup(marker) {
  var d = marker._osmData;
  var mod = osmModerationMap.get(d.osmId) || {};
  var ov = mod.overrides || {};
  var displayName = ov.name || d.baseName || 'OSM: объект без имени';
  var favTxt = favoritesOsmSet.has(d.osmId) ? '★ Убрать из избранного' : '☆ В избранное';
  var tagsHtml = Object.keys(d.tags || {}).map(function(k){ return k+'='+(d.tags[k]); }).slice(0,12).join('<br/>');
  var statusText = humanOsmStatus(mod.status);
  var color = getOsmStatusColor(mod.status);

  var adminControls = isAdmin ? (
    '<div class="osm-mod-controls" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+
      '<span>Статус: <b class="osm-mod-status">'+statusText+'</b></span>'+
      '<button type="button" class="osm-mod-verify">✅ Подтвердить</button>'+
      '<button type="button" class="osm-mod-unverify">↩ Отменить подтверждение</button>'+
      '<button type="button" class="osm-mod-flag">⚠️ Пометить</button>'+
      '<button type="button" class="osm-mod-hide">'+(mod.status === 'hidden' ? 'Показать' : 'Скрыть')+'</button>'+
    '</div>'
  ) : '';

  var reportControls =
    '<div class="osm-report-controls" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+
      '<button type="button" class="osm-report-flag">⚑ Пометить (спорно)</button>'+
      '<button type="button" class="osm-report-note">✎ Заметка</button>'+
    '</div>';

  var editBox =
    '<details style="margin-top:6px">'+
      '<summary>'+(isAdmin ? 'Изменить данные (модерация)' : 'Предложить правки')+'</summary>'+
      '<div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">'+
        '<input type="text" class="osm-edit-name" placeholder="Название" />'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
          '<label>Доступ: '+
            '<select class="osm-edit-access">'+
              '<option value="">—</option>'+
              '<option value="open">Открыто</option>'+
              '<option value="partial">Частично</option>'+
              '<option value="closed">Закрыто</option>'+
            '</select>'+
          '</label>'+
          '<label>Охрана: '+
            '<select class="osm-edit-security">'+
              '<option value="">—</option>'+
              '<option value="none">Нет</option>'+
              '<option value="low">Низкая</option>'+
              '<option value="medium">Средняя</option>'+
              '<option value="high">Высокая</option>'+
            '</select>'+
          '</label>'+
        '</div>'+
        '<input type="text" class="osm-edit-loot" placeholder="Лут (через запятую)" />'+
        '<button type="button" class="osm-edit-save">'+(isAdmin ? 'Сохранить (модератор)' : 'Отправить на модерацию')+'</button>'+
      '</div>'+
    '</details>';

  var overridesMeta = (ov.name || ov.access || ov.security || (ov.loot && ov.loot.length))
    ? '<div class="muted" style="margin-top:4px">Применены правки модерации</div>' : '';

  var html = ''+
    '<b class="osm-title">'+displayName+'</b><br/>'+
    '<small>из OSM/Overpass • <span class="osm-mod-status">'+statusText+'</span></small><br/>'+
    '<div style="max-width:240px">'+tagsHtml+'</div>'+
    overridesMeta+
    '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+
      '<button type="button" class="osm-route">Маршрут</button>'+
      '<button type="button" class="osm-fav" data-id="'+d.osmId+'">'+favTxt+'</button>'+
    '</div>'+
    adminControls+
    reportControls+
    editBox;

  marker.setIcon(makeDivIcon(color));
  marker.bindPopup(html);
}

// Unified list (our + OSM)
function itemMatchesFilters(item) {
  var q = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase();
  var bySearch = !q || (item.searchText || '').indexOf(q) !== -1;
  var byAccess = !filterAccess || !filterAccess.value || (item.access && item.access === filterAccess.value);
  var bySec = !filterSecurity || !filterSecurity.value || (item.security && item.security === filterSecurity.value);
  var byFav = !onlyFavorites || !onlyFavorites.checked || ((item.kind === 'place' && favoritesSet.has(item.id)) || (item.kind === 'osm' && favoritesOsmSet.has(item.id)));
  return bySearch && byAccess && bySec && byFav;
}
function collectListItems() {
  var items = [];

  // Наши
  markersMap.forEach(function(m){
    var p = m._placeData; if (!p) return;
    var it = {
      kind: 'place', id: p.id, name: p.name || '',
      access: p.access || '', security: p.security || '',
      loot: Array.isArray(p.loot) ? p.loot : [],
      status: p.status, lat: p.lat, lng: p.lng,
      createdAt: (p.createdAt && p.createdAt.seconds) || 0,
      searchText: ((p.name||'')+' '+(p.description||'')).toLowerCase()
    };
    if (itemMatchesFilters(it)) items.push(it);
  });

  // Verified OSM — всегда; hidden показываем только админам
  osmVerifiedMarkersMap.forEach(function(m, osmId){
    var d = m._osmData;
    var mod = osmModerationMap.get(osmId) || {};
    if (mod.status === 'hidden' && !isAdmin) return;
    var ov = mod.overrides || {};
    var it = {
      kind: 'osm', id: osmId, name: ov.name || d.baseName || 'OSM: объект без имени',
      access: ov.access || '', security: ov.security || '',
      loot: Array.isArray(ov.loot) ? ov.loot : [],
      status: mod.status || 'verified', lat: d.lat, lng: d.lng,
      updatedAt: (mod.updatedAt && mod.updatedAt.seconds) || 0,
      searchText: (ov.name || d.baseName || '').toLowerCase()
    };
    if (itemMatchesFilters(it)) items.push(it);
  });

  // Dynamic OSM — если тумблер, no-duplicate, hidden только админам
  if (toggleOSM && toggleOSM.checked) {
    osmMarkersMap.forEach(function(m, osmId){
      if (osmVerifiedMarkersMap.has(osmId)) return;
      var d = m._osmData;
      var mod = osmModerationMap.get(osmId) || {};
      if (mod.status === 'hidden' && !isAdmin) return;
      var ov = mod.overrides || {};
      var it = {
        kind: 'osm', id: osmId, name: ov.name || d.baseName || 'OSM: объект без имени',
        access: ov.access || '', security: ov.security || '',
        loot: Array.isArray(ov.loot) ? ov.loot : [],
        status: mod.status || 'visible', lat: d.lat, lng: d.lng,
        updatedAt: (mod.updatedAt && mod.updatedAt.seconds) || 0,
        searchText: (ov.name || d.baseName || '').toLowerCase()
      };
      if (itemMatchesFilters(it)) items.push(it);
    });
  }

  items.sort(function(a,b){
    return ((b.createdAt||b.updatedAt||0) - (a.createdAt||a.updatedAt||0)) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ru');
  });
  return items;
}
function renderOsmListItem(item) {
  var el = document.createElement('div');
  el.className = 'place-item';
  el.dataset.id = item.id;

  var statusBadge = (item.status === 'verified') ? '<span class="badge approved">OSM • подтверждён</span>' :
                    (item.status === 'flagged')  ? '<span class="badge pending">OSM • помечен</span>' :
                    (item.status === 'hidden')   ? '<span class="badge rejected">OSM • скрыт</span>' :
                                                   '<span class="badge">OSM</span>';
  var lootText = (item.loot && item.loot.length) ? ' • лут: ' + item.loot.join(', ') : '';
  var meta = (item.access || '—') + ' • охрана: ' + (item.security || '—') + lootText;

  el.innerHTML = ''+
    '<h4>'+item.name+' '+statusBadge+'</h4>'+
    '<div class="place-meta">'+meta+'</div>'+
    '<div class="place-actions">'+
      '<button type="button" data-action="show">Показать на карте</button>'+
      '<button type="button" data-action="route">Маршрут</button>'+
      '<button type="button" data-action="favorite">'+(favoritesOsmSet.has(item.id)?'★ В избранном':'☆ В избранное')+'</button>'+
      '<button type="button" data-action="flag">Пометить</button>'+
      '<button type="button" data-action="note">Заметка</button>'+
    '</div>';

  if (item.status === 'hidden' && isAdmin) el.style.opacity = '0.6';

  var b;
  b = el.querySelector('[data-action="show"]'); if (b) b.addEventListener('click', function(){ showOsmOnMap(item); });
  b = el.querySelector('[data-action="route"]'); if (b) b.addEventListener('click', function(){ startRoutingTo([item.lat, item.lng]); });
  b = el.querySelector('[data-action="favorite"]'); if (b) b.addEventListener('click', function(){ toggleFavoriteOSM(item.id, { name: item.name, lat: item.lat, lng: item.lng, type: 'node', tags: {} }); });
  b = el.querySelector('[data-action="flag"]'); if (b) b.addEventListener('click', async function(){
    if (!currentUser) { alert('Войдите, чтобы отправлять жалобы'); return; }
    var reason = prompt('Почему объект спорный? (необязательно)') || '';
    await submitOsmReport(item.id, 'flag', { reason: reason });
  });
  b = el.querySelector('[data-action="note"]'); if (b) b.addEventListener('click', async function(){
    if (!currentUser) { alert('Войдите, чтобы отправлять заметки'); return; }
    var note = prompt('Заметка (увидит модератор):', '') || '';
    if (note.trim()) await submitOsmReport(item.id, 'note', { note: note });
  });

  return el;
}
function showOsmOnMap(item) {
  var mv = osmVerifiedMarkersMap.get(item.id);
  if (mv) { map.setView([item.lat, item.lng], 16); mv.openPopup(); return; }
  var mdyn = osmMarkersMap.get(item.id);
  if (mdyn) {
    if (toggleOSM && !toggleOSM.checked) { toggleOSM.checked = true; toggleOSM.dispatchEvent(new Event('change')); }
    map.setView([item.lat, item.lng], 16); mdyn.openPopup(); return;
  }
  map.setView([item.lat, item.lng], 16);
  var temp = L.marker([item.lat, item.lng], { icon: makeDivIcon('#4ea0ff') })
    .bindPopup('<b>'+item.name+'</b><br/><small>OSM объект</small>')
    .addTo(osmVerifiedLayer)
    .openPopup();
  setTimeout(function(){ try { osmVerifiedLayer.removeLayer(temp); } catch(_){ } }, 8000);
}
function renderUnifiedList() {
  if (!placesList) return;
  placesList.innerHTML = '';
  var items = collectListItems();
  var frag = document.createDocumentFragment();
  items.forEach(function(item){
    if (item.kind === 'place') {
      var m = markersMap.get(item.id); var p = m && m._placeData;
      if (p) frag.appendChild(renderPlaceItem(p));
    } else {
      frag.appendChild(renderOsmListItem(item));
    }
  });
  placesList.appendChild(frag);
}

// Apply filters to OSM
function applyFiltersOSM() {
  var q = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase();

  // verified — всегда; hidden видит только админ
  osmVerifiedMarkersMap.forEach(function(marker, osmId){
    var d = marker._osmData;
    var mod = osmModerationMap.get(osmId) || {};
    var ov = mod.overrides || {};
    var name = ov.name || d.baseName || '';
    var matchesSearch = !q || name.toLowerCase().indexOf(q) !== -1;
    var matchesFav = !onlyFavorites || !onlyFavorites.checked || favoritesOsmSet.has(osmId);
    var visibleByStatus = isAdmin || mod.status !== 'hidden';
    var visible = matchesSearch && matchesFav && visibleByStatus;

    marker.setIcon(makeDivIcon(getOsmStatusColor(mod.status)));
    if (visible) { if (!osmVerifiedLayer.hasLayer(marker)) marker.addTo(osmVerifiedLayer); var el = marker.getElement(); if (el) el.classList.remove('hidden'); }
    else { osmVerifiedLayer.removeLayer(marker); }

    var el2 = marker.getPopup() ? marker.getPopup().getElement() : null;
    if (el2) {
      var st = el2.querySelector('.osm-mod-status'); if (st) st.textContent = humanOsmStatus(mod.status);
      var title = el2.querySelector('.osm-title'); if (title) title.textContent = name || 'OSM: объект без имени';
      var hideBtn = el2.querySelector('.osm-mod-hide'); if (hideBtn) hideBtn.textContent = (mod.status === 'hidden') ? 'Показать' : 'Скрыть';
    }
  });

  // dynamic — по тумблеру; hidden only admin
  osmMarkersMap.forEach(function(marker, osmId){
    var d = marker._osmData;
    var mod = osmModerationMap.get(osmId) || {};
    var ov = mod.overrides || {};
    var name = ov.name || d.baseName || '';
    var matchesSearch = !q || name.toLowerCase().indexOf(q) !== -1;
    var matchesFav = !onlyFavorites || !onlyFavorites.checked || favoritesOsmSet.has(osmId);
    var visibleByStatus = isAdmin || mod.status !== 'hidden';
    var visible = matchesSearch && matchesFav && visibleByStatus;

    marker.setIcon(makeDivIcon(getOsmStatusColor(mod.status)));
    if (osmVerifiedMarkersMap.has(osmId)) { marker.remove(); return; }

    if (visible && toggleOSM && toggleOSM.checked) { if (!osmLayer.hasLayer(marker)) marker.addTo(osmLayer); var el = marker.getElement(); if (el) el.classList.remove('hidden'); }
    else { osmLayer.removeLayer(marker); }

    var el3 = marker.getPopup() ? marker.getPopup().getElement() : null;
    if (el3) {
      var st2 = el3.querySelector('.osm-mod-status'); if (st2) st2.textContent = humanOsmStatus(mod.status);
      var title2 = el3.querySelector('.osm-title'); if (title2) title2.textContent = name || 'OSM: объект без имени';
      var hideBtn2 = el3.querySelector('.osm-mod-hide'); if (hideBtn2) hideBtn2.textContent = (mod.status === 'hidden') ? 'Показать' : 'Скрыть';
    }
  });

  refreshOpenOSMPopupsFavoritesUI();
  renderUnifiedList();
}

// Overpass (by view)
var osmFetchTimer = null;
function throttleFetchOSM() {
  if (osmFetchTimer) clearTimeout(osmFetchTimer);
  osmFetchTimer = setTimeout(fetchOSMByView, 600);
}
async function fetchOSMByView() {
  var b = map.getBounds();
  var s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
  var bbox = s+','+w+','+n+','+e;
  var queryStr =
    '[out:json][timeout:25];('+
      'node["abandoned"="yes"]('+bbox+');'+
      'way["abandoned"="yes"]('+bbox+');'+
      'node["disused"="yes"]('+bbox+');'+
      'way["disused"="yes"]('+bbox+');'+
      'node["building"="ruins"]('+bbox+');'+
      'way["building"="ruins"]('+bbox+');'+
      'node["historic"="ruins"]('+bbox+');'+
      'way["historic"="ruins"]('+bbox+');'+
    ');out center 100;';
  try {
    var res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ data: queryStr })
    });
    var data = await res.json();

    osmLayer.clearLayers();
    osmMarkersMap.clear();

    (data.elements || []).forEach(function(el){
      var type = el.type;
      var id = el.id;
      var osmId = type+'-'+id;
      var lat = (typeof el.lat === 'number') ? el.lat : (el.center ? el.center.lat : undefined);
      var lng = (typeof el.lon === 'number') ? el.lon : (el.center ? el.center.lon : undefined);
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      var baseName = (el.tags && (el.tags.name || el.tags['name:ru'])) || 'OSM: объект без имени';
      var tags = el.tags || {};
      var mod = osmModerationMap.get(osmId);
      if (mod && mod.status === 'hidden' && !isAdmin) return;

      if (osmVerifiedMarkersMap.has(osmId)) {
        var mv = osmVerifiedMarkersMap.get(osmId);
        mv._osmData = { osmId: osmId, baseName: baseName, lat: lat, lng: lng, type: type, tags: tags };
        renderOsmPopup(mv);
        return;
      }

      var marker = L.marker([lat, lng], { icon: makeDivIcon(getOsmStatusColor(mod && mod.status)) }).addTo(osmLayer);
      marker._osmData = { osmId: osmId, baseName: baseName, lat: lat, lng: lng, type: type, tags: tags };
      osmMarkersMap.set(osmId, marker);
      renderOsmPopup(marker);
    });

    applyFiltersOSM();
  } catch (e) {
    console.warn('Overpass error', e);
  }
}
