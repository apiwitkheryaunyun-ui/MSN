const statusEl = document.getElementById("status-text");
const clockEl = document.getElementById("clock");
const startBtn = document.getElementById("start-btn");
const startMenu = document.getElementById("start-menu");
const desktop = document.getElementById("desktop");
const windowLayer = document.getElementById("window-layer");
const taskButtons = document.getElementById("task-buttons");
const appWindows = Array.from(document.querySelectorAll(".xp-window[data-app]"));
const iconButtons = Array.from(document.querySelectorAll(".icon-btn[data-open-app]"));
const startMenuLaunchItems = Array.from(document.querySelectorAll("#start-menu [data-open-app]"));
const mediaAudio = document.getElementById("media-audio");
const playlistItems = Array.from(document.querySelectorAll(".playlist-item[data-track]"));
const wmpMenuButtons = Array.from(document.querySelectorAll("#wmp-menubar [data-wmp-menu]"));
const wmpNavButtons = Array.from(document.querySelectorAll(".wmp9-nav-btn[data-wmp-view]"));
const wmpShellEl = document.getElementById("wmp-shell");
const wmpStatusLineEl = document.getElementById("wmp-status-line");
const wmpViewContentEl = document.getElementById("wmp-view-content");
const wmpMetaLineEl = document.getElementById("wmp-meta-line");
const wmpTitleEl = document.getElementById("wmp-title");
const wmpAlbumEl = document.getElementById("wmp-album");
const wmpCoverEl = document.getElementById("wmp-cover");
const wmpPrevBtn = document.getElementById("wmp-prev");
const wmpPlayBtn = document.getElementById("wmp-play");
const wmpNextBtn = document.getElementById("wmp-next");
const wmpProgressEl = document.getElementById("wmp-progress");
const wmpProgressFillEl = document.getElementById("wmp-progress-fill");
const wmpCurrentTimeEl = document.getElementById("wmp-current-time");
const wmpDurationEl = document.getElementById("wmp-duration");
const widgetClockEl = document.getElementById("widget-clock");
const cpuMeterBar = document.getElementById("cpu-meter-bar");
const cpuMeterText = document.getElementById("cpu-meter-text");
const widgetNoteEl = document.getElementById("widget-note");
const widgetNoteContentEl = document.getElementById("widget-note-content");
const stickyColorButtons = Array.from(document.querySelectorAll(".sticky-color-btn[data-sticky-color]"));
const desktopGadgets = Array.from(document.querySelectorAll(".desktop-gadget[data-gadget]"));
const gadgetTiles = Array.from(document.querySelectorAll(".gadget-tile[data-gadget-tile]"));
const gadgetToggleButtons = Array.from(document.querySelectorAll(".gadget-toggle-btn[data-gadget-toggle]"));
const gadgetSearchInput = document.getElementById("gadget-search");
const analogClockEl = document.getElementById("analog-clock");
const weatherTempEl = document.getElementById("weather-temp");
const weatherCityEl = document.getElementById("weather-city");
const weatherSummaryEl = document.getElementById("weather-summary");
const photoFrameImageEl = document.getElementById("photo-frame-image");
const photoPrevBtn = document.getElementById("photo-prev");
const photoNextBtn = document.getElementById("photo-next");

const statuses = [
  "ONLINE",
  "NEW MESSAGES: 03",
  "INDEXING THREADS",
  "BACKUP READY",
  "ADMIN MODE"
];

let statusIndex = 0;
let zCounter = 20;
let draggingState = null;
let isMobileLayout = window.innerWidth <= 1024;
let currentTrackIndex = 0;
let isShuffleEnabled = false;
let currentWmpSkinIndex = 0;
let isRepeatEnabled = false;
let audioContext = null;
let mediaSourceNode = null;
let eqFilters = [];
let mediaLibraryQuery = "";
let mediaLibrarySort = "original";
let currentPhotoIndex = 0;
const WINDOW_SNAP_PX = 12;

const UI_FX_FREQ = {
  open: 840,
  minimize: 220,
  close: 180,
  start: 520,
};

const gadgetStorageKey = "xp-enabled-gadgets";
const noteKey = "xp-widget-note";
const noteColorKey = "xp-widget-note-color";
const weatherCities = [
  { city: "Palo Alto", temp: 64, summary: "Sunny and clear" },
  { city: "Bangkok", temp: 91, summary: "Warm with light haze" },
  { city: "Tokyo", temp: 70, summary: "Clouds moving in" },
];
const photoFrameImages = [
  "Asset/Photo Frame & Wallpaper/Ascent.jpg",
  "Asset/Photo Frame & Wallpaper/Autumn.jpg",
  "Asset/Photo Frame & Wallpaper/Azul.jpg",
  "Asset/Photo Frame & Wallpaper/classic-windows-xp-3840x2160-17244.jpg",
  "Asset/Photo Frame & Wallpaper/Crystal.jpg",
  "Asset/Photo Frame & Wallpaper/Follow.jpg",
  "Asset/Photo Frame & Wallpaper/Friend.jpg",
  "Asset/Photo Frame & Wallpaper/Home.jpg",
];

const eqBands = [
  { label: "60Hz", frequency: 60, type: "lowshelf" },
  { label: "170Hz", frequency: 170, type: "peaking" },
  { label: "1kHz", frequency: 1000, type: "peaking" },
  { label: "3.5kHz", frequency: 3500, type: "peaking" },
  { label: "10kHz", frequency: 10000, type: "highshelf" },
];

const eqState = [0, 0, 0, 0, 0];

const wmpSkins = ["default", "blue", "olive"];

function setWmpStatus(message) {
  if (wmpStatusLineEl) {
    wmpStatusLineEl.textContent = message;
  }
}

function setWmpViewContent(html) {
  if (!wmpViewContentEl) {
    return;
  }

  if (!html) {
    wmpViewContentEl.hidden = true;
    wmpViewContentEl.innerHTML = "";
    return;
  }

  wmpViewContentEl.hidden = false;
  wmpViewContentEl.innerHTML = html;
}

function getRadioTunerMarkup() {
  const sliderMarkup = eqBands
    .map((band, index) => {
      const value = eqState[index] ?? 0;
      return `
        <label class="wmp-eq-band">
          <span>${band.label}</span>
          <input type="range" min="-12" max="12" step="1" value="${value}" data-eq-band="${index}" aria-label="${band.label} equalizer" />
          <strong data-eq-value="${index}">${value} dB</strong>
        </label>
      `;
    })
    .join("");

  return `<h4>Radio Tuner</h4><p>ปรับ EQ ได้จริงกับเพลงที่กำลังเล่นอยู่</p><div class="wmp-mini-actions"><button type="button" data-radio-track="0">Aero FM</button><button type="button" data-radio-track="1">Glass FM</button><button type="button" data-radio-track="2">Luna FM</button></div><div class="wmp-eq-grid">${sliderMarkup}</div><div class="wmp-mini-actions"><button type="button" data-eq-preset="flat">Flat</button><button type="button" data-eq-preset="bass">Bass Boost</button><button type="button" data-eq-preset="vocal">Vocal</button></div>`;
}

function getTrackData() {
  return playlistItems.map((item, index) => ({
    index,
    title: item.dataset.title || item.querySelector("span")?.textContent || `Track ${index + 1}`,
    album: item.dataset.album || "Unknown Album",
    cover: item.dataset.cover || "",
    track: item.dataset.track || "",
    duration: item.querySelector("small")?.textContent || "0:00",
  }));
}

function getMediaGuideMarkup() {
  const cards = getTrackData()
    .map(
      (track) => `<button type="button" class="wmp-guide-card" data-radio-track="${track.index}"><strong>${track.title}</strong><span>${track.album}</span></button>`
    )
    .join("");
  return `<h4>Media Guide</h4><p>เลือกแชนแนลลัดเพื่อเล่นเพลงได้ทันที</p><div class="wmp-guide-grid">${cards}</div>`;
}

function getCdAudioMarkup() {
  return `<h4>CD Audio</h4><p>ควบคุมแผ่นเพลงจำลองจาก playlist ชุดปัจจุบัน</p><div class="wmp-mini-actions"><button type="button" data-cd-action="play">Play Disc</button><button type="button" data-cd-action="stop">Stop</button><button type="button" data-cd-action="repeat">Repeat: ${isRepeatEnabled ? "On" : "Off"}</button></div>`;
}

function getPortableDeviceMarkup() {
  const volume = Math.round((mediaAudio?.volume ?? 1) * 100);
  const muted = mediaAudio?.muted ? "true" : "false";
  return `<h4>Portable Device</h4><p>ปรับเสียงหลักและ mute ของ player ได้จริง</p><div class="wmp-device-panel"><label class="wmp-inline-control"><span>Volume</span><input type="range" min="0" max="100" step="1" value="${volume}" data-device-volume="true" /><strong data-device-volume-label="true">${volume}%</strong></label><div class="wmp-mini-actions"><button type="button" data-device-mute="toggle">${muted === "true" ? "Unmute" : "Mute"}</button></div></div>`;
}

function getFilteredSortedTracks() {
  const tracks = getTrackData().filter((track) => {
    const search = mediaLibraryQuery.trim().toLowerCase();
    if (!search) {
      return true;
    }
    return `${track.title} ${track.album}`.toLowerCase().includes(search);
  });

  if (mediaLibrarySort === "title") {
    tracks.sort((left, right) => left.title.localeCompare(right.title));
  }

  if (mediaLibrarySort === "album") {
    tracks.sort((left, right) => left.album.localeCompare(right.album));
  }

  return tracks;
}

function getMediaLibraryMarkup() {
  const items = getFilteredSortedTracks()
    .map(
      (track) => `<button type="button" class="wmp-library-item" data-library-track="${track.index}"><span><strong>${track.title}</strong><em>${track.album}</em></span><small>${track.duration}</small></button>`
    )
    .join("");

  return `<h4>Media Library</h4><div class="wmp-library-toolbar"><input type="search" value="${mediaLibraryQuery}" placeholder="Search tracks" data-library-search="true" aria-label="Search tracks" /><select data-library-sort="true" aria-label="Sort tracks"><option value="original"${mediaLibrarySort === "original" ? " selected" : ""}>Original</option><option value="title"${mediaLibrarySort === "title" ? " selected" : ""}>Title</option><option value="album"${mediaLibrarySort === "album" ? " selected" : ""}>Album</option></select></div><div class="wmp-library-list">${items || '<p class="wmp-empty">No tracks found.</p>'}</div>`;
}

function refreshActiveWmpView() {
  const activeButton = wmpNavButtons.find((button) => button.classList.contains("active"));
  if (activeButton?.dataset.wmpView) {
    activateWmpView(activeButton.dataset.wmpView);
  }
}

function ensureAudioGraph() {
  if (!mediaAudio) {
    return false;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return false;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
    mediaSourceNode = audioContext.createMediaElementSource(mediaAudio);

    eqFilters = eqBands.map((band, index) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.gain.value = eqState[index] ?? 0;
      filter.Q.value = band.type === "peaking" ? 1.1 : 0.7;
      return filter;
    });

    let currentNode = mediaSourceNode;
    eqFilters.forEach((filter) => {
      currentNode.connect(filter);
      currentNode = filter;
    });
    currentNode.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {
      // Resume can fail if browser blocks interaction timing.
    });
  }

  return true;
}

function applyEqState() {
  eqFilters.forEach((filter, index) => {
    filter.gain.value = eqState[index] ?? 0;
  });

  if (wmpViewContentEl) {
    wmpViewContentEl.querySelectorAll("[data-eq-value]").forEach((output) => {
      const index = Number(output.getAttribute("data-eq-value"));
      if (!Number.isInteger(index)) {
        return;
      }
      output.textContent = `${eqState[index]} dB`;
    });

    wmpViewContentEl.querySelectorAll("input[data-eq-band]").forEach((input) => {
      const index = Number(input.getAttribute("data-eq-band"));
      if (!Number.isInteger(index)) {
        return;
      }
      input.value = String(eqState[index]);
    });
  }
}

function setEqPreset(preset) {
  const presets = {
    flat: [0, 0, 0, 0, 0],
    bass: [8, 5, 1, -1, -2],
    vocal: [-2, 1, 5, 4, 1],
  };

  const values = presets[preset];
  if (!values) {
    return;
  }

  values.forEach((value, index) => {
    eqState[index] = value;
  });
  ensureAudioGraph();
  applyEqState();
  setWmpStatus(`EQ preset: ${preset}`);
}

function activateWmpView(view) {
  wmpNavButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.wmpView === view);
  });

  if (view === "now-playing") {
    setWmpViewContent("");
    setWmpStatus("Now Playing view ready");
    return;
  }

  if (view === "media-guide") {
    setWmpViewContent(getMediaGuideMarkup());
    setWmpStatus("Media Guide opened");
    return;
  }

  if (view === "cd-audio") {
    setWmpViewContent(getCdAudioMarkup());
    setWmpStatus("CD Audio controls ready");
    return;
  }

  if (view === "media-library") {
    setWmpViewContent(getMediaLibraryMarkup());
    setWmpStatus("Media Library ready");
    return;
  }

  if (view === "radio-tuner") {
    setWmpViewContent(getRadioTunerMarkup());
    applyEqState();
    setWmpStatus("Radio Tuner EQ ready");
    return;
  }

  if (view === "portable-device") {
    setWmpViewContent(getPortableDeviceMarkup());
    setWmpStatus("Portable Device controls ready");
    return;
  }

  if (view === "skin-chooser") {
    setWmpViewContent(
      "<h4>Skin Chooser</h4><p>Choose a player skin.</p><div class=\"wmp-mini-actions\"><button type=\"button\" data-skin=\"default\">Default</button><button type=\"button\" data-skin=\"blue\">Blue</button><button type=\"button\" data-skin=\"olive\">Olive</button></div>"
    );
    setWmpStatus("Skin Chooser opened");
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getEnabledGadgets() {
  try {
    const stored = localStorage.getItem(gadgetStorageKey);
    if (!stored) {
      return new Set(["clock", "weather", "cpu", "note", "photo"]);
    }
    return new Set(JSON.parse(stored));
  } catch {
    return new Set(["clock", "weather", "cpu", "note", "photo"]);
  }
}

function persistEnabledGadgets(enabled) {
  localStorage.setItem(gadgetStorageKey, JSON.stringify(Array.from(enabled)));
}

function syncGadgetVisibility() {
  const enabled = getEnabledGadgets();

  desktopGadgets.forEach((gadget) => {
    const key = gadget.dataset.gadget;
    gadget.classList.toggle("is-hidden-gadget", !enabled.has(key));
  });

  gadgetTiles.forEach((tile) => {
    const key = tile.dataset.gadgetTile;
    tile.classList.toggle("is-disabled", !enabled.has(key));
    const button = tile.querySelector(".gadget-toggle-btn");
    if (button) {
      button.textContent = enabled.has(key) ? "Hide" : "Show";
    }
  });
}

function toggleGadget(key) {
  const enabled = getEnabledGadgets();
  if (enabled.has(key)) {
    enabled.delete(key);
  } else {
    enabled.add(key);
  }
  persistEnabledGadgets(enabled);
  syncGadgetVisibility();
}

function updateAnalogClock() {
  if (!analogClockEl) {
    return;
  }

  const now = new Date();
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  const hourHand = analogClockEl.querySelector(".clock-hand.hour");
  const minuteHand = analogClockEl.querySelector(".clock-hand.minute");
  const secondHand = analogClockEl.querySelector(".clock-hand.second");

  if (hourHand) {
    hourHand.style.transform = `translateX(-50%) rotate(${hours * 30}deg)`;
  }
  if (minuteHand) {
    minuteHand.style.transform = `translateX(-50%) rotate(${minutes * 6}deg)`;
  }
  if (secondHand) {
    secondHand.style.transform = `translateX(-50%) rotate(${seconds * 6}deg)`;
  }
}

function updateWeatherWidget() {
  const weather = weatherCities[new Date().getHours() % weatherCities.length];
  if (weatherTempEl) {
    weatherTempEl.textContent = `${weather.temp}°`;
  }
  if (weatherCityEl) {
    weatherCityEl.textContent = weather.city;
  }
  if (weatherSummaryEl) {
    weatherSummaryEl.textContent = weather.summary;
  }
}

function updatePhotoFrame(indexDelta = 0) {
  if (!photoFrameImageEl || photoFrameImages.length === 0) {
    return;
  }

  currentPhotoIndex = (currentPhotoIndex + indexDelta + photoFrameImages.length) % photoFrameImages.length;
  photoFrameImageEl.src = photoFrameImages[currentPhotoIndex];
}

function filterGadgetTiles(query) {
  const search = query.trim().toLowerCase();
  gadgetTiles.forEach((tile) => {
    const title = tile.querySelector("h3")?.textContent?.toLowerCase() || "";
    tile.hidden = search.length > 0 && !title.includes(search);
  });
}

function setStickyColor(color) {
  if (!widgetNoteEl) {
    return;
  }

  const allowed = ["white", "yellow", "green", "blue", "purple", "pink"];
  const nextColor = allowed.includes(color) ? color : "white";
  widgetNoteEl.dataset.stickyColor = nextColor;
  widgetNoteEl.classList.remove(...allowed);
  widgetNoteEl.classList.add(nextColor);

  stickyColorButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.stickyColor === nextColor);
  });

  localStorage.setItem(noteColorKey, nextColor);
}

function loadTrackByIndex(index) {
  if (!mediaAudio || playlistItems.length === 0) {
    return;
  }

  currentTrackIndex = (index + playlistItems.length) % playlistItems.length;
  const item = playlistItems[currentTrackIndex];
  const source = item.dataset.track;
  if (!source) {
    return;
  }

  mediaAudio.src = source;
  mediaAudio.load();

  const title = item.dataset.title || item.querySelector("span")?.textContent || "Unknown Track";
  const album = item.dataset.album || "Unknown Album";
  const cover = item.dataset.cover;

  if (wmpTitleEl) {
    wmpTitleEl.textContent = title;
  }
  if (wmpAlbumEl) {
    wmpAlbumEl.textContent = album;
  }
  if (wmpCoverEl && cover) {
    wmpCoverEl.src = cover;
  }
  if (wmpMetaLineEl) {
    wmpMetaLineEl.textContent = `Track ${currentTrackIndex + 1} loaded from local playlist`;
  }

  playlistItems.forEach((entry) => entry.classList.remove("active-track"));
  item.classList.add("active-track");
}

function playCurrentTrack() {
  if (!mediaAudio) {
    return;
  }
  ensureAudioGraph();
  mediaAudio.play().catch(() => {
    // Some browsers require explicit interaction before playback.
  });
}

function syncPlayButton() {
  if (!wmpPlayBtn || !mediaAudio) {
    return;
  }

  wmpPlayBtn.innerHTML = mediaAudio.paused ? "&#9658;" : "&#10074;&#10074;";
}

function updateTrackProgress() {
  if (!mediaAudio) {
    return;
  }

  const current = mediaAudio.currentTime || 0;
  const duration = mediaAudio.duration || 0;
  const percent = duration > 0 ? (current / duration) * 100 : 0;

  if (wmpProgressFillEl) {
    wmpProgressFillEl.style.width = `${percent}%`;
  }
  if (wmpCurrentTimeEl) {
    wmpCurrentTimeEl.textContent = formatTime(current);
  }
  if (wmpDurationEl) {
    wmpDurationEl.textContent = formatTime(duration);
  }
}

const appTitles = {
  msn: "MSN Messenger Live",
  forum: "Forum Explorer",
  portfolio: "WorkJap Portfolio",
  topics: "Topic Manager",
  media: "Windows Media Player",
  widgets: "Desktop Widgets"
};

function updateClock() {
  const now = new Date();
  const timeText = now.toLocaleTimeString("th-TH", {
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
  });
  clockEl.textContent = timeText;
  if (widgetClockEl) {
    widgetClockEl.textContent = timeText;
  }
}

function playUiFx(kind) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "start" ? "triangle" : "sine";
    oscillator.frequency.value = UI_FX_FREQ[kind] || 420;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(context.destination);
    const now = context.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  } catch {
    // Ignore browsers that block instant audio context creation.
  }
}

function installXpTooltips() {
  document.querySelectorAll("[title]").forEach((element) => {
    const text = element.getAttribute("title");
    if (!text || element.dataset.xpTip) {
      return;
    }
    element.dataset.xpTip = text;
    element.setAttribute("aria-label", text);
    element.removeAttribute("title");
    element.classList.add("xp-tip-target");
  });
}

function installRippleEffects() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".start-btn, .task-btn, .win-btn, .window-toolbar button, .icon-btn, .gadget-toggle-btn");
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "xp-ripple";
    const size = Math.max(rect.width, rect.height) * 1.2;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    button.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
}

function initDesktopAeroBubbles() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  if (!desktop || desktop.querySelector(".aero-desktop-bubble-layer")) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = "aero-desktop-bubble-layer";
  desktop.appendChild(layer);

  for (let i = 0; i < 10; i += 1) {
    const bubble = document.createElement("div");
    bubble.className = "aero-desktop-bubble";
    const size = 10 + Math.floor(Math.random() * 18);
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${Math.floor(Math.random() * 96)}%`;
    bubble.style.animationDuration = `${14 + Math.floor(Math.random() * 12)}s`;
    bubble.style.animationDelay = `${Math.floor(Math.random() * 9)}s`;
    layer.appendChild(bubble);
  }
}

function cycleStatus() {
  if (!statusEl) {
    return;
  }

  statusIndex = (statusIndex + 1) % statuses.length;
  statusEl.textContent = statuses[statusIndex];
}

function getWindowByApp(appId) {
  return appWindows.find((windowEl) => windowEl.dataset.app === appId);
}

function getTaskButton(appId) {
  return taskButtons.querySelector(`[data-task-app="${appId}"]`);
}

function setTaskActive(appId) {
  taskButtons.querySelectorAll(".task-btn").forEach((button) => {
    const isCurrent = button.dataset.taskApp === appId;
    button.classList.toggle("active", isCurrent);
  });
}

function focusWindow(windowEl) {
  if (!windowEl || windowEl.classList.contains("is-hidden")) {
    return;
  }

  appWindows.forEach((item) => item.classList.remove("is-active"));
  zCounter += 1;
  windowEl.style.zIndex = String(zCounter);
  windowEl.classList.add("is-active");
  setTaskActive(windowEl.dataset.app);

  iconButtons.forEach((iconButton) => {
    iconButton.classList.toggle("is-selected", iconButton.dataset.openApp === windowEl.dataset.app);
  });
}

function ensureTaskButton(appId) {
  let button = getTaskButton(appId);
  if (button) {
    return button;
  }

  button = document.createElement("button");
  button.type = "button";
  button.className = "task-btn";
  button.dataset.taskApp = appId;
  button.textContent = appTitles[appId] || appId;
  taskButtons.appendChild(button);
  return button;
}

function normalizeWindowPosition(windowEl) {
  const layerRect = windowLayer.getBoundingClientRect();
  const rect = windowEl.getBoundingClientRect();
  const left = rect.left - layerRect.left;
  const top = rect.top - layerRect.top;
  const maxLeft = Math.max(0, layerRect.width - rect.width);
  const maxTop = Math.max(0, layerRect.height - rect.height);
  const clampedLeft = Math.min(Math.max(0, left), maxLeft);
  const clampedTop = Math.min(Math.max(0, top), maxTop);
  windowEl.style.left = `${clampedLeft}px`;
  windowEl.style.top = `${clampedTop}px`;
}

function openWindow(appId) {
  const windowEl = getWindowByApp(appId);
  if (!windowEl) {
    return;
  }

  windowEl.classList.remove("is-closing", "is-minimizing");
  windowEl.classList.remove("is-hidden");
  windowEl.classList.remove("is-minimized");
  windowEl.classList.add("is-opening");
  playUiFx("open");
  ensureTaskButton(appId).classList.remove("minimized");
  normalizeWindowPosition(windowEl);
  focusWindow(windowEl);

  windowEl.addEventListener(
    "animationend",
    () => {
      windowEl.classList.remove("is-opening");
    },
    { once: true }
  );
}

function hideWindow(windowEl, animationClass) {
  windowEl.classList.remove("is-opening");
  windowEl.classList.add(animationClass);

  windowEl.addEventListener(
    "animationend",
    () => {
      windowEl.classList.remove(animationClass, "is-active");
      windowEl.classList.add("is-hidden");
    },
    { once: true }
  );
}

function minimizeWindow(windowEl) {
  const appId = windowEl.dataset.app;
  windowEl.classList.add("is-minimized");
  playUiFx("minimize");

  if (isMobileLayout) {
    windowEl.classList.add("is-hidden");
    windowEl.classList.remove("is-active");
  } else {
    hideWindow(windowEl, "is-minimizing");
  }

  const taskBtn = getTaskButton(appId);
  if (taskBtn) {
    taskBtn.classList.add("minimized");
    taskBtn.classList.remove("active");
  }
}

function closeWindow(windowEl) {
  const appId = windowEl.dataset.app;
  playUiFx("close");

  if (isMobileLayout) {
    windowEl.classList.add("is-hidden");
    windowEl.classList.remove("is-active", "is-minimized", "is-maximized");
  } else {
    hideWindow(windowEl, "is-closing");
    windowEl.classList.remove("is-minimized", "is-maximized");
  }

  windowEl.style.width = "";
  windowEl.style.height = "";
  const taskBtn = getTaskButton(appId);
  if (taskBtn) {
    if (isMobileLayout) {
      taskBtn.remove();
    } else {
      setTimeout(() => taskBtn.remove(), 160);
    }
  }
}

function toggleMaximize(windowEl) {
  if (windowEl.classList.contains("is-maximized")) {
    windowEl.classList.remove("is-maximized");
    windowEl.style.left = windowEl.dataset.prevLeft || "";
    windowEl.style.top = windowEl.dataset.prevTop || "";
    windowEl.style.width = windowEl.dataset.prevWidth || "";
    windowEl.style.height = windowEl.dataset.prevHeight || "";
  } else {
    windowEl.dataset.prevLeft = windowEl.style.left || "";
    windowEl.dataset.prevTop = windowEl.style.top || "";
    windowEl.dataset.prevWidth = windowEl.style.width || "";
    windowEl.dataset.prevHeight = windowEl.style.height || "";
    windowEl.classList.add("is-maximized");
  }

  focusWindow(windowEl);
}

function toggleStartMenu(forceOpen) {
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !startMenu.classList.contains("open");
  startMenu.classList.toggle("open", shouldOpen);
  startBtn.setAttribute("aria-expanded", String(shouldOpen));
  startMenu.setAttribute("aria-hidden", String(!shouldOpen));
  if (shouldOpen) {
    playUiFx("start");
  }
}

function handleWindowControlClick(event) {
  const actionButton = event.target.closest("[data-win-action]");
  if (!actionButton) {
    return;
  }

  const windowEl = actionButton.closest(".xp-window[data-app]");
  if (!windowEl) {
    return;
  }

  const action = actionButton.dataset.winAction;
  if (action === "minimize") {
    minimizeWindow(windowEl);
  }
  if (action === "maximize") {
    toggleMaximize(windowEl);
  }
  if (action === "close") {
    closeWindow(windowEl);
  }
}

function dragMove(event) {
  if (!draggingState) {
    return;
  }

  const { windowEl, offsetX, offsetY } = draggingState;
  const layerRect = windowLayer.getBoundingClientRect();
  const rect = windowEl.getBoundingClientRect();

  let nextLeft = event.clientX - layerRect.left - offsetX;
  let nextTop = event.clientY - layerRect.top - offsetY;

  const maxLeft = Math.max(0, layerRect.width - rect.width);
  const maxTop = Math.max(0, layerRect.height - rect.height);

  nextLeft = Math.min(Math.max(0, nextLeft), maxLeft);
  nextTop = Math.min(Math.max(0, nextTop), maxTop);

  if (nextLeft <= WINDOW_SNAP_PX) {
    nextLeft = 0;
  }
  if (nextTop <= WINDOW_SNAP_PX) {
    nextTop = 0;
  }
  if (maxLeft - nextLeft <= WINDOW_SNAP_PX) {
    nextLeft = maxLeft;
  }
  if (maxTop - nextTop <= WINDOW_SNAP_PX) {
    nextTop = maxTop;
  }

  windowEl.style.left = `${nextLeft}px`;
  windowEl.style.top = `${nextTop}px`;
}

function dragEnd() {
  if (draggingState?.windowEl) {
    normalizeWindowPosition(draggingState.windowEl);
  }
  draggingState = null;
  document.removeEventListener("pointermove", dragMove);
  document.removeEventListener("pointerup", dragEnd);
}

function dragStart(event) {
  const dragHandle = event.target.closest("[data-drag-handle]");
  if (!dragHandle || event.target.closest("[data-win-action]")) {
    return;
  }

  const windowEl = dragHandle.closest(".xp-window[data-app]");
  if (!windowEl || windowEl.classList.contains("is-maximized") || isMobileLayout) {
    return;
  }

  normalizeWindowPosition(windowEl);
  focusWindow(windowEl);

  const layerRect = windowLayer.getBoundingClientRect();
  const rect = windowEl.getBoundingClientRect();

  draggingState = {
    windowEl,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    layerLeft: layerRect.left,
    layerTop: layerRect.top
  };

  document.addEventListener("pointermove", dragMove);
  document.addEventListener("pointerup", dragEnd);
}

startBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleStartMenu();
});

appWindows.forEach((windowEl) => {
  windowEl.addEventListener("pointerdown", () => focusWindow(windowEl));
  windowEl.addEventListener("click", handleWindowControlClick);
  const dragHandle = windowEl.querySelector("[data-drag-handle]");
  if (dragHandle) {
    dragHandle.addEventListener("pointerdown", dragStart);
  }
});

iconButtons.forEach((iconButton) => {
  const appId = iconButton.dataset.openApp;
  iconButton.addEventListener("click", () => {
    iconButtons.forEach((item) => item.classList.remove("is-selected"));
    iconButton.classList.add("is-selected");
    openWindow(appId);
  });
  iconButton.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWindow(appId);
    }
  });
});

desktop.addEventListener("click", (event) => {
  if (!event.target.closest(".icon-btn") && !event.target.closest(".xp-window")) {
    iconButtons.forEach((item) => item.classList.remove("is-selected"));
  }
});

taskButtons.addEventListener("click", (event) => {
  const button = event.target.closest(".task-btn[data-task-app]");
  if (!button) {
    return;
  }

  const appId = button.dataset.taskApp;
  const windowEl = getWindowByApp(appId);
  if (!windowEl) {
    return;
  }

  if (windowEl.classList.contains("is-hidden")) {
    openWindow(appId);
    return;
  }

  if (windowEl.classList.contains("is-active")) {
    minimizeWindow(windowEl);
    return;
  }

  focusWindow(windowEl);
});

startMenuLaunchItems.forEach((item) => {
  item.addEventListener("click", () => {
    const appId = item.dataset.openApp;
    if (!appId) {
      return;
    }

    openWindow(appId);
    toggleStartMenu(false);
  });
});

if (mediaAudio && playlistItems.length > 0) {
  loadTrackByIndex(0);
  syncPlayButton();
  updateTrackProgress();

  playlistItems.forEach((item, index) => {
    item.tabIndex = 0;
    item.addEventListener("click", () => {
      loadTrackByIndex(index);
      playCurrentTrack();
      syncPlayButton();
      setWmpStatus(`Playing ${item.dataset.title || "track"}`);
    });

    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        loadTrackByIndex(index);
        playCurrentTrack();
        syncPlayButton();
      }
    });
  });

  if (wmpPlayBtn) {
    wmpPlayBtn.addEventListener("click", () => {
      if (mediaAudio.paused) {
        playCurrentTrack();
        setWmpStatus("Playback started");
      } else {
        mediaAudio.pause();
        setWmpStatus("Playback paused");
      }
      syncPlayButton();
    });
  }

  if (wmpPrevBtn) {
    wmpPrevBtn.addEventListener("click", () => {
      loadTrackByIndex(currentTrackIndex - 1);
      playCurrentTrack();
      syncPlayButton();
      setWmpStatus("Previous track");
    });
  }

  if (wmpNextBtn) {
    wmpNextBtn.addEventListener("click", () => {
      loadTrackByIndex(currentTrackIndex + 1);
      playCurrentTrack();
      syncPlayButton();
      setWmpStatus("Next track");
    });
  }

  if (wmpProgressEl) {
    wmpProgressEl.addEventListener("click", (event) => {
      const rect = wmpProgressEl.getBoundingClientRect();
      const ratio = Math.min(Math.max(0, (event.clientX - rect.left) / rect.width), 1);
      if (Number.isFinite(mediaAudio.duration) && mediaAudio.duration > 0) {
        mediaAudio.currentTime = ratio * mediaAudio.duration;
        setWmpStatus("Seek complete");
      }
    });

    wmpProgressEl.addEventListener("keydown", (event) => {
      if (!Number.isFinite(mediaAudio.duration) || mediaAudio.duration <= 0) {
        return;
      }

      const step = 5;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        mediaAudio.currentTime = Math.min(mediaAudio.duration, mediaAudio.currentTime + step);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        mediaAudio.currentTime = Math.max(0, mediaAudio.currentTime - step);
      }
    });
  }

  mediaAudio.addEventListener("timeupdate", updateTrackProgress);
  mediaAudio.addEventListener("loadedmetadata", updateTrackProgress);
  mediaAudio.addEventListener("ended", () => {
    const nextIndex = isShuffleEnabled
      ? Math.floor(Math.random() * playlistItems.length)
      : currentTrackIndex + 1;
    loadTrackByIndex(nextIndex);
    playCurrentTrack();
    syncPlayButton();
  });
  mediaAudio.addEventListener("play", syncPlayButton);
  mediaAudio.addEventListener("pause", syncPlayButton);
}

if (wmpMenuButtons.length > 0) {
  wmpMenuButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.wmpMenu;
      if (!action) {
        return;
      }

      if (action === "file" && mediaAudio) {
        mediaAudio.pause();
        mediaAudio.currentTime = 0;
        syncPlayButton();
        updateTrackProgress();
        setWmpStatus("Stopped and rewound to start");
      }

      if (action === "view" && wmpShellEl) {
        wmpShellEl.classList.toggle("is-compact");
        setWmpStatus(wmpShellEl.classList.contains("is-compact") ? "Compact mode on" : "Compact mode off");
      }

      if (action === "play" && wmpPlayBtn) {
        wmpPlayBtn.click();
      }

      if (action === "tools") {
        isShuffleEnabled = !isShuffleEnabled;
        setWmpStatus(isShuffleEnabled ? "Shuffle: ON" : "Shuffle: OFF");
        refreshActiveWmpView();
      }

      if (action === "help") {
        setWmpViewContent(
          "<h4>Player Help</h4><p>Use Prev/Play/Next to control playback, click timeline to seek, and use View for compact mode.</p>"
        );
        setWmpStatus("Help opened");
      }
    });
  });
}

if (wmpNavButtons.length > 0) {
  wmpNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.wmpView;
      if (!view) {
        return;
      }
      activateWmpView(view);
    });
  });

  activateWmpView("now-playing");
}

if (wmpViewContentEl) {
  wmpViewContentEl.addEventListener("click", (event) => {
    const radioButton = event.target.closest("[data-radio-track]");
    if (radioButton) {
      const trackIndex = Number(radioButton.dataset.radioTrack);
      if (Number.isInteger(trackIndex)) {
        ensureAudioGraph();
        loadTrackByIndex(trackIndex);
        playCurrentTrack();
        syncPlayButton();
        setWmpStatus("Radio preset started");
      }
      return;
    }

    const skinButton = event.target.closest("[data-skin]");
    if (skinButton && wmpShellEl) {
      const skin = skinButton.dataset.skin;
      if (!skin) {
        return;
      }
      wmpShellEl.dataset.wmpSkin = skin;
      currentWmpSkinIndex = wmpSkins.indexOf(skin);
      setWmpStatus(`Skin switched: ${skin}`);
      return;
    }

    const guideButton = event.target.closest("[data-guide-action]");
    if (guideButton) {
      const mode = guideButton.dataset.guideAction;
      setWmpStatus(mode === "favorites" ? "Showing favorites" : "Showing latest added");
      return;
    }

    const libraryTrackButton = event.target.closest("[data-library-track]");
    if (libraryTrackButton) {
      const trackIndex = Number(libraryTrackButton.getAttribute("data-library-track"));
      if (Number.isInteger(trackIndex)) {
        loadTrackByIndex(trackIndex);
        playCurrentTrack();
        syncPlayButton();
        setWmpStatus("Track loaded from Media Library");
      }
      return;
    }

    const cdActionButton = event.target.closest("[data-cd-action]");
    if (cdActionButton) {
      const action = cdActionButton.getAttribute("data-cd-action");
      if (action === "play") {
        loadTrackByIndex(currentTrackIndex);
        playCurrentTrack();
        syncPlayButton();
        setWmpStatus("Disc playback started");
      }
      if (action === "stop" && mediaAudio) {
        mediaAudio.pause();
        mediaAudio.currentTime = 0;
        syncPlayButton();
        updateTrackProgress();
        setWmpStatus("Disc stopped");
      }
      if (action === "repeat") {
        isRepeatEnabled = !isRepeatEnabled;
        setWmpStatus(isRepeatEnabled ? "Repeat: ON" : "Repeat: OFF");
        refreshActiveWmpView();
      }
      return;
    }

    const eqPresetButton = event.target.closest("[data-eq-preset]");
    if (eqPresetButton) {
      const preset = eqPresetButton.getAttribute("data-eq-preset");
      if (preset) {
        setEqPreset(preset);
      }
      return;
    }

    const deviceMuteButton = event.target.closest("[data-device-mute]");
    if (deviceMuteButton && mediaAudio) {
      mediaAudio.muted = !mediaAudio.muted;
      refreshActiveWmpView();
      setWmpStatus(mediaAudio.muted ? "Muted" : "Unmuted");
    }
  });

  wmpViewContentEl.addEventListener("input", (event) => {
    const eqSlider = event.target.closest("input[data-eq-band]");
    if (!eqSlider) {
      return;
    }

    const index = Number(eqSlider.getAttribute("data-eq-band"));
    if (!Number.isInteger(index) || index < 0 || index >= eqState.length) {
      return;
    }

    ensureAudioGraph();
    eqState[index] = Number(eqSlider.value);
    applyEqState();
    setWmpStatus(`EQ ${eqBands[index].label}: ${eqState[index]} dB`);
    return;
  });

  wmpViewContentEl.addEventListener("change", (event) => {
    const librarySort = event.target.closest("[data-library-sort]");
    if (librarySort) {
      mediaLibrarySort = librarySort.value;
      refreshActiveWmpView();
      setWmpStatus(`Media Library sorted by ${mediaLibrarySort}`);
      return;
    }

    const deviceVolume = event.target.closest("[data-device-volume]");
    if (deviceVolume && mediaAudio) {
      mediaAudio.volume = Number(deviceVolume.value) / 100;
      const label = wmpViewContentEl.querySelector("[data-device-volume-label]");
      if (label) {
        label.textContent = `${deviceVolume.value}%`;
      }
      setWmpStatus(`Volume: ${deviceVolume.value}%`);
    }
  });

  wmpViewContentEl.addEventListener("keyup", (event) => {
    const librarySearch = event.target.closest("[data-library-search]");
    if (!librarySearch) {
      return;
    }

    mediaLibraryQuery = librarySearch.value;
    refreshActiveWmpView();
  });
}

if (cpuMeterBar && cpuMeterText) {
  setInterval(() => {
    const value = Math.floor(18 + Math.random() * 58);
    cpuMeterBar.style.width = `${value}%`;
    cpuMeterText.textContent = `CPU ${value}%`;
  }, 1800);
}

if (widgetNoteContentEl) {
  const saved = localStorage.getItem(noteKey);
  if (saved !== null) {
    widgetNoteContentEl.textContent = saved;
  }

  const savedColor = localStorage.getItem(noteColorKey) || "white";
  setStickyColor(savedColor);

  widgetNoteContentEl.addEventListener("input", () => {
    localStorage.setItem(noteKey, widgetNoteContentEl.textContent);
  });
}

if (stickyColorButtons.length > 0) {
  stickyColorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.stickyColor;
      if (!color) {
        return;
      }
      setStickyColor(color);
    });
  });
}

if (gadgetToggleButtons.length > 0) {
  gadgetToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.gadgetToggle;
      if (!key) {
        return;
      }
      toggleGadget(key);
    });
  });
}

if (gadgetSearchInput) {
  gadgetSearchInput.addEventListener("input", () => {
    filterGadgetTiles(gadgetSearchInput.value);
  });
}

if (photoPrevBtn) {
  photoPrevBtn.addEventListener("click", () => updatePhotoFrame(-1));
}

if (photoNextBtn) {
  photoNextBtn.addEventListener("click", () => updatePhotoFrame(1));
}

document.addEventListener("click", (event) => {
  if (!startMenu.contains(event.target) && event.target !== startBtn) {
    toggleStartMenu(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    toggleStartMenu(false);
  }
});

window.addEventListener("resize", () => {
  isMobileLayout = window.innerWidth <= 1024;
  appWindows.forEach((windowEl) => {
    if (isMobileLayout) {
      windowEl.style.left = "";
      windowEl.style.top = "";
    } else if (!windowEl.classList.contains("is-hidden")) {
      normalizeWindowPosition(windowEl);
    }
  });
});

updateClock();
updateAnalogClock();
updateWeatherWidget();
updatePhotoFrame();
syncGadgetVisibility();
cycleStatus();
installXpTooltips();
installRippleEffects();
initDesktopAeroBubbles();

// On mobile: don't auto-open forum, hide gadgets, and disable sidebar
if (isMobileLayout) {
  // Hide gadget sidebar completely on mobile
  const sidebar = document.getElementById("desktop-sidebar");
  if (sidebar) {
    sidebar.style.display = "none";
  }
} else {
  // Desktop: open forum by default
  ensureTaskButton("forum");
  focusWindow(getWindowByApp("forum"));
}

setInterval(updateClock, 1000);
setInterval(updateAnalogClock, 1000);
setInterval(updateWeatherWidget, 120000);
setInterval(cycleStatus, 2400);
