"use strict";

/* =========================================================
   CONFIG
========================================================= */

const CONFIG = {
  libraryFile: "library.json",
  itemJsonName: "item.json",

  compactRadius: 5,
  compactEdgeThreshold: 11,

  readerMaxWidth: 900,
  readerMinWidth: 320,
  readerSidePadding: 16
};

/* =========================================================
   STATE
========================================================= */

const STATE = {
  works: [],
  sourceMap: {},

  currentWork: null,
  currentEntry: null,
  currentItem: null
};

/* =========================================================
   HELPERS
========================================================= */

const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));

function normalize(v){
  return String(v || "").toLowerCase().trim();
}

function createEl(tag, cls, txt){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(txt) e.textContent = txt;
  return e;
}

/* =========================================================
   RAIL WIDTH LOCK
========================================================= */

function applyReaderRailBounds(){
  const reader = document.getElementById("reader");
  const leftRail = document.querySelector(".left-rail");
  const rightRail = document.querySelector(".right-rail");

  if(!reader){
    return;
  }

  if(!leftRail || !rightRail || window.innerWidth < 1380){
    reader.style.maxWidth = "760px";
    reader.style.width = "100%";
    reader.style.margin = "0 auto";
    return;
  }

  const leftRect = leftRail.getBoundingClientRect();
  const rightRect = rightRail.getBoundingClientRect();

  const available = rightRect.left - leftRect.right;
  const safe = Math.max(CONFIG.readerMinWidth,
               Math.min(available - CONFIG.readerSidePadding,
                        CONFIG.readerMaxWidth));

  reader.style.width = safe + "px";
  reader.style.maxWidth = safe + "px";
  reader.style.margin = "0 auto";
}

/* =========================================================
   FETCH
========================================================= */

async function fetchJson(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error(url);
  return r.json();
}

/* =========================================================
   LOAD LIBRARY
========================================================= */

async function loadLibrary(){
  const data = await fetchJson(CONFIG.libraryFile);
  STATE.works = data.works || [];
  STATE.sourceMap = data.sources || {};
}

/* =========================================================
   QUERY STATE
========================================================= */

function getQuery(){
  const u = new URL(location.href);
  return {
    dir: u.searchParams.get("dir") || "",
    file: u.searchParams.get("file") || ""
  };
}

function setQuery(dir,file){
  const u = new URL(location.href);
  u.searchParams.set("dir",dir);
  u.searchParams.set("file",file);
  history.pushState({}, "", u);
}

/* =========================================================
   RESOLVE ENTRY
========================================================= */

function resolveEntry(dir,file){
  dir = normalize(dir);
  file = normalize(file);

  for(const w of STATE.works){
    if(normalize(w.slug) !== dir) continue;

    for(const e of w.entries){
      if(normalize(e.slug) === file){
        return {work:w, entry:e};
      }
    }
  }
  return null;
}

/* =========================================================
   IMAGE BLOCK
========================================================= */

function imageBlock(src){
  const wrap = createEl("div","image-wrap");
  const img = document.createElement("img");
  img.src = src;
  img.loading = "lazy";
  img.decoding = "async";
  wrap.appendChild(img);
  return wrap;
}

/* =========================================================
   BUILD READER
========================================================= */

async function buildReader(work, entry){
  const reader = $("#reader");
  reader.innerHTML = "";

  const itemUrl =
    `${STATE.sourceMap[work.source]}/works/${work.slug}/${entry.path}/item.json`;

  const manifest = await fetchJson(itemUrl);
  STATE.currentItem = manifest;

  const base = manifest.base_url;
  const ext = manifest.extension;
  const pad = manifest.padding;
  const pages = manifest.pages;

  for(let i=1;i<=pages;i++){
    const file = String(i).padStart(pad,"0")+"."+ext;
    reader.appendChild(imageBlock(base+"/"+file));
  }

  applyReaderRailBounds();
  buildTraversal();
}

/* =========================================================
   TRAVERSAL PILLS
========================================================= */

function buildTraversal(){
  const top = $("#topTraversal");
  const bottom = $("#bottomTraversal");

  if(!top || !bottom) return;

  const entries = STATE.currentWork.entries;
  const currentIndex = entries.findIndex(e =>
    normalize(e.slug) === normalize(STATE.currentEntry.slug));

  const pills = createCompactWindow(entries, currentIndex);

  top.innerHTML = "";
  bottom.innerHTML = "";

  pills.forEach(e=>{
    const b1 = pillButton(e);
    const b2 = pillButton(e);
    top.appendChild(b1);
    bottom.appendChild(b2);
  });

  const expand = createEl("button","pill expand","All");
  expand.onclick = ()=>{
    bottom.innerHTML = "";
    entries.forEach(e=> bottom.appendChild(pillButton(e)));
  };

  bottom.appendChild(expand);
}

function pillButton(entry){
  const b = createEl("button","pill",entry.subtitle);
  b.onclick = ()=> switchEntry(STATE.currentWork.slug, entry.slug);
  return b;
}

function createCompactWindow(entries,index){
  const r = CONFIG.compactRadius;
  const start = Math.max(0,index-r);
  const end = Math.min(entries.length,index+r+1);
  return entries.slice(start,end);
}

/* =========================================================
   SWITCH ENTRY
========================================================= */

async function switchEntry(dir,file){
  const sel = resolveEntry(dir,file);
  if(!sel) return;

  STATE.currentWork = sel.work;
  STATE.currentEntry = sel.entry;

  setQuery(dir,file);
  await buildReader(sel.work, sel.entry);

  window.scrollTo(0,0);
}

/* =========================================================
   KEYBOARD NAV
========================================================= */

document.addEventListener("keydown", e=>{
  if(e.key === "ArrowRight") nextChapter();
  if(e.key === "ArrowLeft") prevChapter();
});

function nextChapter(){
  const entries = STATE.currentWork.entries;
  const i = entries.findIndex(e=>e.slug===STATE.currentEntry.slug);
  if(i < entries.length-1){
    switchEntry(STATE.currentWork.slug, entries[i+1].slug);
  }
}

function prevChapter(){
  const entries = STATE.currentWork.entries;
  const i = entries.findIndex(e=>e.slug===STATE.currentEntry.slug);
  if(i > 0){
    switchEntry(STATE.currentWork.slug, entries[i-1].slug);
  }
}

/* =========================================================
   INIT
========================================================= */

async function init(){
  await loadLibrary();

  const q = getQuery();
  let sel = resolveEntry(q.dir, q.file);

  if(!sel){
    sel = {
      work: STATE.works[0],
      entry: STATE.works[0].entries[0]
    };
  }

  STATE.currentWork = sel.work;
  STATE.currentEntry = sel.entry;

  await buildReader(sel.work, sel.entry);
}

window.addEventListener("resize", applyReaderRailBounds);
window.addEventListener("load", init);
