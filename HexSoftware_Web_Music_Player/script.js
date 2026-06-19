console.log("Aura Player v2.1");

// ── IndexedDB ──────────────────────────────────────────────────────────────
const DB_NAME = "auraPlayerDB", DB_VER = 1, STORE = "userTracks";
let _db = null;

function openDB() {
    return new Promise((res, rej) => {
        if (_db) return res(_db);
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE))
                db.createObjectStore(STORE, { keyPath: "id" });
        };
        r.onsuccess = e => { _db = e.target.result; res(_db); };
        r.onerror   = e => rej(e.target.error);
    });
}
const dbSave   = async t => { const db = await openDB(); return new Promise((r,j) => { const tx = db.transaction(STORE,"readwrite"); tx.objectStore(STORE).put(t); tx.oncomplete=r; tx.onerror=e=>j(e.target.error); }); };
const dbDelete = async id=> { const db = await openDB(); return new Promise((r,j) => { const tx = db.transaction(STORE,"readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete=r; tx.onerror=e=>j(e.target.error); }); };
const dbAll    = async () => { const db = await openDB(); return new Promise((r,j) => { const tx=db.transaction(STORE,"readonly"); const q=tx.objectStore(STORE).getAll(); q.onsuccess=()=>r(q.result||[]); q.onerror=e=>j(e.target.error); }); };

// ── State ──────────────────────────────────────────────────────────────────
let flatList   = [];   // unified playback list
let naatIndex  = -1;
let audio      = new Audio();
let isSeeking  = false;
let srcLoaded  = false;
let isShuffle  = false;
let repeatMode = "off";  // off | all | one
let playOrder  = [];
let objectUrls = new Map();   // id → objectURL
let isMuted    = false;
let lastVol    = 1;
let pendingDeleteId = null;   // track id waiting for confirm

// Songs data
const builtinSongs = [
    { id:"b0", naatName:"Ya Nabi Salam Alayka",  artist:"Maher Zain",       filePath:"files/naat.mp3",                coverPath:"files/cover1.jpg",   duration:"05:20", isBuiltin:true },
    { id:"b1", naatName:"Tabalagh Bil Qaleel",   artist:"Osman Al Safi",    filePath:"files/Tabalagh Bil Qaleel.mp3", coverPath:"files/tabalagh.jpg", duration:"04:13", isBuiltin:true },
    { id:"b2", naatName:"Kun Anta",              artist:"Humood Alkhudher", filePath:"files/Kon_Anta.mp3",            coverPath:"files/kun anta.jpg", duration:"04:00", isBuiltin:true },
    { id:"b3", naatName:"Rahman Ya Rahman",      artist:"Mishary Alafasy",  filePath:"files/Rahman.mp3",              coverPath:"files/rahman.jpg",   duration:"04:35", isBuiltin:true }
];
let userSongs = [];

function buildFlat() {
    flatList = [...builtinSongs, ...userSongs];
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const masterPlay      = $('masterPlay');
const playBtnWrapper  = document.querySelector('.play-btn-wrapper');
const myProgressBar   = $('myProgressBar');
const gif             = $('gif');
const prevBtn         = $('prevBtn');
const nextBtn         = $('nextBtn');
const shuffleBtn      = $('shuffleBtn');
const repeatBtn       = $('repeatBtn');
const volumeBar       = $('volumeBar');
const volumeIcon      = $('volumeIcon');
const volLabel        = $('volLabel');
const naatTitleEl     = document.querySelector('.naatTitle');
const naatArtistEl    = document.querySelector('.naatArtist');
const currentTimeDisp = $('currentTimeDisplay');
const totalTimeDisp   = $('totalTimeDisplay');
const toastStack      = $('toastStack');
const dropOverlay     = $('dropOverlay');
const fileInput       = $('fileInput');
const deleteModal     = $('deleteModal');
const deleteModalName = $('deleteModalTrackName');
const deleteCancelBtn = $('deleteCancelBtn');
const deleteConfirmBtn= $('deleteConfirmBtn');
const aboutOverlay    = $('aboutOverlay');

// tab pages
const tabHome    = $('tabHome');
const tabLibrary = $('tabLibrary');

// home tab elements
const builtinContainer    = $('builtinContainer');
const userPreviewContainer= $('userPreviewContainer');
const homeEmptyState      = $('homeEmptyState');
const builtinCount        = $('builtinCount');
const homeUserCount       = $('homeUserCount');
const searchInput         = $('searchInput');
const builtinArrow        = $('builtinArrow');
const userPreviewArrow    = $('userPreviewArrow');

// library tab elements
const libTrackList       = $('libTrackList');
const libEmptyState      = $('libEmptyState');
const libTrackCountLabel = $('libTrackCountLabel');
const libSearchInput     = $('libSearchInput');
const uploadZone         = $('uploadZone');

// collapse state
let builtinCollapsed     = false;
let userPreviewCollapsed = false;

// ── Tab routing ────────────────────────────────────────────────────────────
const navLinks = document.querySelectorAll('.nav-links li');
let currentTab = 'home';

function switchTab(tab) {
    currentTab = tab;
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.tab === tab));

    tabHome.classList.toggle('active',    tab === 'home');
    tabLibrary.classList.toggle('active', tab === 'library');
    tabAboutTrigger(tab);
}

function tabAboutTrigger(tab) {
    if (tab === 'about') {
        $('aboutOverlay').classList.add('open');
        // revert nav highlight to previous real tab
        navLinks.forEach(l => l.classList.toggle('active', l.dataset.tab === currentTab && l.dataset.tab !== 'about'));
    }
}

navLinks.forEach(l => {
    l.addEventListener('click', () => {
        const t = l.dataset.tab;
        if (t === 'about') {
            aboutOverlay.classList.add('open');
        } else {
            switchTab(t);
        }
    });
});

$('goToLibraryBtn').addEventListener('click', e => { e.stopPropagation(); switchTab('library'); });
$('closeAbout').addEventListener('click', () => aboutOverlay.classList.remove('open'));
aboutOverlay.addEventListener('click', e => { if (e.target === aboutOverlay) aboutOverlay.classList.remove('open'); });

// ── Toasts ─────────────────────────────────────────────────────────────────
function toast(msg, type = "info") {
    const icons = { info:"fa-check-circle", error:"fa-circle-exclamation", purple:"fa-folder-open" };
    const el = document.createElement('div');
    el.className = `toast${type !== 'info' ? ' '+type : ''}`;
    el.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i><span>${msg}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ── Slider fill ────────────────────────────────────────────────────────────
function fillSlider(el, color = "#00e5ff") {
    if (!el) return;
    const pct = ((el.value - (el.min||0)) / ((el.max||100) - (el.min||0))) * 100;
    el.style.background = `linear-gradient(to right,${color} 0%,${color} ${pct}%,rgba(255,255,255,0.1) ${pct}%,rgba(255,255,255,0.1) 100%)`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(s) {
    if (!isFinite(s)||s<0) return "00:00";
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}
function esc(str) { const d=document.createElement('div'); d.textContent=str??''; return d.innerHTML; }

function setPlayIcon(playing) {
    masterPlay.className = playing ? "fa-solid fa-circle-pause" : "fa-solid fa-circle-play";
    playBtnWrapper.classList.toggle('playing', playing);
}

function highlightRows() {
    document.querySelectorAll('[data-flat-idx]').forEach(el => {
        const idx = parseInt(el.dataset.flatIdx);
        const active = idx === naatIndex;
        el.classList.toggle('active', active);
        el.classList.toggle('paused', active && audio.paused);
        // small play icons in home list
        const icon = el.querySelector('.playIcon');
        if (icon) icon.className = (active && !audio.paused) ? 'fa-solid fa-circle-pause playIcon' : 'fa-solid fa-circle-play playIcon';
        // lib play btn icon
        const libIcon = el.querySelector('.lib-play-btn i');
        if (libIcon) libIcon.className = (active && !audio.paused) ? 'fa-solid fa-circle-pause' : 'fa-solid fa-circle-play';
    });
}

function updateNowPlaying() {
    if (naatIndex < 0 || naatIndex >= flatList.length) return;
    const s = flatList[naatIndex];
    naatTitleEl.textContent  = s.naatName;
    naatArtistEl.textContent = s.artist;
}

// ── Collapse (home) ────────────────────────────────────────────────────────
$('toggleBuiltin').addEventListener('click', () => {
    builtinCollapsed = !builtinCollapsed;
    builtinContainer.classList.toggle('collapsed', builtinCollapsed);
    builtinArrow.style.transform = builtinCollapsed ? 'rotate(-90deg)' : '';
});

$('userPreviewSection').querySelector('.section-header').addEventListener('click', e => {
    if (e.target.closest('.pill-btn')) return;
    userPreviewCollapsed = !userPreviewCollapsed;
    userPreviewContainer.classList.toggle('collapsed', userPreviewCollapsed);
    userPreviewArrow.style.transform = userPreviewCollapsed ? 'rotate(-90deg)' : '';
});

// ── Render HOME built-in list ───────────────────────────────────────────────
function renderBuiltin(filter) {
    builtinContainer.innerHTML = '';
    let shown = 0;
    builtinSongs.forEach((song, i) => {
        if (filter && !song.naatName.toLowerCase().includes(filter) && !song.artist.toLowerCase().includes(filter)) return;
        const flatIdx = i;   // builtin comes first in flatList
        const div = document.createElement('div');
        div.className = 'naatItem cyan-row';
        div.dataset.flatIdx = flatIdx;
        div.innerHTML = `
            <span class="track-num">${i+1}</span>
            <div class="playing-bars"><span></span><span></span><span></span><span></span></div>
            <div class="songInfo">
                <img src="${esc(song.coverPath)}" onerror="this.src='https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=60'">
                <div class="song-text">
                    <span class="songTitle">${esc(song.naatName)}</span>
                    <span class="songArtist">${esc(song.artist)}</span>
                </div>
            </div>
            <div class="naatlistplay">
                <span class="timestamp">${song.duration||'--:--'}</span>
                <i class="fa-solid fa-circle-play playIcon"></i>
            </div>`;
        div.addEventListener('click', () => { if (parseInt(div.dataset.flatIdx)===naatIndex && srcLoaded) togglePlay(); else playSong(flatIdx); });
        builtinContainer.appendChild(div);
        shown++;
    });
    if (shown===0) { const nr=document.createElement('div'); nr.className='no-results'; nr.textContent='No matches'; builtinContainer.appendChild(nr); }
    builtinCount.textContent = builtinSongs.length;
}

// ── Render HOME user preview (no delete button) ─────────────────────────────
function renderHomeUserPreview(filter) {
    userPreviewContainer.innerHTML = '';
    if (userSongs.length === 0 && !filter) {
        userPreviewContainer.appendChild(homeEmptyState);
        homeUserCount.textContent = 0;
        return;
    }
    let shown = 0;
    userSongs.forEach((song, i) => {
        if (filter && !song.naatName.toLowerCase().includes(filter) && !song.artist.toLowerCase().includes(filter)) return;
        const flatIdx = builtinSongs.length + i;
        const div = document.createElement('div');
        div.className = 'naatItem purple-row';
        div.dataset.flatIdx = flatIdx;
        div.innerHTML = `
            <span class="track-num">${i+1}</span>
            <div class="playing-bars"><span></span><span></span><span></span><span></span></div>
            <div class="songInfo">
                <img src="${esc(song.coverPath)}" onerror="this.src='https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=60'">
                <div class="song-text">
                    <span class="songTitle">${esc(song.naatName)}</span>
                    <span class="songArtist">${esc(song.artist)}</span>
                </div>
            </div>
            <div class="naatlistplay">
                <span class="timestamp">${song.duration||'--:--'}</span>
                <i class="fa-solid fa-circle-play playIcon"></i>
            </div>`;
        div.addEventListener('click', () => { if (parseInt(div.dataset.flatIdx)===naatIndex && srcLoaded) togglePlay(); else playSong(flatIdx); });
        userPreviewContainer.appendChild(div);
        shown++;
    });
    if (shown===0 && filter) { const nr=document.createElement('div'); nr.className='no-results'; nr.textContent='No matches in your library'; userPreviewContainer.appendChild(nr); }
    homeUserCount.textContent = userSongs.length;
}

// ── Render LIBRARY TAB ──────────────────────────────────────────────────────
function renderLibrary(filter) {
    // remove all track rows (keep empty state element)
    libTrackList.querySelectorAll('.lib-track').forEach(el => el.remove());
    libTrackList.querySelectorAll('.no-results').forEach(el => el.remove());

    if (userSongs.length === 0) {
        libEmptyState.style.display = 'flex';
        libTrackCountLabel.textContent = '0 tracks';
        return;
    }
    libEmptyState.style.display = 'none';
    libTrackCountLabel.textContent = `${userSongs.length} track${userSongs.length!==1?'s':''}`;

    let shown = 0;
    userSongs.forEach((song, i) => {
        if (filter && !song.naatName.toLowerCase().includes(filter) && !song.artist.toLowerCase().includes(filter)) return;
        const flatIdx = builtinSongs.length + i;
        const div = document.createElement('div');
        div.className = 'lib-track';
        div.dataset.flatIdx = flatIdx;
        div.innerHTML = `
            <span class="track-num">${i+1}</span>
            <div class="playing-bars"><span></span><span></span><span></span><span></span></div>
            <img class="lib-cover" src="${esc(song.coverPath)}" onerror="this.src='https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=60'">
            <div class="lib-info">
                <div class="lib-name">${esc(song.naatName)}</div>
                <div class="lib-meta">${esc(song.artist)} · ${song.duration||'--:--'}</div>
            </div>
            <div class="lib-actions">
                <button class="lib-play-btn" title="Play">
                    <i class="fa-solid fa-circle-play"></i>
                </button>
                <button class="lib-delete-btn" title="Remove track">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>`;

        // play on row click
        div.addEventListener('click', e => {
            if (e.target.closest('.lib-delete-btn')) return;
            if (parseInt(div.dataset.flatIdx)===naatIndex && srcLoaded) togglePlay();
            else playSong(flatIdx);
        });

        // delete btn → confirm modal
        div.querySelector('.lib-delete-btn').addEventListener('click', e => {
            e.stopPropagation();
            openDeleteModal(song.id, song.naatName);
        });

        libTrackList.appendChild(div);
        shown++;
    });

    if (shown === 0 && filter) {
        const nr = document.createElement('div');
        nr.className = 'no-results';
        nr.textContent = 'No tracks match your search';
        libTrackList.appendChild(nr);
    }
}

// ── Master render ───────────────────────────────────────────────────────────
function renderAll(filter) {
    buildFlat();
    const q = filter ? filter.toLowerCase() : null;
    renderBuiltin(q);
    renderHomeUserPreview(q);
    renderLibrary(q);
    highlightRows();
    rebuildPlayOrder();
}

// ── Confirm delete modal ────────────────────────────────────────────────────
function openDeleteModal(id, name) {
    pendingDeleteId = id;
    deleteModalName.textContent = `"${name}" will be removed from your library.`;
    deleteModal.classList.add('open');
}

deleteCancelBtn.addEventListener('click',  () => { deleteModal.classList.remove('open'); pendingDeleteId = null; });
deleteModal.addEventListener('click', e => { if (e.target === deleteModal) { deleteModal.classList.remove('open'); pendingDeleteId = null; } });

deleteConfirmBtn.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    deleteModal.classList.remove('open');
    await removeTrack(pendingDeleteId);
    pendingDeleteId = null;
});

// ── Remove track ────────────────────────────────────────────────────────────
async function removeTrack(id) {
    const idx = userSongs.findIndex(s => s.id === id);
    if (idx === -1) return;
    const song = userSongs[idx];
    const flatIdx = builtinSongs.length + idx;
    const wasCurrent = flatIdx === naatIndex;
    const wasPlaying = wasCurrent && !audio.paused;

    try { await dbDelete(id); } catch(e){ console.error(e); }

    const url = objectUrls.get(id);
    if (url) {
        if (wasCurrent) { audio.pause(); audio.removeAttribute('src'); srcLoaded = false; }
        URL.revokeObjectURL(url);
        objectUrls.delete(id);
    }

    userSongs.splice(idx, 1);
    buildFlat();

    if (flatList.length === 0) {
        naatIndex = -1; srcLoaded = false;
        setPlayIcon(false); gif.style.display='none';
        naatTitleEl.textContent='Select a track to play';
        naatArtistEl.textContent='';
        currentTimeDisp.textContent='00:00'; totalTimeDisp.textContent='00:00';
        myProgressBar.value=0; fillSlider(myProgressBar);
    } else if (wasCurrent) {
        naatIndex = Math.min(flatIdx, flatList.length-1);
        if (wasPlaying) playSong(naatIndex);
        else { srcLoaded=false; naatTitleEl.textContent='Select a track to play'; naatArtistEl.textContent=''; }
    } else if (flatIdx < naatIndex) {
        naatIndex--;
    }

    renderAll();
    toast(`Removed "${song.naatName}"`);
}

// ── File handling ───────────────────────────────────────────────────────────
const AUDIO_RE = /^audio\/|\.(?:mp3|wav|ogg|m4a|flac|aac)$/i;

function readDur(file) {
    return new Promise(r => {
        const url=URL.createObjectURL(file), a=new Audio();
        a.preload='metadata'; a.src=url;
        a.onloadedmetadata=()=>{ r(isFinite(a.duration)?a.duration:null); URL.revokeObjectURL(url); };
        a.onerror=()=>{ r(null); URL.revokeObjectURL(url); };
    });
}
function guessName(fn) { return fn.replace(/\.[^/.]+$/,'').replace(/[_-]+/g,' ').trim()||"Untitled Track"; }

async function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f=>AUDIO_RE.test(f.type)||AUDIO_RE.test(f.name));
    if (!files.length) { toast("No valid audio files found","error"); return; }

    let added = 0;
    for (const file of files) {
        try {
            const dur = await readDur(file);
            const id  = `u_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
            const rec = { id, naatName:guessName(file.name), artist:"Your Library", blob:file, duration:dur?fmt(dur):null, createdAt:Date.now() };
            await dbSave(rec);
            const url = URL.createObjectURL(file);
            objectUrls.set(id, url);
            userSongs.push({ id, naatName:rec.naatName, artist:rec.artist, filePath:url, coverPath:"https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100", duration:rec.duration });
            added++;
        } catch(e){ console.error(e); toast(`Couldn't add "${file.name}"`,"error"); }
    }
    if (added>0) {
        renderAll();
        toast(added===1 ? "Added 1 track to My Library" : `Added ${added} tracks to My Library`, "purple");
        // switch to library tab so user sees the result
        switchTab('library');
    }
}

async function loadPersisted() {
    try {
        const recs = await dbAll();
        recs.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
        recs.forEach(r => {
            const url=URL.createObjectURL(r.blob);
            objectUrls.set(r.id, url);
            userSongs.push({ id:r.id, naatName:r.naatName, artist:r.artist||"Your Library", filePath:url, coverPath:"https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100", duration:r.duration });
        });
    } catch(e){ console.error(e); }
    renderAll();
}

// ── Playback ────────────────────────────────────────────────────────────────
function rebuildPlayOrder() {
    playOrder = flatList.map((_,i)=>i);
    for (let i=playOrder.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [playOrder[i],playOrder[j]]=[playOrder[j],playOrder[i]]; }
}
function getNext() { if(!flatList.length)return-1; if(!isShuffle)return(naatIndex+1)%flatList.length; const p=playOrder.indexOf(naatIndex); return playOrder[(p+1)%playOrder.length]; }
function getPrev() { if(!flatList.length)return-1; if(!isShuffle)return(naatIndex-1+flatList.length)%flatList.length; const p=playOrder.indexOf(naatIndex); return playOrder[(p-1+playOrder.length)%playOrder.length]; }

function playSong(idx) {
    if (idx<0||idx>=flatList.length) return;
    naatIndex = idx;
    audio.src = flatList[idx].filePath;
    audio.currentTime = 0;
    srcLoaded = true;
    audio.play()
        .then(()=>{ setPlayIcon(true); gif.style.display='block'; updateNowPlaying(); highlightRows(); })
        .catch(e=>{ console.error(e); setPlayIcon(false); gif.style.display='none'; toast(`Couldn't play "${flatList[idx].naatName}"`,"error"); });
}

function togglePlay() {
    if (!srcLoaded) { if(flatList.length) playSong(0); return; }
    if (audio.paused) {
        audio.play().then(()=>{ setPlayIcon(true); gif.style.display='block'; highlightRows(); }).catch(console.error);
    } else {
        audio.pause(); setPlayIcon(false); gif.style.display='none'; highlightRows();
    }
}

function playNext() { const n=getNext(); if(n!==-1)playSong(n); }
function playPrev() {
    if (audio.currentTime>3&&srcLoaded){ audio.currentTime=0; return; }
    const n=getPrev(); if(n!==-1)playSong(n);
}

audio.addEventListener('ended', ()=>{
    if (repeatMode==="one"){ audio.currentTime=0; audio.play(); return; }
    const next=getNext();
    if (repeatMode==="off"&&!isShuffle&&naatIndex===flatList.length-1){
        audio.pause(); audio.currentTime=0; setPlayIcon(false); gif.style.display='none'; highlightRows(); return;
    }
    if(next!==-1) playSong(next);
});

// ── Progress ────────────────────────────────────────────────────────────────
audio.addEventListener('loadedmetadata', ()=>{ if(isFinite(audio.duration)) totalTimeDisp.textContent=fmt(audio.duration); });
audio.addEventListener('timeupdate', ()=>{
    if(isSeeking||!isFinite(audio.duration)) return;
    const pct=(audio.currentTime/audio.duration)*100;
    myProgressBar.value=pct; currentTimeDisp.textContent=fmt(audio.currentTime); fillSlider(myProgressBar);
});
myProgressBar.addEventListener('mousedown',()=>isSeeking=true);
myProgressBar.addEventListener('mouseup',  ()=>isSeeking=false);
myProgressBar.addEventListener('input',()=>{
    if(!isFinite(audio.duration))return;
    const t=(myProgressBar.value/100)*audio.duration;
    audio.currentTime=t; currentTimeDisp.textContent=fmt(t); fillSlider(myProgressBar);
});

// ── Volume ──────────────────────────────────────────────────────────────────
function setVol(v) {
    v=Math.max(0,Math.min(1,v)); audio.volume=v; volumeBar.value=v*100; fillSlider(volumeBar);
    if(volLabel) volLabel.textContent=Math.round(v*100)+'%';
    volumeIcon.className=v===0?'fa-solid fa-volume-xmark':v<0.5?'fa-solid fa-volume-low':'fa-solid fa-volume-high';
}
volumeBar.addEventListener('input',()=>setVol(volumeBar.value/100));
volumeIcon.addEventListener('click',()=>{ if(isMuted){isMuted=false;setVol(lastVol||0.5);}else{lastVol=audio.volume;isMuted=true;setVol(0);} });

// ── Shuffle / Repeat ─────────────────────────────────────────────────────────
shuffleBtn.addEventListener('click',()=>{ isShuffle=!isShuffle; shuffleBtn.classList.toggle('active',isShuffle); if(isShuffle)rebuildPlayOrder(); toast(isShuffle?'Shuffle on':'Shuffle off'); });
repeatBtn.addEventListener('click',()=>{
    if(repeatMode==="off"){ repeatMode="all"; repeatBtn.classList.add('active'); repeatBtn.classList.remove('repeat-one'); toast("Repeat all"); }
    else if(repeatMode==="all"){ repeatMode="one"; repeatBtn.classList.add('active','repeat-one'); toast("Repeat one"); }
    else { repeatMode="off"; repeatBtn.classList.remove('active','repeat-one'); toast("Repeat off"); }
});

// ── Player buttons ───────────────────────────────────────────────────────────
masterPlay.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', playNext);

// ── Search ───────────────────────────────────────────────────────────────────
let sTimer;
searchInput.addEventListener('input', ()=>{ clearTimeout(sTimer); sTimer=setTimeout(()=>renderAll(searchInput.value.trim()||null),200); });
let lTimer;
libSearchInput.addEventListener('input', ()=>{ clearTimeout(lTimer); lTimer=setTimeout(()=>renderLibrary(libSearchInput.value.trim().toLowerCase()||null),200); });

// ── File input / drag-drop ────────────────────────────────────────────────────
$('addMusicBtn').addEventListener('click',  ()=>fileInput.click());
$('addMusicBtn2').addEventListener('click', ()=>fileInput.click());
fileInput.addEventListener('change', e=>{ if(e.target.files?.length) handleFiles(e.target.files); fileInput.value=''; });

// upload zone on library tab
uploadZone.addEventListener('click',()=>fileInput.click());
uploadZone.addEventListener('dragover', e=>{ e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave',()=>uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e=>{ e.preventDefault(); uploadZone.classList.remove('drag-over'); if(e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

// global drag overlay
let dc=0;
window.addEventListener('dragenter',e=>{ e.preventDefault(); if(e.dataTransfer?.types.includes('Files')){ dc++; dropOverlay.classList.add('active'); } });
window.addEventListener('dragover', e=>e.preventDefault());
window.addEventListener('dragleave',e=>{ e.preventDefault(); if(--dc<=0){ dc=0; dropOverlay.classList.remove('active'); } });
window.addEventListener('drop',     e=>{ e.preventDefault(); dc=0; dropOverlay.classList.remove('active'); if(e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

// ── Keyboard ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e=>{
    const tag=document.activeElement.tagName;
    const inInput=tag==='INPUT'||tag==='TEXTAREA';
    if(e.ctrlKey&&e.key==='f'){ e.preventDefault(); (currentTab==='library'?libSearchInput:searchInput).focus(); return; }
    if(e.key==='Escape'){ aboutOverlay.classList.remove('open'); deleteModal.classList.remove('open'); return; }
    if(inInput) return;
    switch(e.code){
        case'Space':      e.preventDefault(); togglePlay(); break;
        case'ArrowLeft':  e.preventDefault(); playPrev();   break;
        case'ArrowRight': e.preventDefault(); playNext();   break;
        case'ArrowUp':    e.preventDefault(); setVol(audio.volume+0.1); break;
        case'ArrowDown':  e.preventDefault(); setVol(audio.volume-0.1); break;
        case'KeyS': shuffleBtn.click(); break;
        case'KeyR': repeatBtn.click();  break;
        case'KeyM': volumeIcon.click(); break;
    }
});

// ── Init ──────────────────────────────────────────────────────────────────────
setVol(1);
fillSlider(myProgressBar);
loadPersisted();
