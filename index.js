(() => {
  "use strict";

  // ============================================================
  // Config
  // ============================================================

  const LIBRARY_FILE = "library.json";
  const DEFAULT_WORKS_BASE = "https://pub-cd01009a7c6c464aa0b093e33aa5ae51.r2.dev/works";
  const ITEM_JSON_NAME = "item.json";
  const BOTTOM_AD_COUNT = 6;

  const RAIL_REFRESH_MS = 45000;
  const BANNER_REFRESH_MS = 60000;
  const BETWEEN_REFRESH_MS = 50000;
  const MOBILE_STICKY_REFRESH_MS = 60000;

  const READ_PROGRESS_PREFETCH = 0.7;
  const SEARCH_RESULTS_LIMIT = 12;
  const IS_MOBILE_READER = document.body?.dataset?.readerMode === "mobile";

  const MIN_GLOBAL_SERVE_GAP_MS = 1200;
  const MIN_SLOT_REFRESH_GAP_MS = 30000;
  const VIEWPORT_THRESHOLD = 0.2;
  const INTERSTITIAL_DELAY_MS = 1200;
  const VIDEO_SLIDER_DELAY_MS = 5000;

  const TOP_COMPACT_RADIUS = 5;
  const BOTTOM_COMPACT_RADIUS = 5;

  const ZONES = {
    topBanner: 5865232,
    leftRail: 5865238,
    rightRail: 5865240,
    betweenMulti: 5867482
  };

  const SPECIAL_ZONES = {
    desktopInterstitial: {
      zoneId: 5880058,
      className: "eas6a97888e35",
      host: "https://a.pemsrv.com/ad-provider.js"
    },
    mobileInterstitial: {
      zoneId: 5880060,
      className: "eas6a97888e33",
      host: "https://a.pemsrv.com/ad-provider.js"
    },
    desktopVideoSlider: {
      zoneId: 5880066,
      className: "eas6a97888e31",
      host: "https://a.magsrv.com/ad-provider.js"
    },
    desktopRecommend: {
      zoneId: 5880068,
      className: "eas6a97888e20",
      host: "https://a.magsrv.com/ad-provider.js"
    },
    mobileSticky: {
      zoneId: 5880082,
      className: "eas6a97888e10",
      host: "https://a.magsrv.com/ad-provider.js"
    }
  };

  const LEFT_RAIL_IDS = [
    "leftRailSlot1","leftRailSlot2","leftRailSlot3","leftRailSlot4","leftRailSlot5","leftRailSlot6",
    "leftRailSlot7","leftRailSlot8","leftRailSlot9","leftRailSlot10","leftRailSlot11","leftRailSlot12"
  ];

  const RIGHT_RAIL_IDS = [
    "rightRailSlot1","rightRailSlot2","rightRailSlot3","rightRailSlot4","rightRailSlot5","rightRailSlot6",
    "rightRailSlot7","rightRailSlot8","rightRailSlot9","rightRailSlot10","rightRailSlot11","rightRailSlot12"
  ];

  // ============================================================
  // State
  // ============================================================

  let ARCHIVE_WORKS = [];
  let SOURCE_MAP = {};
  let CURRENT_WORK = null;
  let CURRENT_ENTRY = null;
  let CURRENT_ITEM = null;

  let topFlyoutsWired = false;
  let stickyControlsWired = false;
  let searchWired = false;
  let railRefreshTimer = null;
  let bannerRefreshTimer = null;
  let betweenRefreshTimer = null;
  let mobileStickyRefreshTimer = null;
  let nextPrefetch = null;
  let progressWatchWired = false;
  let mobileWorksWired = false;
  let mobileOpenWorkSlug = "";
  let dialWired = false;
  let keyboardNavWired = false;

  let adServeScheduled = false;
  let lastServeAt = 0;
  let adVisibilityObserver = null;
  let adActionBurstCooldownUntil = 0;
  let videoSliderLoaded = false;
  let videoSliderScheduled = false;
  let mobileStickyLoaded = false;
  let retentionToastTimer = null;

  const providerLoadPromises = new Map();

  // ============================================================
  // Helpers
  // ============================================================

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeKey(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function titleCaseSlug(slug) {
    return String(slug ?? "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function normalizeBaseUrl(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function now() {
    return Date.now();
  }

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function injectEnhancementStyles() {
    if (document.getElementById("reader-enhancement-styles")) return;

    const style = document.createElement("style");
    style.id = "reader-enhancement-styles";
    style.textContent = `
      .traversal-bar.compact {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .traversal-pills-window {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .traversal-gap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        opacity: 0.7;
        font-size: 18px;
        line-height: 1;
      }

      .traversal-compact-footer {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .traversal-expand-toggle {
        appearance: none;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.04);
        color: inherit;
        border-radius: 999px;
        padding: 10px 14px;
        cursor: pointer;
        font: inherit;
      }

      .traversal-expand-toggle:hover {
        background: rgba(255,255,255,.08);
      }

      .traversal-full-wrap {
        display: none;
      }

      .traversal-full-wrap.open {
        display: block;
      }

      .traversal-full-scroll {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        overflow-y: hidden;
        padding-bottom: 6px;
        scroll-behavior: smooth;
      }

      .traversal-full-scroll::-webkit-scrollbar {
        height: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  }

  function isElementInViewport(el, threshold = VIEWPORT_THRESHOLD) {
    if (!el || !el.isConnected) return false;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw) return false;

    const visibleX = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
    const visibleY = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    const visibleArea = visibleX * visibleY;
    const totalArea = rect.width * rect.height;
    if (totalArea <= 0) return false;

    return (visibleArea / totalArea) >= threshold;
  }

  function canRefreshSlot(el) {
    if (!el) return false;
    const last = Number(el.dataset.lastRefreshAt || 0);
    return (now() - last) >= MIN_SLOT_REFRESH_GAP_MS;
  }

  function stampSlotRefresh(el) {
    if (!el) return;
    el.dataset.lastRefreshAt = String(now());
  }

  function markSlotSeen(el) {
    if (!el) return;
    el.dataset.seen = "1";
  }

  function resolveSourceKey(work, entry) {
    return entry?.source || work?.source || "";
  }

  function getSourceBaseByKey(sourceKey) {
    if (!sourceKey) return "";
    return normalizeBaseUrl(SOURCE_MAP[sourceKey] || "");
  }

  function getWorkBase(work, entry) {
    return normalizeBaseUrl(
      entry?.base_url ||
      getSourceBaseByKey(resolveSourceKey(work, entry)) ||
      work?.base_url ||
      DEFAULT_WORKS_BASE
    );
  }

  function getItemJsonUrl(work, entry) {
    if (entry?.item_url) return entry.item_url;

    const entryPathOrSlug = entry?.path || entry?.slug || "";
    const safeParts = String(entryPathOrSlug)
      .split("/")
      .filter(Boolean)
      .map(part => encodeURIComponent(part));

    return `${getWorkBase(work, entry)}/${encodeURIComponent(work.slug)}/${safeParts.join("/")}/${ITEM_JSON_NAME}`;
  }

  function scrollToReaderTopInstant() {
    const target =
      document.getElementById("readerTopAnchor") ||
      document.getElementById("reader") ||
      document.getElementById("searchBarAnchor");

    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      window.scrollTo(0, 0);
    }
  }

  function scrollToReaderContentStartInstant() {
    const target =
      document.getElementById("readerContentStartAnchor") ||
      document.querySelector(".image-wrap") ||
      document.getElementById("readerTopAnchor") ||
      document.getElementById("reader");

    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      window.scrollTo(0, 0);
    }
  }

  function scrollToSearchBar() {
    const target =
      document.getElementById("searchBarAnchor") ||
      document.querySelector(".hero");

    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ============================================================
  // Mobile work list
  // ============================================================

  function setMobileOpenWork(workSlug) {
    mobileOpenWorkSlug = normalizeKey(workSlug || "");

    const items = $$(".mobile-work-item");
    items.forEach(item => {
      const isOpen = normalizeKey(item.dataset.workSlug) === mobileOpenWorkSlug;
      item.classList.toggle("open", isOpen);
      item.classList.toggle("active", isOpen);
    });
  }

  function syncDialThumb() {
    if (!IS_MOBILE_READER) return;

    const scrollEl = document.getElementById("worksNav");
    const track = document.getElementById("dialTrack");
    const thumb = document.getElementById("dialThumb");
    if (!scrollEl || !track || !thumb) return;

    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const trackH = track.clientHeight;
    const thumbH = thumb.offsetHeight;
    const maxTop = Math.max(0, trackH - thumbH);

    const ratio = maxScroll > 0 ? scrollEl.scrollTop / maxScroll : 0;
    thumb.style.top = `${maxTop * ratio}px`;
  }

  function wireMobileDial() {
    if (!IS_MOBILE_READER || dialWired) return;
    dialWired = true;

    const scrollEl = document.getElementById("worksNav");
    const track = document.getElementById("dialTrack");
    const thumb = document.getElementById("dialThumb");
    if (!scrollEl || !track || !thumb) return;

    let dragging = false;

    const moveThumb = (clientY) => {
      const rect = track.getBoundingClientRect();
      const thumbH = thumb.offsetHeight;
      const maxTop = Math.max(0, rect.height - thumbH);

      let top = clientY - rect.top - thumbH / 2;
      top = Math.max(0, Math.min(maxTop, top));

      const ratio = maxTop > 0 ? top / maxTop : 0;
      const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);

      scrollEl.scrollTop = maxScroll * ratio;
      thumb.style.top = `${top}px`;
    };

    track.addEventListener("pointerdown", (e) => {
      dragging = true;
      track.setPointerCapture?.(e.pointerId);
      moveThumb(e.clientY);
    });

    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      moveThumb(e.clientY);
    });

    track.addEventListener("pointerup", (e) => {
      dragging = false;
      track.releasePointerCapture?.(e.pointerId);
    });

    track.addEventListener("pointercancel", () => {
      dragging = false;
    });

    scrollEl.addEventListener("scroll", syncDialThumb, { passive: true });
    window.addEventListener("resize", syncDialThumb);

    syncDialThumb();
  }

  // ============================================================
  // Ads
  // ============================================================

  function rawServeAds() {
    (window.AdProvider = window.AdProvider || []).push({ serve: {} });
    lastServeAt = now();
    adServeScheduled = false;
  }

  function serveAds(force = false) {
    const elapsed = now() - lastServeAt;

    if (force || elapsed >= MIN_GLOBAL_SERVE_GAP_MS) {
      rawServeAds();
      return;
    }

    if (adServeScheduled) return;
    adServeScheduled = true;

    window.setTimeout(() => {
      rawServeAds();
    }, Math.max(0, MIN_GLOBAL_SERVE_GAP_MS - elapsed));
  }

  function burstServeAds() {
    if (document.hidden) return;

    if (now() < adActionBurstCooldownUntil) return;
    adActionBurstCooldownUntil = now() + 3500;

    serveAds(true);
    window.setTimeout(() => serveAds(true), 700);
  }

  function ensureAdProviderScript(src) {
    if (!src) return Promise.resolve();

    if (providerLoadPromises.has(src)) {
      return providerLoadPromises.get(src);
    }

    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      const done = Promise.resolve();
      providerLoadPromises.set(src, done);
      return done;
    }

    const promise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.async = true;
      s.type = "application/javascript";
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ad provider: ${src}`));
      document.head.appendChild(s);
    });

    providerLoadPromises.set(src, promise);
    return promise;
  }

  function makeIns(zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    const ins = document.createElement("ins");
    ins.className = className;
    ins.setAttribute("data-zoneid", String(zoneId));
    ins.setAttribute("data-sub", String(sub));
    ins.setAttribute("data-sub2", String(sub2));
    ins.setAttribute("data-sub3", String(sub3));
    return ins;
  }

  function makeSpecialIns(zoneId, className) {
    const ins = document.createElement("ins");
    ins.className = className;
    ins.setAttribute("data-zoneid", String(zoneId));
    return ins;
  }

  function refillSlot(el, zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    if (!el) return;
    el.innerHTML = "";
    el.appendChild(makeIns(zoneId, sub, sub2, sub3, className));
    stampSlotRefresh(el);
  }

  function fillSlot(el, zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    if (!el) return;
    refillSlot(el, zoneId, sub, sub2, sub3, className);
    serveAds();
  }

  function refillSlotIfVisible(el, zoneId, sub = 1, sub2 = 1, sub3 = 1, className = "eas6a97888e38") {
    if (!el || document.hidden) return false;
    if (!isElementInViewport(el)) return false;
    if (!canRefreshSlot(el)) return false;

    refillSlot(el, zoneId, sub, sub2, sub3, className);
    markSlotSeen(el);
    return true;
  }

  function createRuntimeMount(id) {
    const mount = document.createElement("div");
    mount.id = id;
    mount.style.position = "relative";
    mount.style.width = "0";
    mount.style.height = "0";
    mount.style.overflow = "visible";
    mount.style.zIndex = "999999";
    return mount;
  }

  async function mountRuntimeSpecial(id, cfg) {
    if (!cfg) return null;
    await ensureAdProviderScript(cfg.host);

    let mount = document.getElementById(id);
    if (!mount) {
      mount = createRuntimeMount(id);
      document.body.appendChild(mount);
    }

    mount.innerHTML = "";
    mount.appendChild(makeSpecialIns(cfg.zoneId, cfg.className));
    serveAds(true);

    return mount;
  }

  async function fireChapterInterstitial() {
    const cfg = IS_MOBILE_READER ? SPECIAL_ZONES.mobileInterstitial : SPECIAL_ZONES.desktopInterstitial;
    const id = IS_MOBILE_READER ? "runtime-mobile-interstitial" : "runtime-desktop-interstitial";
    await mountRuntimeSpecial(id, cfg);
    await delay(INTERSTITIAL_DELAY_MS);
  }

  function positionDesktopStickyAwayFromVideo() {
    if (IS_MOBILE_READER) return;

    const stickyCluster = document.getElementById("stickyCluster");
    const progressChip = document.querySelector(".chapter-progress-chip");

    if (stickyCluster) {
      stickyCluster.style.right = "auto";
      stickyCluster.style.left = "18px";
      stickyCluster.style.bottom = "18px";
    }

    if (progressChip) {
      progressChip.style.left = "18px";
      progressChip.style.right = "auto";
      progressChip.style.bottom = "140px";
    }
  }

  function scheduleVideoSlider() {
    if (IS_MOBILE_READER || videoSliderLoaded || videoSliderScheduled) return;

    videoSliderScheduled = true;
    window.setTimeout(async () => {
      if (videoSliderLoaded) return;
      await mountRuntimeSpecial("runtime-desktop-video-slider", SPECIAL_ZONES.desktopVideoSlider);
      videoSliderLoaded = true;
      positionDesktopStickyAwayFromVideo();
    }, VIDEO_SLIDER_DELAY_MS);
  }

  async function loadMobileStickyBanner(force = false) {
    if (!IS_MOBILE_READER) return;

    const mount = document.getElementById("mobileStickyMount");
    if (!mount) return;
    if (mobileStickyLoaded && !force) return;

    await ensureAdProviderScript(SPECIAL_ZONES.mobileSticky.host);
    mount.innerHTML = "";
    mount.appendChild(makeSpecialIns(SPECIAL_ZONES.mobileSticky.zoneId, SPECIAL_ZONES.mobileSticky.className));
    stampSlotRefresh(mount);
    serveAds(true);
    mobileStickyLoaded = true;
  }

  function setupAdVisibilityObserver() {
    if (adVisibilityObserver) {
      adVisibilityObserver.disconnect();
      adVisibilityObserver = null;
    }

    adVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target) {
          markSlotSeen(entry.target);
        }
      }
    }, {
      root: null,
      threshold: [0.2, 0.5]
    });

    $$(".slot, .top-banner-inner").forEach(el => {
      adVisibilityObserver.observe(el);
    });
  }

  // ============================================================
  // Data loading
  // ============================================================

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url} (${res.status})`);
    }
    return res.json();
  }

  async function loadLibrary() {
    const data = await fetchJson(LIBRARY_FILE);
    ARCHIVE_WORKS = Array.isArray(data.works) ? data.works : [];
    SOURCE_MAP = data && typeof data.sources === "object" && data.sources ? data.sources : {};
  }

  function getQueryState() {
    const url = new URL(window.location.href);
    return {
      dir: url.searchParams.get("dir") || "",
      file: url.searchParams.get("file") || ""
    };
  }

  function setQueryState(dir, file, replace = false) {
    const url = new URL(window.location.href);
    url.searchParams.set("dir", dir);
    url.searchParams.set("file", file);

    if (replace) {
      history.replaceState({ dir, file }, "", url);
    } else {
      history.pushState({ dir, file }, "", url);
    }
  }

  function getFirstEntry() {
    for (const work of ARCHIVE_WORKS) {
      const first = Array.isArray(work.entries) ? work.entries[0] : null;
      if (work?.slug && first?.slug) {
        return { work, entry: first };
      }
    }
    return { work: null, entry: null };
  }

  function resolveSelection(dir, file) {
    const d = normalizeKey(dir);
    const f = normalizeKey(file);

    for (const work of ARCHIVE_WORKS) {
      if (normalizeKey(work.slug) !== d) continue;
      for (const entry of work.entries || []) {
        if (normalizeKey(entry.slug) === f) {
          return { work, entry };
        }
      }
    }

    return null;
  }

  function buildImageList(manifest) {
    if (Array.isArray(manifest.images) && manifest.images.length) {
      return manifest.images;
    }

    if (Number.isFinite(manifest.pages) && manifest.pages > 0) {
      const ext = manifest.extension || "jpg";
      const padding = Number.isFinite(manifest.padding) ? manifest.padding : 2;

      return Array.from({ length: manifest.pages }, (_, i) => {
        const n = String(i + 1).padStart(padding, "0");
        return `${n}.${ext}`;
      });
    }

    return [];
  }

  function getSubids(manifest) {
    const fallbackWork = Number(manifest.parent_work_id) || 1;

    return {
      work: manifest.subids?.work ?? fallbackWork,
      top: manifest.subids?.top ?? fallbackWork + 10,
      left: manifest.subids?.left ?? fallbackWork + 20,
      right: manifest.subids?.right ?? fallbackWork + 30,
      between: manifest.subids?.between ?? fallbackWork + 40
    };
  }

  // ============================================================
  // Reader blocks
  // ============================================================

  function imageBlock(src, alt) {
    const wrap = document.createElement("div");
    wrap.className = "image-wrap";

    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.loading = "lazy";
    img.decoding = "async";

    wrap.appendChild(img);
    return wrap;
  }

  function betweenAd(manifest, groupNumber, slotCount) {
    const subids = getSubids(manifest);

    const wrap = document.createElement("div");
    wrap.className = "between-grid";

    for (let i = 1; i <= slotCount; i++) {
      const slot = document.createElement("div");
      slot.className = "slot between-slot";
      slot.dataset.zoneType = "between";
      slot.dataset.zoneId = String(ZONES.betweenMulti);
      slot.dataset.sub = String(subids.between);
      slot.dataset.sub2 = String(subids.work);
      slot.dataset.sub3 = String(Number(`${groupNumber}${i}`));

      slot.appendChild(
        makeIns(ZONES.betweenMulti, subids.between, subids.work, Number(`${groupNumber}${i}`))
      );
      wrap.appendChild(slot);
    }

    return wrap;
  }

  function endAds(manifest, count) {
    const subids = getSubids(manifest);

    const wrap = document.createElement("div");
    wrap.className = "end-grid";

    for (let i = 1; i <= count; i++) {
      const slot = document.createElement("div");
      slot.className = "slot between-slot";
      slot.dataset.zoneType = "between";
      slot.dataset.zoneId = String(ZONES.betweenMulti);
      slot.dataset.sub = String(subids.between);
      slot.dataset.sub2 = String(subids.work);
      slot.dataset.sub3 = String(9000 + i);

      slot.appendChild(makeIns(ZONES.betweenMulti, subids.between, subids.work, 9000 + i));
      wrap.appendChild(slot);
    }

    return wrap;
  }

  function buildRecommendationWidget() {
    if (IS_MOBILE_READER) return null;

    const shell = document.createElement("section");
    shell.className = "recommend-shell";

    const title = document.createElement("p");
    title.className = "recommend-title";
    title.textContent = "More To Read";
    shell.appendChild(title);

    const slot = document.createElement("div");
    slot.className = "slot recommend-slot";
    slot.appendChild(makeSpecialIns(SPECIAL_ZONES.desktopRecommend.zoneId, SPECIAL_ZONES.desktopRecommend.className));
    shell.appendChild(slot);

    return shell;
  }

  function fillRailStacks(subids) {
    LEFT_RAIL_IDS.forEach((id, index) => {
      fillSlot(document.getElementById(id), ZONES.leftRail, subids.left, subids.work, index + 1);
    });

    RIGHT_RAIL_IDS.forEach((id, index) => {
      fillSlot(document.getElementById(id), ZONES.rightRail, subids.right, subids.work, index + 1);
    });
  }

  // ============================================================
  // Search
  // ============================================================

  function flattenEntries() {
    const rows = [];

    for (const work of ARCHIVE_WORKS) {
      for (const entry of work.entries || []) {
        rows.push({
          workSlug: work.slug,
          workLabel: work.display || titleCaseSlug(work.slug),
          entrySlug: entry.slug,
          entryLabel: entry.subtitle || titleCaseSlug(entry.slug),
          searchKey: normalizeKey(
            `${work.display || work.slug} ${entry.subtitle || entry.slug} ${entry.slug}`
          )
        });
      }
    }

    return rows;
  }

  function renderSearchResults(items) {
    const results = document.getElementById("chapterSearchResults");
    const stat = document.getElementById("chapterSearchStat");
    if (!results || !stat) return;

    if (!items.length) {
      results.innerHTML = "";
      stat.textContent = IS_MOBILE_READER ? "Type to search" : "No matches yet";
      return;
    }

    stat.textContent = `${items.length} quick jump${items.length === 1 ? "" : "s"}`;
    results.innerHTML = items.map(item => `
      <button class="search-result-pill" type="button" data-dir="${escapeHtml(item.workSlug)}" data-file="${escapeHtml(item.entrySlug)}">
        ${escapeHtml(item.workLabel)} · ${escapeHtml(item.entryLabel)}
      </button>
    `).join("");
  }

  function wireSearch() {
    if (searchWired) return;
    searchWired = true;

    const input = document.getElementById("chapterSearchInput");
    const results = document.getElementById("chapterSearchResults");
    const stat = document.getElementById("chapterSearchStat");
    if (!input || !results || !stat) return;

    const all = flattenEntries();

    const refresh = () => {
      const query = normalizeKey(input.value);

      if (!query) {
        if (IS_MOBILE_READER) {
          results.innerHTML = "";
          stat.textContent = "Type to search";
          return;
        }

        const seeded = all
          .filter(item => item.workSlug === CURRENT_WORK?.slug)
          .slice(0, SEARCH_RESULTS_LIMIT);

        renderSearchResults(seeded);
        stat.textContent = seeded.length ? `Showing ${seeded.length} in this work` : "Ready to jump";
        return;
      }

      const matched = all
        .filter(item => item.searchKey.includes(query))
        .slice(0, SEARCH_RESULTS_LIMIT);

      renderSearchResults(matched);
      stat.textContent = matched.length ? `${matched.length} result${matched.length === 1 ? "" : "s"}` : "No matches";
    };

    input.addEventListener("input", refresh);

    input.addEventListener("focus", () => {
      burstServeAds();
    });

    results.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-dir][data-file]");
      if (!btn) return;

      input.value = "";

      if (IS_MOBILE_READER) {
        results.innerHTML = "";
        stat.textContent = "Type to search";
        setMobileOpenWork(btn.dataset.dir);
      }

      burstServeAds();
      await switchEntry(btn.dataset.dir, btn.dataset.file, false, { actionSource: "search" });

      if (IS_MOBILE_READER) {
        scrollToReaderContentStartInstant();
      }
    });

    refresh();
  }

  function syncSearchSeed() {
    const input = document.getElementById("chapterSearchInput");
    const stat = document.getElementById("chapterSearchStat");
    const results = document.getElementById("chapterSearchResults");
    if (!input || !stat || !results) return;
    if (input.value.trim()) return;

    if (IS_MOBILE_READER) {
      results.innerHTML = "";
      stat.textContent = "Type to search";
      return;
    }

    const seeded = flattenEntries()
      .filter(item => item.workSlug === CURRENT_WORK?.slug)
      .slice(0, SEARCH_RESULTS_LIMIT);

    renderSearchResults(seeded);
    stat.textContent = seeded.length ? `Showing ${seeded.length} in this work` : "Ready to jump";
  }

  // ============================================================
  // Works nav
  // ============================================================

  function renderWorksNav() {
    const nav = document.getElementById("worksNav");
    if (!nav) return;

    if (IS_MOBILE_READER) {
      let html = "";

      for (const work of ARCHIVE_WORKS.filter(w => w.top_pill !== false)) {
        const isActiveWork = normalizeKey(work.slug) === normalizeKey(CURRENT_WORK?.slug);
        const isOpen = normalizeKey(work.slug) === normalizeKey(mobileOpenWorkSlug || CURRENT_WORK?.slug);
        const entries = Array.isArray(work.entries) ? work.entries : [];

        html += `
          <section class="mobile-work-item${isActiveWork ? " active" : ""}${isOpen ? " open" : ""}" data-work-slug="${escapeHtml(work.slug)}">
            <button class="mobile-work-trigger" type="button" data-work-toggle="${escapeHtml(work.slug)}">
              <span class="label">${escapeHtml(work.display || titleCaseSlug(work.slug))}</span>
              <span class="count">${entries.length} ${entries.length === 1 ? "chapter" : "chapters"}</span>
            </button>
            <div class="mobile-chapters">
        `;

        for (const entry of entries) {
          const active =
            isActiveWork && normalizeKey(entry.slug) === normalizeKey(CURRENT_ENTRY?.slug)
              ? " current"
              : "";

          html += `
            <button
              class="mobile-chapter-link${active}"
              type="button"
              data-dir="${escapeHtml(work.slug)}"
              data-file="${escapeHtml(entry.slug)}"
            >
              ${escapeHtml(entry.subtitle || titleCaseSlug(entry.slug))}
            </button>
          `;
        }

        html += `
            </div>
          </section>
        `;
      }

      nav.innerHTML = html;
      syncDialThumb();
      return;
    }

    let html = "";

    for (const work of ARCHIVE_WORKS.filter(w => w.top_pill !== false)) {
      const isActive = normalizeKey(work.slug) === normalizeKey(CURRENT_WORK?.slug);
      const entries = Array.isArray(work.entries) ? work.entries : [];

      html += `
        <div class="topworks-item${isActive ? " active" : ""}">
          <button class="topworks-trigger" type="button">
            <span>${escapeHtml(work.display || titleCaseSlug(work.slug))}</span>
            <span class="topworks-caret"></span>
          </button>
          <div class="topworks-flyout">
            <div class="topworks-links">
      `;

      for (const entry of entries) {
        const label = `${work.display || titleCaseSlug(work.slug)} · ${entry.subtitle || titleCaseSlug(entry.slug)}`;
        const active = isActive && normalizeKey(entry.slug) === normalizeKey(CURRENT_ENTRY?.slug) ? " active" : "";

        html += `
          <a href="?dir=${encodeURIComponent(work.slug)}&file=${encodeURIComponent(entry.slug)}" class="topworks-link${active}" data-dir="${escapeHtml(work.slug)}" data-file="${escapeHtml(entry.slug)}">${escapeHtml(label)}</a>
        `;
      }

      html += `
            </div>
          </div>
        </div>
      `;
    }

    nav.innerHTML = html;

    nav.onclick = async (e) => {
      const a = e.target.closest("a[data-dir][data-file]");
      if (!a) return;
      e.preventDefault();
      burstServeAds();
      await switchEntry(a.dataset.dir, a.dataset.file, false, { actionSource: "top-nav" });
    };
  }

  function wireTopFlyouts() {
    if (topFlyoutsWired) return;
    topFlyoutsWired = true;

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest(".topworks-trigger");
      if (trigger) {
        const item = trigger.closest(".topworks-item");
        if (!item) return;

        e.preventDefault();
        const wasOpen = item.classList.contains("open");
        $$(".topworks-item.open").forEach(x => x.classList.remove("open"));
        if (!wasOpen) {
          item.classList.add("open");
          burstServeAds();
        }
        return;
      }

      if (!e.target.closest(".topworks-item")) {
        $$(".topworks-item.open").forEach(x => x.classList.remove("open"));
      }
    });
  }

  function wireMobileWorksNav() {
    if (!IS_MOBILE_READER || mobileWorksWired) return;
    mobileWorksWired = true;

    const nav = document.getElementById("worksNav");
    if (!nav) return;

    nav.addEventListener("click", async (e) => {
      const toggle = e.target.closest("[data-work-toggle]");
      if (toggle) {
        const slug = toggle.dataset.workToggle;
        const normalized = normalizeKey(slug);
        const isAlreadyOpen = normalized === normalizeKey(mobileOpenWorkSlug);

        setMobileOpenWork(isAlreadyOpen ? "" : slug);
        syncDialThumb();
        burstServeAds();
        return;
      }

      const chapterBtn = e.target.closest("button[data-dir][data-file]");
      if (!chapterBtn) return;

      const dir = chapterBtn.dataset.dir;
      const file = chapterBtn.dataset.file;

      setMobileOpenWork(dir);
      burstServeAds();
      await switchEntry(dir, file, false, { actionSource: "mobile-nav" });
      scrollToReaderContentStartInstant();
    });
  }

  // ============================================================
  // Entry context
  // ============================================================

  function getEntryContext() {
    const entries = Array.isArray(CURRENT_WORK?.entries) ? CURRENT_WORK.entries : [];
    const currentIndex = entries.findIndex(entry => normalizeKey(entry.slug) === normalizeKey(CURRENT_ENTRY?.slug));

    return {
      entries,
      currentIndex,
      prev: currentIndex > 0 ? entries[currentIndex - 1] : null,
      next: currentIndex >= 0 && currentIndex < entries.length - 1 ? entries[currentIndex + 1] : null
    };
  }

  function getCurrentChapterPosition() {
    const { currentIndex } = getEntryContext();
    return currentIndex >= 0 ? currentIndex + 1 : 0;
  }

  // ============================================================
  // Traversal
  // ============================================================

  function makeTraversalPill(label, onClick, extraClass = "", disabled = false) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `traversal-pill${extraClass ? ` ${extraClass}` : ""}`;
    btn.textContent = label;
    btn.disabled = !!disabled;

    if (!disabled && typeof onClick === "function") {
      btn.addEventListener("click", onClick);
    }

    return btn;
  }

  function buildCompactRange(entries, currentIndex, radius) {
    if (currentIndex < 0) return [];
    const start = Math.max(0, currentIndex - radius);
    const end = Math.min(entries.length - 1, currentIndex + radius);
    return entries.slice(start, end + 1).map((entry, offset) => ({
      entry,
      index: start + offset
    }));
  }

  function buildCompactPillWindow(entries, currentIndex, radius, sourceLabel) {
    const frag = document.createDocumentFragment();
    const windowed = buildCompactRange(entries, currentIndex, radius);

    if (windowed.length && windowed[0].index > 0) {
      const gap = document.createElement("span");
      gap.className = "traversal-gap";
      gap.textContent = "…";
      frag.appendChild(gap);
    }

    for (const item of windowed) {
      const isCurrent = item.index === currentIndex;
      const label = item.entry.subtitle || titleCaseSlug(item.entry.slug);
      frag.appendChild(
        makeTraversalPill(
          label,
          () => switchEntry(CURRENT_WORK.slug, item.entry.slug, false, {
            actionSource: sourceLabel
          }),
          isCurrent ? "current" : ""
        )
      );
    }

    if (windowed.length && windowed[windowed.length - 1].index < entries.length - 1) {
      const gap = document.createElement("span");
      gap.className = "traversal-gap";
      gap.textContent = "…";
      frag.appendChild(gap);
    }

    return frag;
  }

  function buildBottomExpandedFullStrip(entries, currentIndex) {
    const wrap = document.createElement("div");
    wrap.className = "traversal-full-wrap";
    wrap.id = "bottomTraversalFullWrap";

    const scroller = document.createElement("div");
    scroller.className = "traversal-full-scroll";
    scroller.id = "bottomTraversalFullScroll";

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isCurrent = i === currentIndex;
      const label = entry.subtitle || titleCaseSlug(entry.slug);

      const pill = makeTraversalPill(
        label,
        () => switchEntry(CURRENT_WORK.slug, entry.slug, false, {
          actionSource: "bottom-full-pill"
        }),
        isCurrent ? "current" : ""
      );

      if (isCurrent) {
        pill.id = "bottomTraversalCurrentPill";
      }

      scroller.appendChild(pill);
    }

    wrap.appendChild(scroller);
    return wrap;
  }

  function centerBottomCurrentPill() {
    const scroller = document.getElementById("bottomTraversalFullScroll");
    const pill = document.getElementById("bottomTraversalCurrentPill");
    if (!scroller || !pill) return;

    const targetLeft = pill.offsetLeft - (scroller.clientWidth / 2) + (pill.clientWidth / 2);
    scroller.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: "smooth"
    });
  }

  function toggleBottomFullTraversal() {
    const wrap = document.getElementById("bottomTraversalFullWrap");
    const toggle = document.getElementById("bottomTraversalExpandToggle");
    if (!wrap || !toggle) return;

    const isOpen = wrap.classList.toggle("open");
    toggle.textContent = isOpen ? "Hide full chapter strip" : "Show full chapter strip";

    if (isOpen) {
      centerBottomCurrentPill();
      burstServeAds();
    }
  }

  function buildTraversal(position = "top") {
    const shell = document.createElement("section");
    shell.className = `traversal-shell ${position}`;
    if (position === "bottom") shell.id = "bottomTraversal";

    const kicker = document.createElement("p");
    kicker.className = "traversal-kicker";
    kicker.textContent = IS_MOBILE_READER
      ? "Quick Chapter Jump"
      : (position === "top" ? "Chapter Navigation" : "Keep The Scroll Alive");
    shell.appendChild(kicker);

    const { entries, currentIndex, prev, next } = getEntryContext();

    if (IS_MOBILE_READER) {
      const bar = document.createElement("div");
      bar.className = "traversal-bar";

      bar.appendChild(
        makeTraversalPill(
          "← Previous",
          prev ? () => switchEntry(CURRENT_WORK.slug, prev.slug, false, { actionSource: "mobile-prev" }) : null,
          "",
          !prev
        )
      );

      bar.appendChild(
        makeTraversalPill("Search", () => {
          burstServeAds();
          scrollToSearchBar();
        })
      );

      bar.appendChild(
        makeTraversalPill(
          next ? `Next: ${next.subtitle || titleCaseSlug(next.slug)}` : "Next →",
          next ? () => switchEntry(CURRENT_WORK.slug, next.slug, false, { actionSource: "mobile-next" }) : null,
          "",
          !next
        )
      );

      shell.appendChild(bar);
      return shell;
    }

    if (position === "top") {
      const bar = document.createElement("div");
      bar.className = "traversal-bar compact";

      bar.appendChild(
        makeTraversalPill(
          "← Previous",
          prev ? () => switchEntry(CURRENT_WORK.slug, prev.slug, false, { actionSource: "prev" }) : null,
          "",
          !prev
        )
      );

      const windowWrap = document.createElement("div");
      windowWrap.className = "traversal-pills-window";
      windowWrap.appendChild(buildCompactPillWindow(entries, currentIndex, TOP_COMPACT_RADIUS, "top-compact-pill"));
      bar.appendChild(windowWrap);

      bar.appendChild(
        makeTraversalPill(
          "Next →",
          next ? () => switchEntry(CURRENT_WORK.slug, next.slug, false, { actionSource: "next" }) : null,
          "",
          !next
        )
      );

      shell.appendChild(bar);
      return shell;
    }

    const footer = document.createElement("div");
    footer.className = "traversal-compact-footer";

    const prompt = document.createElement("div");
    prompt.className = "continue-prompt";
    prompt.textContent = next
      ? `Finished this chapter? Continue straight into ${next.subtitle || titleCaseSlug(next.slug)}.`
      : "Finished this chapter? Pick your next move right here.";
    footer.appendChild(prompt);

    const compactBar = document.createElement("div");
    compactBar.className = "traversal-bar compact";

    compactBar.appendChild(
      makeTraversalPill(
        "← Previous",
        prev ? () => switchEntry(CURRENT_WORK.slug, prev.slug, false, { actionSource: "prev-bottom" }) : null,
        "",
        !prev
      )
    );

    const windowWrap = document.createElement("div");
    windowWrap.className = "traversal-pills-window";
    windowWrap.appendChild(buildCompactPillWindow(entries, currentIndex, BOTTOM_COMPACT_RADIUS, "bottom-compact-pill"));
    compactBar.appendChild(windowWrap);

    compactBar.appendChild(
      makeTraversalPill(
        "Next →",
        next ? () => switchEntry(CURRENT_WORK.slug, next.slug, false, { actionSource: "next-bottom" }) : null,
        "",
        !next
      )
    );

    footer.appendChild(compactBar);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "traversal-expand-toggle";
    toggle.id = "bottomTraversalExpandToggle";
    toggle.textContent = "Show full chapter strip";
    toggle.addEventListener("click", toggleBottomFullTraversal);
    footer.appendChild(toggle);

    footer.appendChild(buildBottomExpandedFullStrip(entries, currentIndex));

    shell.appendChild(footer);
    return shell;
  }

  // ============================================================
  // Progress
  // ============================================================

  function updateStickyBottomAction(progress = 0) {
    const btn = document.getElementById("scrollToBottomTraversalBtn");
    if (!btn) return;

    const { next } = getEntryContext();

    if (progress >= 1 && next) {
      btn.textContent = `Continue: ${next.subtitle || titleCaseSlug(next.slug)}`;
      btn.onclick = async () => {
        burstServeAds();
        await switchEntry(CURRENT_WORK.slug, next.slug, false, { actionSource: "sticky-next" });
      };
      return;
    }

    btn.textContent = "Last Page | Traversal Options";
    btn.onclick = () => {
      burstServeAds();
      const target = document.getElementById("bottomTraversal") || document.getElementById("readerBottomAnchor");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  function showRetentionToast(message) {
    if (IS_MOBILE_READER) return;

    let toast = document.getElementById("readerRetentionToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "readerRetentionToast";
      toast.style.position = "fixed";
      toast.style.top = "18px";
      toast.style.right = "18px";
      toast.style.zIndex = "7001";
      toast.style.padding = "12px 14px";
      toast.style.border = "1px solid rgba(255,255,255,.14)";
      toast.style.borderRadius = "16px";
      toast.style.background = "rgba(12,14,20,.88)";
      toast.style.backdropFilter = "blur(14px)";
      toast.style.boxShadow = "0 18px 50px rgba(0,0,0,.35)";
      toast.style.color = "#f7f8fb";
      toast.style.fontFamily = '"Handjet", system-ui, sans-serif';
      toast.style.fontSize = "16px";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      toast.style.transition = "opacity .18s ease, transform .18s ease";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    if (retentionToastTimer) clearTimeout(retentionToastTimer);
    retentionToastTimer = window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
    }, 1200);
  }

  function getReadingProgressFromPages() {
    const pages = $$(".image-wrap");
    if (!pages.length) {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      return scrollable > 0 ? window.scrollY / scrollable : 0;
    }

    const first = pages[0];
    const last = pages[pages.length - 1];

    const firstTop = window.scrollY + first.getBoundingClientRect().top;
    const lastBottom = window.scrollY + last.getBoundingClientRect().bottom;
    const viewportBottom = window.scrollY + window.innerHeight;

    if (viewportBottom <= firstTop) return 0;
    if (viewportBottom >= lastBottom) return 1;

    return (viewportBottom - firstTop) / Math.max(1, lastBottom - firstTop);
  }

  function updateChapterProgress(progress = 0) {
    const clamped = Math.max(0, Math.min(1, progress));
    const percent = Math.round(clamped * 100);

    const pageBar = document.getElementById("pageProgressBar");
    const fill = document.getElementById("chapterProgressFill");
    const label = document.getElementById("chapterProgressLabel");
    const text = document.getElementById("chapterProgressPercent");

    if (pageBar) pageBar.style.width = `${percent}%`;
    if (fill) fill.style.width = `${percent}%`;
    if (text) text.textContent = `${percent}%`;

    if (label) {
      const chapterNo = getCurrentChapterPosition();
      const baseLabel = CURRENT_ENTRY?.subtitle || CURRENT_ITEM?.subtitle || "Chapter Progress";
      label.textContent = chapterNo ? `Chapter ${chapterNo} · ${baseLabel}` : baseLabel;
    }

    updateStickyBottomAction(clamped);
  }

  function wireStickyControls() {
    if (stickyControlsWired) return;
    stickyControlsWired = true;

    const topBtn = document.getElementById("scrollToSearchBtn");

    if (topBtn) {
      topBtn.addEventListener("click", () => {
        burstServeAds();
        scrollToSearchBar();
      });
    }

    updateStickyBottomAction(0);
  }

  // ============================================================
  // Refresh timers
  // ============================================================

  function clearRefreshTimers() {
    if (railRefreshTimer) clearInterval(railRefreshTimer);
    if (bannerRefreshTimer) clearInterval(bannerRefreshTimer);
    if (betweenRefreshTimer) clearInterval(betweenRefreshTimer);
    if (mobileStickyRefreshTimer) clearInterval(mobileStickyRefreshTimer);
    railRefreshTimer = null;
    bannerRefreshTimer = null;
    betweenRefreshTimer = null;
    mobileStickyRefreshTimer = null;
  }

  function refreshVisibleRailSlots() {
    if (document.hidden || !CURRENT_ITEM || IS_MOBILE_READER) return false;

    const subids = getSubids(CURRENT_ITEM);
    let refreshed = false;

    LEFT_RAIL_IDS.forEach((id, index) => {
      const ok = refillSlotIfVisible(document.getElementById(id), ZONES.leftRail, subids.left, subids.work, index + 1);
      refreshed = refreshed || ok;
    });

    RIGHT_RAIL_IDS.forEach((id, index) => {
      const ok = refillSlotIfVisible(document.getElementById(id), ZONES.rightRail, subids.right, subids.work, index + 1);
      refreshed = refreshed || ok;
    });

    if (refreshed) serveAds();
    return refreshed;
  }

  function refreshVisibleTopBanner() {
    if (document.hidden || !CURRENT_ITEM || IS_MOBILE_READER) return false;

    const subids = getSubids(CURRENT_ITEM);
    const el = document.getElementById("topBannerSlot");
    const refreshed = refillSlotIfVisible(el, ZONES.topBanner, subids.top, subids.work, 1);

    if (refreshed) serveAds();
    return refreshed;
  }

  function refreshVisibleBetweenSlots() {
    if (document.hidden || !CURRENT_ITEM) return false;

    let refreshed = false;

    $$(".between-slot").forEach((el) => {
      const zoneId = Number(el.dataset.zoneId || 0);
      const sub = Number(el.dataset.sub || 1);
      const sub2 = Number(el.dataset.sub2 || 1);
      const sub3 = Number(el.dataset.sub3 || 1);
      if (!zoneId) return;

      const ok = refillSlotIfVisible(el, zoneId, sub, sub2, sub3);
      refreshed = refreshed || ok;
    });

    if (refreshed) serveAds();
    return refreshed;
  }

  async function refreshMobileSticky() {
    if (!IS_MOBILE_READER) return false;
    const mount = document.getElementById("mobileStickyMount");
    if (!mount || document.hidden) return false;
    if (!canRefreshSlot(mount)) return false;

    await loadMobileStickyBanner(true);
    return true;
  }

  function startRefreshTimers() {
    clearRefreshTimers();

    if (!IS_MOBILE_READER) {
      railRefreshTimer = window.setInterval(() => {
        refreshVisibleRailSlots();
      }, RAIL_REFRESH_MS);

      bannerRefreshTimer = window.setInterval(() => {
        refreshVisibleTopBanner();
      }, BANNER_REFRESH_MS);

      betweenRefreshTimer = window.setInterval(() => {
        refreshVisibleBetweenSlots();
      }, BETWEEN_REFRESH_MS);
      return;
    }

    mobileStickyRefreshTimer = window.setInterval(() => {
      refreshMobileSticky();
    }, MOBILE_STICKY_REFRESH_MS);
  }

  // ============================================================
  // Prefetch / reader ads
  // ============================================================

  function maybePreloadNextChapter() {
    if (nextPrefetch || !CURRENT_WORK || !CURRENT_ENTRY) return;

    const { next } = getEntryContext();
    if (!next) return;

    const itemUrl = getItemJsonUrl(CURRENT_WORK, next);

    nextPrefetch = fetchJson(itemUrl)
      .then(manifest => {
        const images = buildImageList(manifest).slice(0, 3);
        const base = normalizeBaseUrl(manifest.base_url);

        images.forEach(name => {
          const img = new Image();
          img.decoding = "async";
          img.src = `${base}/${name}`;
        });

        return manifest;
      })
      .catch(() => null);
  }

  function maybeServeVisibleReaderAds() {
    let refreshed = false;
    refreshed = refreshVisibleBetweenSlots() || refreshed;
    refreshed = refreshVisibleRailSlots() || refreshed;
    refreshed = refreshVisibleTopBanner() || refreshed;

    if (!refreshed) {
      const visibleBetween = $$(".between-slot").some(el => isElementInViewport(el));
      if (visibleBetween) {
        serveAds();
      }
    }
  }

  function wireProgressWatch() {
    if (progressWatchWired) return;
    progressWatchWired = true;

    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const progress = getReadingProgressFromPages();

        updateChapterProgress(progress);

        if (progress >= READ_PROGRESS_PREFETCH) {
          maybePreloadNextChapter();
        }

        maybeServeVisibleReaderAds();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ============================================================
  // Keyboard navigation
  // ============================================================

  function wireKeyboardNavigation() {
    if (keyboardNavWired) return;
    keyboardNavWired = true;

    document.addEventListener("keydown", async (e) => {
      if (isTypingTarget(e.target)) return;
      if (!CURRENT_WORK || !CURRENT_ENTRY) return;

      const { prev, next } = getEntryContext();

      if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        burstServeAds();
        await switchEntry(CURRENT_WORK.slug, next.slug, false, { actionSource: "keyboard-next" });
        return;
      }

      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        burstServeAds();
        await switchEntry(CURRENT_WORK.slug, prev.slug, false, { actionSource: "keyboard-prev" });
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        scrollToReaderContentStartInstant();
        return;
      }

      if (e.key === "End") {
        e.preventDefault();
        const bottom = document.getElementById("bottomTraversal") || document.getElementById("readerBottomAnchor");
        if (bottom) {
          bottom.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  }

  // ============================================================
  // Meta / build
  // ============================================================

  function buildChapterMeta(manifest, imageCount) {
    const meta = document.createElement("section");
    meta.className = "chapter-meta";

    const row = document.createElement("div");
    row.className = "meta-row";

    const chapterNo = getCurrentChapterPosition();
    const leftTag = document.createElement("div");
    leftTag.className = "chapter-tag";
    leftTag.textContent = `${manifest.title || CURRENT_WORK.display || titleCaseSlug(CURRENT_WORK.slug)} · ${manifest.subtitle || CURRENT_ENTRY.subtitle || titleCaseSlug(CURRENT_ENTRY.slug)}${chapterNo ? ` · #${chapterNo}` : ""}`;

    const rightTag = document.createElement("div");
    rightTag.className = "chapter-tag";
    rightTag.textContent = `${imageCount} page${imageCount === 1 ? "" : "s"}`;

    row.appendChild(leftTag);
    row.appendChild(rightTag);

    const note = document.createElement("div");
    note.className = "chapter-note";
    note.textContent = IS_MOBILE_READER
      ? "Use the chapter controls above or below the pages whenever you want to jump fast."
      : "Keep reading. Use the bottom controls to roll straight into the next chapter without losing momentum.";

    meta.appendChild(row);
    meta.appendChild(note);

    return meta;
  }

  function clearDesktopAdShells() {
    const topBanner = document.getElementById("topBannerSlot");
    if (topBanner) topBanner.innerHTML = "";

    [...LEFT_RAIL_IDS, ...RIGHT_RAIL_IDS].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  function shouldShowInterstitial(dir, file, options = {}) {
    if (options.skipInterstitial) return false;

    const selection = resolveSelection(dir, file);
    if (!selection) return false;

    const entries = Array.isArray(selection.work?.entries) ? selection.work.entries : [];
    const targetIndex = entries.findIndex(entry => normalizeKey(entry.slug) === normalizeKey(file));

    // Skip first three chapters.
    if (targetIndex < 3) return false;

    const isDifferentChapter =
      normalizeKey(dir) !== normalizeKey(CURRENT_WORK?.slug) ||
      normalizeKey(file) !== normalizeKey(CURRENT_ENTRY?.slug);

    if (!isDifferentChapter) return false;

    return true;
  }

  async function buildReader() {
    const reader = document.getElementById("reader");
    if (!reader) return;

    nextPrefetch = null;
    updateChapterProgress(0);

    const state = getQueryState();
    let resolved = resolveSelection(state.dir, state.file);

    if (!resolved) {
      const first = getFirstEntry();
      resolved = first.work && first.entry ? first : null;
      if (resolved) setQueryState(resolved.work.slug, resolved.entry.slug, true);
    }

    if (!resolved) {
      throw new Error("No works found in library.json");
    }

    CURRENT_WORK = resolved.work;
    CURRENT_ENTRY = resolved.entry;

    if (IS_MOBILE_READER) {
      mobileOpenWorkSlug = resolved.work.slug;
    }

    const itemUrl = getItemJsonUrl(resolved.work, resolved.entry);
    const manifest = await fetchJson(itemUrl);
    CURRENT_ITEM = manifest;

    const title = `${resolved.work.display || titleCaseSlug(resolved.work.slug)} · ${manifest.subtitle || resolved.entry.subtitle || titleCaseSlug(resolved.entry.slug)}`;
    const workTitleEl = document.getElementById("workTitle");
    if (workTitleEl) workTitleEl.textContent = title;

    renderWorksNav();
    syncSearchSeed();

    const subids = getSubids(manifest);

    if (!IS_MOBILE_READER) {
      fillSlot(document.getElementById("topBannerSlot"), ZONES.topBanner, subids.top, subids.work, 1);
      fillRailStacks(subids);
      scheduleVideoSlider();
      positionDesktopStickyAwayFromVideo();
    } else {
      clearDesktopAdShells();
      await loadMobileStickyBanner();
    }

    reader.innerHTML = "";

    const topAnchor = document.createElement("span");
    topAnchor.id = "readerTopAnchor";
    topAnchor.className = "reader-anchor";
    reader.appendChild(topAnchor);

    const images = buildImageList(manifest);
    const base = normalizeBaseUrl(manifest.base_url);

    if (!base) throw new Error(`Manifest for ${resolved.entry.slug} is missing base_url`);
    if (!images.length) throw new Error(`Manifest for ${resolved.entry.slug} has no images`);

    reader.appendChild(buildChapterMeta(manifest, images.length));

    const note = document.createElement("div");
    note.className = "note";
    note.textContent = IS_MOBILE_READER
      ? "Tap through chapters up top, then just sink into the scroll."
      : "Stay in the flow. Bottom controls keep you moving into the next chapter fast.";
    reader.appendChild(note);

    reader.appendChild(buildTraversal("top"));

    const contentStartAnchor = document.createElement("span");
    contentStartAnchor.id = "readerContentStartAnchor";
    contentStartAnchor.className = "reader-anchor";
    reader.appendChild(contentStartAnchor);

    const betweenEvery = IS_MOBILE_READER ? 2 : (Number(manifest.ads?.between_every) || 0);
    const betweenSlots = IS_MOBILE_READER ? 1 : (Number(manifest.ads?.between_slots) || 3);
    const finalBlock = IS_MOBILE_READER ? 0 : Math.max(Number(manifest.ads?.final_block) || 0, BOTTOM_AD_COUNT);

    let groupNumber = 0;

    for (let i = 0; i < images.length; i++) {
      reader.appendChild(
        imageBlock(
          `${base}/${images[i]}`,
          `${manifest.title || resolved.work.display || resolved.work.slug} page ${i + 1}`
        )
      );

      const pageNumber = i + 1;
      const shouldInsertBetween =
        betweenEvery > 0 &&
        pageNumber % betweenEvery === 0 &&
        pageNumber < images.length;

      if (shouldInsertBetween) {
        groupNumber += 1;
        reader.appendChild(betweenAd(manifest, groupNumber, betweenSlots));
      }
    }

    if (finalBlock > 0) {
      reader.appendChild(endAds(manifest, finalBlock));
    }

    reader.appendChild(buildTraversal("bottom"));

    const recommend = buildRecommendationWidget();
    if (recommend) {
      reader.appendChild(recommend);
      await ensureAdProviderScript(SPECIAL_ZONES.desktopRecommend.host);
    }

    const bottomAnchor = document.createElement("span");
    bottomAnchor.id = "readerBottomAnchor";
    bottomAnchor.className = "reader-anchor";
    reader.appendChild(bottomAnchor);

    setupAdVisibilityObserver();
    serveAds(true);
    startRefreshTimers();
    updateChapterProgress(0);

    window.setTimeout(() => serveAds(true), 900);

    if (IS_MOBILE_READER) {
      syncDialThumb();
    }
  }

  async function switchEntry(dir, file, replace = false, options = {}) {
    const { actionSource = "unknown" } = options;

    if (shouldShowInterstitial(dir, file, options)) {
      await fireChapterInterstitial();
    }

    setQueryState(dir, file, replace);

    if (actionSource) {
      burstServeAds();
    }

    await buildReader();

    if (actionSource) {
      window.setTimeout(() => burstServeAds(), 600);
    }

    scrollToReaderContentStartInstant();
    showRetentionToast(`Now reading: ${CURRENT_ENTRY?.subtitle || titleCaseSlug(file)}`);
  }

  // ============================================================
  // Visibility / clicks
  // ============================================================

  function wireDocumentVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;

      serveAds(true);
      window.setTimeout(() => {
        refreshVisibleTopBanner();
        refreshVisibleRailSlots();
        refreshVisibleBetweenSlots();
        refreshMobileSticky();
      }, 400);
    });
  }

  function wireReaderClickMonetization() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const hotSelectors = [
        ".image-wrap img",
        ".topworks-link",
        ".topworks-trigger",
        ".search-result-pill",
        ".traversal-pill",
        ".mobile-work-trigger",
        ".mobile-chapter-link",
        "#scrollToSearchBtn",
        "#scrollToBottomTraversalBtn",
        "#bottomTraversalExpandToggle"
      ];

      if (hotSelectors.some(sel => target.closest(sel))) {
        burstServeAds();
      }
    }, { passive: true });
  }

  // ============================================================
  // Boot
  // ============================================================

  async function boot() {
    injectEnhancementStyles();

    await Promise.all([
      ensureAdProviderScript("https://a.magsrv.com/ad-provider.js"),
      ensureAdProviderScript("https://a.pemsrv.com/ad-provider.js")
    ]);

    await loadLibrary();

    wireTopFlyouts();
    wireStickyControls();
    wireProgressWatch();
    wireSearch();
    wireMobileWorksNav();
    wireMobileDial();
    wireDocumentVisibility();
    wireReaderClickMonetization();
    wireKeyboardNavigation();

    await buildReader();

    window.addEventListener("popstate", async () => {
      await buildReader();
      scrollToReaderContentStartInstant();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot().catch(err => {
      console.error(err);
      clearRefreshTimers();

      const workTitleEl = document.getElementById("workTitle");
      if (workTitleEl) workTitleEl.textContent = "Failed to load work";

      const reader = document.getElementById("reader");
      if (reader) {
        reader.innerHTML = `
          <div class="note">
            Failed to load this work. Please check library.json, sources, item.json, base_url, and image filenames.
          </div>
        `;
      }
    });
  });
})();
