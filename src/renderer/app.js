const CHANNEL_POPULARITY_ORDER = [
  "TRT 1", "ATV", "Kanal D", "Show TV",
  "Star TV", "NOW", "TV8", "TV8,5", "A2", "teve2", "Kanal 7", "Beyaz TV",
  "360 TV", "ATV Avrupa", "Show Türk", "Show Max",
  "TV100", "TYT Türk", "TRT Haber", "NTV", "CNN Turk", "Haberturk", "A Haber", "Haber Global",
  "T24", "Turk Haber", "Sözcü TV", "TVNET", "Halk TV", "TELE 1", "Bengu Turk", "KRT TV", "TGRT Haber",
  "TRT Spor", "A Spor", "HT Spor", "Tay TV", "TJK TV",
  "TRT 2", "TRT 4K", "TRT Turk", "TRT World", "TRT Arabi", "TRT Spor Yildiz", "TRT Muzik",
  "Kral Pop TV", "Dream Turk", "Number1 Turk", "Number1 TV", "Power Turk TV", "Power TV",
  "TRT Cocuk", "TRT Diyanet Cocuk", "Minika Cocuk", "Minika GO",
  "TRT Belgesel", "DMAX", "TLC", "TGRT Belgesel", "Yaban TV", "Av TV", "FB TV", "TRT Kurdi", "TRT Avaz",
  "Diyanet TV", "TBMM TV", "Ulusal Kanal", "Ulke TV", "Kanal B", "Cem TV",
  "TRT EBA Ilkokul", "TRT EBA Ortaokul", "TRT EBA Lise",
  "Bloomberg HT", "CNBC-e", "Ekoturk", "Finans Turk",
  "Lalegul TV", "Semerkand TV", "Vav TV", "TV5",
  "Koy TV", "Ciftci TV", "Meltem TV", "Woman TV", "Fashion One TV",
  "Alanya Posta", "Aktas TV", "Anadolu Net TV", "Bursa AS TV", "Cay TV", "Deniz Postasi",
  "Erzurum Web TV", "E TV Kayseri", "E TV Manisa", "Kanal 12", "Kanal 15", "Kanal 23", "Kanal 26",
  "Kanal 3", "Kanal 32", "Kanal 33", "Kanal 58", "Kanal 7 Avrupa", "Kanal Firat", "Kent Turk",
  "Konya Olay TV", "Mavi Karadeniz", "Olay Turk", "Trabzon Buyuksehir Belediyesi TV",
  "TV 264", "TV 41", "TV 52", "Urfanatik TV",
];

const CATEGORY_ORDER = [
  "Kamu", "Ulusal", "Genel", "Haber", "Spor", "Muzik", "Cocuk", "Belgesel",
  "Ekonomi", "Dini", "Yasam", "Sinema", "Resmi", "Diger",
];

const FILTER_ALL = "Tümü";

const els = {
  channelCount: document.getElementById("channel-count"),
  searchInput: document.getElementById("search-input"),
  categoryTabs: document.getElementById("category-tabs"),
  channelList: document.getElementById("channel-list"),
  nowPlayingTitle: document.getElementById("now-playing-title"),
  nowPlayingMeta: document.getElementById("now-playing-meta"),
  sourceBadge: document.getElementById("source-badge"),
  prevChannel: document.getElementById("prev-channel"),
  nextChannel: document.getElementById("next-channel"),
  video: document.getElementById("video-player"),
  playerOverlay: document.getElementById("player-overlay"),
  playerStatus: document.getElementById("player-status"),
  streamInfo: document.getElementById("stream-info"),
  channelBanner: document.getElementById("channel-banner"),
  channelBannerName: document.getElementById("channel-banner-name"),
  channelBannerCat: document.getElementById("channel-banner-cat"),
};

let channels = [];
let streamMap = {};
let selectedFilter = FILTER_ALL;
let searchQuery = "";
let activeChannelUrl = null;
let hlsInstance = null;
let currentStreamUrls = [];
let currentStreamIndex = 0;

function normalizeChannelKey(name) {
  return name
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

function viewershipIndex(channelName) {
  const index = CHANNEL_POPULARITY_ORDER.indexOf(channelName);
  return index >= 0 ? index : 1000;
}

function isLikelyPlayableStream(url) {
  const value = url.trim().toLowerCase();
  return value.endsWith(".m3u8") || value.includes(".m3u8?") || value.includes("/hls/");
}

function parseStreamMap(raw) {
  const map = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "_revision") continue;
    const urls = Array.isArray(value) ? value : [value];
    const cleaned = [...new Set(urls.map((u) => String(u).trim()).filter(isLikelyPlayableStream))];
    if (cleaned.length > 0) {
      map[key.trim()] = cleaned;
    }
  }
  return map;
}

function sortChannels(list) {
  const categoryIndex = Object.fromEntries(CATEGORY_ORDER.map((c, i) => [c, i]));
  return [...list].sort((a, b) => {
    const pop = viewershipIndex(a.name) - viewershipIndex(b.name);
    if (pop !== 0) return pop;
    const cat = (categoryIndex[a.category] ?? Number.MAX_SAFE_INTEGER)
      - (categoryIndex[b.category] ?? Number.MAX_SAFE_INTEGER);
    if (cat !== 0) return cat;
    return a.name.localeCompare(b.name, "tr");
  });
}

function getDisplayedChannels() {
  const query = searchQuery.trim().toLowerCase();
  return sortChannels(
    channels.filter((channel) => {
      const matchesFilter = selectedFilter === FILTER_ALL || channel.category === selectedFilter;
      const matchesSearch =
        !query ||
        channel.name.toLowerCase().includes(query) ||
        channel.category.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    }),
  );
}

function findStreamUrls(channel) {
  const key = normalizeChannelKey(channel.name);
  const direct = streamMap[key];
  if (direct?.length) return direct;

  const fuzzy = Object.entries(streamMap).find(([mapKey]) => normalizeChannelKey(mapKey) === key);
  return fuzzy?.[1] ?? [];
}

function faviconUrl(channelUrl) {
  return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(channelUrl)}`;
}

function renderCategoryTabs() {
  const categories = [FILTER_ALL, ...new Set(channels.map((c) => c.category))];
  els.categoryTabs.innerHTML = "";

  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-tab${category === selectedFilter ? " active" : ""}`;
    button.textContent = category;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(category === selectedFilter));
    button.addEventListener("click", () => {
      selectedFilter = category;
      renderCategoryTabs();
      renderChannelList();
    });
    els.categoryTabs.appendChild(button);
  }
}

function renderChannelList() {
  const displayed = getDisplayedChannels();
  els.channelCount.textContent = `${displayed.length} kanal`;
  els.channelList.innerHTML = "";

  for (const channel of displayed) {
    const item = document.createElement("li");
    item.className = `channel-item${channel.url === activeChannelUrl ? " active" : ""}`;
    item.setAttribute("role", "option");
    item.tabIndex = 0;

    const logo = document.createElement("div");
    logo.className = "channel-logo";

    const letter = document.createElement("span");
    letter.className = "channel-logo-letter";
    letter.textContent = channel.name.trim().charAt(0).toUpperCase() || "?";
    logo.appendChild(letter);

    // Favicon img'i DOM'a HEMEN ekliyoruz; aksi halde loading="lazy" olan ve
    // belgeye bağlı olmayan bir img Chromium'da yüklenmeyebilir (logo kaybolur).
    // Yüklenince .has-logo ile harfi örtüyoruz, hata olursa img'i kaldırıyoruz.
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.className = "channel-logo-img";
    img.addEventListener("load", () => logo.classList.add("has-logo"));
    img.addEventListener("error", () => img.remove());
    img.src = faviconUrl(channel.url);
    logo.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "channel-meta";
    const title = document.createElement("h3");
    title.textContent = channel.name;
    const subtitle = document.createElement("p");
    subtitle.textContent = channel.category;
    meta.append(title, subtitle);

    const play = () => selectChannel(channel);
    item.addEventListener("click", play);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        play();
      }
    });

    item.append(logo, meta);
    els.channelList.appendChild(item);
  }
}

function destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
}

function setPlayerOverlay(visible, message = "") {
  els.playerOverlay.classList.toggle("hidden", !visible);
  if (message) {
    els.playerStatus.textContent = message;
  }
}

function updateNowPlaying(channel, badgeText, metaText) {
  els.nowPlayingTitle.textContent = channel.name;
  els.nowPlayingMeta.textContent = `${channel.category} · ${metaText}`;
  els.sourceBadge.textContent = badgeText;
  els.sourceBadge.classList.toggle("live", badgeText === "M3U8");
}

// Bir URL bu süre içinde gerçekten OYNAMAYA başlamazsa (ne hata ne oynatma —
// "takılı" link) otomatik olarak sıradaki yedeğe geçilir.
const STREAM_WATCHDOG_MS = 9000;
let watchdogTimer = null;
// advanceLock: aynı URL denemesi için yalnız BİR kez ilerle. hls ERROR ile
// watchdog timeout aynı anda iki kez tryNextStream çağırıp URL atlamasın diye.
// Her yeni playStreamUrl çağrısında sıfırlanır.
let advanceLock = false;

function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

// Oynatma başarıyla başladığında çağrılır: watchdog'u durdur, overlay'i gizle.
function onStreamPlaying() {
  clearWatchdog();
  setPlayerOverlay(false);
}

// Tek girişli ilerletme: kilit açıkken yok sayar, aksi halde sıradaki yedeğe.
function advanceStream() {
  if (advanceLock) return;
  advanceLock = true;
  clearWatchdog();
  tryNextStream();
}

function tryNextStream() {
  currentStreamIndex += 1;
  if (currentStreamIndex >= currentStreamUrls.length) {
    clearWatchdog();
    destroyHls();
    setPlayerOverlay(true, "Bu kanal şu an açılamadı. Tüm yedek bağlantılar denendi.");
    els.sourceBadge.textContent = "Hata";
    els.sourceBadge.classList.remove("live");
    return;
  }
  setPlayerOverlay(true, `Yedek bağlantı deneniyor (${currentStreamIndex + 1}/${currentStreamUrls.length})…`);
  playStreamUrl(currentStreamUrls[currentStreamIndex]);
}

function playStreamUrl(url) {
  clearWatchdog();
  advanceLock = false;
  destroyHls();
  setPlayerOverlay(true, "Yayın başlatılıyor…");
  watchdogTimer = setTimeout(advanceStream, STREAM_WATCHDOG_MS);

  if (window.Hls && window.Hls.isSupported()) {
    hlsInstance = new window.Hls({
      enableWorker: true,
      lowLatencyMode: true,
    });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(els.video);
    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
      els.video.play().catch(() => {
        // Otomatik oynatma engellenmiş olabilir; watchdog devam etsin, gerçekten
        // takılırsa sıradakine geçer. Oynama başlarsa onStreamPlaying temizler.
        setPlayerOverlay(true, "Oynatma engellendi. Videoya tıklayıp tekrar deneyin.");
      });
    });
    hlsInstance.on(window.Hls.Events.ERROR, (_event, data) => {
      // Fatal hatalar (network/media/mux) → hemen sıradaki yedeğe.
      if (data && data.fatal) {
        advanceStream();
      }
    });
    return;
  }

  if (els.video.canPlayType("application/vnd.apple.mpegurl")) {
    els.video.src = url;
    els.video.addEventListener(
      "loadedmetadata",
      () => {
        els.video.play().catch(() => {
          setPlayerOverlay(true, "Oynatma engellendi. Videoya tıklayıp tekrar deneyin.");
        });
      },
      { once: true },
    );
    els.video.addEventListener(
      "error",
      () => advanceStream(),
      { once: true },
    );
    return;
  }

  clearWatchdog();
  setPlayerOverlay(true, "Bu cihazda HLS desteği bulunamadı.");
}

// Gerçek oynatma başlayınca watchdog'u durdurup overlay'i gizle. Tek global
// dinleyici (aynı referans tekrar eklense de dedupe edilir, sızıntı olmaz).
els.video.addEventListener("playing", onStreamPlaying);

let bannerHideTimer = null;

// TV'lerdeki gibi: kanal değişince video üzerinde kısa süre ad/kategori bandı.
// Header sinema modunda gizli olduğundan kanal adı yalnızca buradan görünür.
function showChannelBanner(channel) {
  const frame = videoFrame();
  if (!frame || !els.channelBanner) return;
  els.channelBannerName.textContent = channel.name;
  els.channelBannerCat.textContent = channel.category;
  frame.classList.add("show-banner");
  if (bannerHideTimer) clearTimeout(bannerHideTimer);
  bannerHideTimer = setTimeout(() => {
    frame.classList.remove("show-banner");
  }, 3500);
}

function selectChannel(channel) {
  activeChannelUrl = channel.url;
  renderChannelList();
  showChannelBanner(channel);

  const streamUrls = findStreamUrls(channel);
  currentStreamUrls = streamUrls;
  currentStreamIndex = 0;

  clearWatchdog();
  destroyHls();
  els.video.removeAttribute("src");
  els.video.load();

  if (streamUrls.length > 0) {
    updateNowPlaying(channel, "M3U8", "Canlı yayın");
    playStreamUrl(streamUrls[0]);
    return;
  }

  updateNowPlaying(channel, "WEB", "M3U8 bulunamadı — web sayfası yedek");
  setPlayerOverlay(
    true,
    "Bu kanal için M3U8 akışı yok. Android sürümündeki WebView yedek oynatıcı henüz Windows MVP'de yok.",
  );
}

async function bootstrap() {
  try {
    const [channelData, streamMapData] = await Promise.all([
      window.canliTv.loadChannels(),
      window.canliTv.loadStreamMap(),
    ]);

    channels = Array.isArray(channelData)
      ? channelData.filter((c) => c.name && c.url && c.category)
      : [];
    streamMap = parseStreamMap(streamMapData ?? {});

    renderCategoryTabs();
    renderChannelList();

    if (channels.length > 0) {
      selectChannel(getDisplayedChannels()[0]);
    }
  } catch (error) {
    els.channelCount.textContent = "Veri yüklenemedi";
    setPlayerOverlay(true, `Kanal verisi okunamadı: ${error.message}`);
  }
}

els.searchInput.addEventListener("input", (event) => {
  searchQuery = event.target.value;
  renderChannelList();
});

els.prevChannel.addEventListener("click", () => zapChannel(-1));
els.nextChannel.addEventListener("click", () => zapChannel(1));

// Pencere fullscreen durumu main'den geldiğinde body sınıfını senkronla.
// OS kısayoluyla (örn. F11) girilip çıkılsa bile doğru kalır.
if (window.canliTv && typeof window.canliTv.onFullscreenChanged === "function") {
  window.canliTv.onFullscreenChanged((isFs) => {
    document.body.classList.toggle("app-fullscreen", Boolean(isFs));
  });
}

// Videoya çift tıklama native element-fullscreen'e sokuyordu; o modda banner ve
// kontroller (videonun kardeşleri) görünmez. Bunu engelleyip kendi pencere-
// fullscreen sinema modumuza yönlendiriyoruz.
els.video.addEventListener("dblclick", (event) => {
  event.preventDefault();
  toggleFullscreen();
});

// Güvence: video herhangi bir yolla kendi element-fullscreen'ine girerse,
// çık ve bizim pencere-fullscreen moduna geç. document.exitFullscreen sonrası
// fullscreenElement null olur; window toggle IPC tabanlı olduğundan döngü olmaz.
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement === els.video) {
    document.exitFullscreen().catch(() => {});
    if (!isFullscreen()) {
      toggleFullscreen();
    }
  }
});

function getChannelItems() {
  return Array.from(els.channelList.querySelectorAll(".channel-item"));
}

function focusItemAt(index) {
  const items = getChannelItems();
  if (items.length === 0) return;
  const clamped = Math.max(0, Math.min(index, items.length - 1));
  const target = items[clamped];
  target.focus();
  target.scrollIntoView({ block: "nearest" });
}

function focusedItemIndex() {
  const items = getChannelItems();
  return items.indexOf(document.activeElement);
}

function zapChannel(delta) {
  const displayed = getDisplayedChannels();
  if (displayed.length === 0) return;
  const current = displayed.findIndex((c) => c.url === activeChannelUrl);
  const nextIndex = current === -1 ? 0 : (current + delta + displayed.length) % displayed.length;
  selectChannel(displayed[nextIndex]);
}

function videoFrame() {
  return els.video.closest(".video-frame");
}

function isFullscreen() {
  return document.body.classList.contains("app-fullscreen");
}

// Element-fullscreen (requestFullscreen) GPU compositing kapalıyken overlay'i
// boyamadığı için tamamen terk edildi. Bunun yerine OS-düzeyi pencere
// fullscreen + CSS "sinema modu" kullanıyoruz; kontroller normal DOM'da kalır.
function toggleFullscreen() {
  if (window.canliTv && typeof window.canliTv.toggleFullscreen === "function") {
    window.canliTv.toggleFullscreen();
  }
}

document.addEventListener("keydown", (event) => {
  const inSearch = document.activeElement === els.searchInput;
  const inFullscreen = isFullscreen();

  if ((event.key === "f" || event.key === "F") && !inSearch) {
    event.preventDefault();
    toggleFullscreen();
    return;
  }

  if (event.key === "Escape") {
    if (inFullscreen) {
      toggleFullscreen();
    } else {
      focusItemAt(0);
    }
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const delta = event.key === "ArrowDown" ? 1 : -1;

    if (inFullscreen) {
      event.preventDefault();
      zapChannel(delta);
      return;
    }

    if (inSearch) {
      if (delta === 1) {
        event.preventDefault();
        focusItemAt(0);
      }
      return;
    }

    const index = focusedItemIndex();
    if (index === -1) {
      event.preventDefault();
      focusItemAt(delta === 1 ? 0 : getChannelItems().length - 1);
      return;
    }

    event.preventDefault();
    focusItemAt(index + delta);
    return;
  }

  if (event.key === "Backspace" && !inSearch) {
    event.preventDefault();
    focusItemAt(focusedItemIndex() === -1 ? 0 : focusedItemIndex());
  }
});

bootstrap();
