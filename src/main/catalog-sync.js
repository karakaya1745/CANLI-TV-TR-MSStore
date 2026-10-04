const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/** GitHub Pages catalog used by the MS Store build. */
const DEFAULT_CATALOG_BASE = "https://karakaya1745.github.io/";

const STREAM_MAP_FILE = "stream_map.json";
const CHANNELS_FILE = "channels.json";
const METADATA_FILE = "metadata.json";
const FETCH_TIMEOUT_MS = 12000;
const REVISION_PREFIX_BYTES = 1023;

function parseLeadingRevision(text) {
  const match = String(text).match(/"_revision"\s*:\s*"?(\d+)"?/);
  return match ? Number(match[1]) : 0;
}

function readRevisionFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const revision = Number(parsed && parsed._revision);
    return revision > 0 ? revision : parseLeadingRevision(raw);
  } catch {
    return 0;
  }
}

function localCatalogRevision(bundledDir, cacheDir) {
  return Math.max(
    readRevisionFile(path.join(cacheDir, STREAM_MAP_FILE)),
    readRevisionFile(path.join(bundledDir, STREAM_MAP_FILE)),
  );
}

/**
 * Cache wins only when its stream_map is strictly newer than the bundled one,
 * so an app update can replace an older overlay and a failed OTA cannot blank the list.
 */
function resolveCatalogFile(fileName, { bundledDir, cacheDir }) {
  const bundled = path.join(bundledDir, fileName);
  const cached = path.join(cacheDir, fileName);
  if (fileName !== STREAM_MAP_FILE && fileName !== CHANNELS_FILE) return bundled;
  if (!fs.existsSync(cached)) return bundled;
  const cacheRev = readRevisionFile(path.join(cacheDir, STREAM_MAP_FILE));
  const bundledRev = readRevisionFile(path.join(bundledDir, STREAM_MAP_FILE));
  return cacheRev > bundledRev ? cached : bundled;
}

/**
 * metadata.revision ahead of the local cache → download (happy path).
 * Otherwise the caller must probe stream_map._revision. A probe that is not
 * strictly newer leaves the local catalog in place (no downgrade).
 */
function planCatalogRefresh({ localRevision, metadataRevision, streamMapRevision }) {
  const local = Number(localRevision) || 0;
  const meta = Number(metadataRevision) || 0;
  if (meta > local) {
    return { refresh: true, reason: "metadata", probeStreamMap: false };
  }
  if (streamMapRevision == null) {
    return { refresh: false, reason: "probe", probeStreamMap: true };
  }
  const mapRev = Number(streamMapRevision) || 0;
  if (mapRev > local) {
    return { refresh: true, reason: "stream-map-revision", probeStreamMap: false };
  }
  return { refresh: false, reason: "unchanged", probeStreamMap: false };
}

function catalogFileUrl(baseUrl, fileName) {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(fileName, root);
  url.searchParams.set("t", Date.now().toString());
  return url.href;
}

function parseJsonBuffer(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

async function fetchBuffer(fetchImpl, url, options = {}, allowStatuses = []) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ...options,
    headers: {
      "Accept-Encoding": "identity",
      ...(options.headers || {}),
    },
  });
  const status = response.status;
  if (!response.ok && status !== 206 && !allowStatuses.includes(status)) {
    throw new Error(`HTTP ${status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status, buffer };
}

/**
 * Read remote stream_map._revision without requiring a full download.
 * Pages honors Range (206). A 200/416 or a prefix with no revision falls back
 * to a normal GET; a full body is reused so the file is not downloaded twice.
 */
async function probeStreamMapRevision(fetchImpl, baseUrl) {
  const ranged = await fetchBuffer(
    fetchImpl,
    catalogFileUrl(baseUrl, STREAM_MAP_FILE),
    { headers: { Range: `bytes=0-${REVISION_PREFIX_BYTES}` } },
    [416],
  );
  const prefixRevision = parseLeadingRevision(ranged.buffer.toString("utf8"));
  const needsFull = ranged.status === 416 || (ranged.status === 206 && !prefixRevision) || !prefixRevision;
  if (needsFull && ranged.status !== 200) {
    const full = await fetchBuffer(fetchImpl, catalogFileUrl(baseUrl, STREAM_MAP_FILE));
    return {
      revision: parseLeadingRevision(full.buffer.toString("utf8")),
      buffer: full.buffer,
    };
  }
  if (ranged.status === 206) {
    return { revision: prefixRevision, buffer: null };
  }
  return { revision: prefixRevision, buffer: ranged.buffer };
}

function atomicWriteFile(filePath, buffer) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, buffer);
  // Windows rename does not replace an existing file. Remove first so a crash
  // drops back to the bundled catalog instead of leaving a half-written JSON.
  fs.rmSync(filePath, { force: true });
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function assertStreamMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stream_map.json is not an object");
  }
  const revision = Number(value._revision) || 0;
  if (!revision) throw new Error("stream_map.json missing _revision");
  const keys = Object.keys(value).filter((key) => key !== "_revision");
  if (keys.length === 0) throw new Error("stream_map.json has no channels");
  return revision;
}

function assertChannels(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("channels.json is empty or invalid");
  }
}

async function downloadCatalog(fetchImpl, baseUrl, prefetchedStreamMap) {
  const streamMap = prefetchedStreamMap
    ? { buffer: prefetchedStreamMap }
    : await fetchBuffer(fetchImpl, catalogFileUrl(baseUrl, STREAM_MAP_FILE));
  const channels = await fetchBuffer(fetchImpl, catalogFileUrl(baseUrl, CHANNELS_FILE));
  return { streamMap: streamMap.buffer, channels: channels.buffer };
}

async function syncCatalog(options) {
  const {
    baseUrl = DEFAULT_CATALOG_BASE,
    bundledDir,
    cacheDir,
    fetchImpl = globalThis.fetch,
    log = () => {},
  } = options;

  const localRevision = localCatalogRevision(bundledDir, cacheDir);
  try {
    let metadataRevision = 0;
    try {
      const metadataBuf = await fetchBuffer(fetchImpl, catalogFileUrl(baseUrl, METADATA_FILE));
      const metadata = parseJsonBuffer(metadataBuf.buffer);
      metadataRevision = Number(metadata && metadata.revision) || 0;
    } catch (error) {
      log(`[ota] metadata okunamadı (${error.message}); stream_map._revision kontrol edilecek`);
    }

    let plan = planCatalogRefresh({
      localRevision,
      metadataRevision,
      streamMapRevision: undefined,
    });
    let prefetchedStreamMap = null;
    if (plan.probeStreamMap) {
      const probe = await probeStreamMapRevision(fetchImpl, baseUrl);
      plan = planCatalogRefresh({
        localRevision,
        metadataRevision,
        streamMapRevision: probe.revision,
      });
      prefetchedStreamMap = probe.buffer;
      log(`[ota] metadata rev=${metadataRevision} local=${localRevision} stream_map._revision=${probe.revision}`);
    } else {
      log(`[ota] metadata rev=${metadataRevision} local=${localRevision}`);
    }

    if (!plan.refresh) {
      return { updated: false, revision: localRevision, reason: plan.reason };
    }

    const downloaded = await downloadCatalog(fetchImpl, baseUrl, prefetchedStreamMap);
    const streamMap = parseJsonBuffer(downloaded.streamMap);
    const remoteRevision = assertStreamMap(streamMap);
    if (remoteRevision <= localRevision) {
      log(`[ota] uzak stream_map rev=${remoteRevision} yerel=${localRevision}; güncelleme yok`);
      return { updated: false, revision: localRevision, reason: "not-newer" };
    }
    const channels = parseJsonBuffer(downloaded.channels);
    assertChannels(channels);

    // channels first: if we crash before stream_map lands, the next launch
    // still sees the old revision and retries both files.
    atomicWriteFile(path.join(cacheDir, CHANNELS_FILE), downloaded.channels);
    atomicWriteFile(path.join(cacheDir, STREAM_MAP_FILE), downloaded.streamMap);
    log(`[ota] katalog güncellendi rev=${remoteRevision} (${plan.reason})`);
    return { updated: true, revision: remoteRevision, reason: plan.reason };
  } catch (error) {
    log(`[ota] katalog senkronu başarısız: ${error.message}`);
    return { updated: false, revision: localRevision, reason: "error", error: error.message };
  }
}

module.exports = {
  DEFAULT_CATALOG_BASE,
  parseLeadingRevision,
  planCatalogRefresh,
  resolveCatalogFile,
  syncCatalog,
};
