import { firebaseConfig, FALLBACK_ADMIN_UIDS } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, query, where, onSnapshot, updateDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('userInfo');
const userName = document.getElementById('userName');
const userUid = document.getElementById('userUid');
const userAvatar = document.getElementById('userAvatar');

const adminOnly = document.getElementById('adminOnly');
const pendingList = document.getElementById('pendingList');

let currentUser = null;
let isAdmin = false;
let unsubPending = null;

loginBtn.addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider).catch(err => alert(err.message));
});
logoutBtn.addEventListener('click', () => signOut(auth));

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
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    userInfo.classList.remove('hidden');
    userName.textContent = currentUser.displayName || 'Без имени';
    userUid.textContent = currentUser.uid;
    userAvatar.src = currentUser.photoURL || 'https://placehold.co/32x32';
    isAdmin = await loadAdminStatus(currentUser.uid);
    adminOnly.classList.toggle('hidden', isAdmin);
    subscribePending();
  } else {
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    userInfo.classList.add('hidden');
    isAdmin = false;
    adminOnly.classList.add('hidden');
    if (unsubPending) unsubPending();
    pendingList.innerHTML = '';
  }
});

function subscribePending() {
  if (!isAdmin) return;
  if (unsubPending) unsubPending();
  const q = query(collection(db, 'places'), where('status', '==', 'pending'));
  unsubPending = onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(d => {
      const p = { id: d.id, ...d.data() };
      items.push(p);
    });
    renderPending(items);
  });
}

function renderPending(list) {
  pendingList.innerHTML = '';
  if (!list.length) {
    pendingList.innerHTML = '<div class="badge approved">Нет объектов на модерации</div>';
    return;
  }
  list.forEach(p => {
    const el = document.createElement('div');
    el.className = 'pending-card';
    const loot = (p.loot && p.loot.length) ? ` • лут: ${p.loot.join(', ')}` : '';
    const photos = (p.photos && p.photos.length) ? `<div class="gallery">${p.photos.map(u=>`<img src="${u}" />`).join('')}</div>` : '';
    el.innerHTML = `
      <h4>${p.name}</h4>
      <div>${p.description || ''}</div>
      <div class="place-meta">${p.access} • охрана: ${p.security}${loot}</div>
      <div>Координаты: ${p.lat}, ${p.lng}</div>
      ${photos}
      <div class="place-actions">
        <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}" target="_blank">OSM</a>
        <button data-action="approve">Одобрить</button>
        <button data-action="reject">Отклонить</button>
        <button data-action="delete" class="danger">Удалить</button>
      </div>
    `;
    el.querySelector('[data-action="approve"]').addEventListener('click', async ()=> {
      await updateDoc(doc(db, 'places', p.id), { status: 'approved', approvedAt: serverTimestamp(), approvedBy: currentUser.uid });
    });
    el.querySelector('[data-action="reject"]').addEventListener('click', async ()=> {
      const reason = prompt('Причина отклонения (необязательно):') || '';
      await updateDoc(doc(db, 'places', p.id), { status: 'rejected', rejectReason: reason });
    });
    el.querySelector('[data-action="delete"]').addEventListener('click', async ()=> {
      if (confirm('Удалить объект?')) {
        const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        await deleteDoc(doc(db, 'places', p.id));
      }
    });
    pendingList.appendChild(el);
  });
}
