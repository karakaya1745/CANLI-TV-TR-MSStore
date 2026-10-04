const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  parseLeadingRevision,
  planCatalogRefresh,
  resolveCatalogFile,
  syncCatalog,
} = require("../src/main/catalog-sync");

function writeJson(dir, name, value) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
}

function streamMap(revision, extra = { trt1: ["https://example.com/trt1.m3u8"] }) {
  return { _revision: revision, ...extra };
}

function channels() {
  return [{ name: "TRT 1", url: "https://example.com/trt1", category: "Kamu" }];
}

function mockFetch(files) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const name = new URL(url).pathname.split("/").pop();
    const headers = options.headers || {};
    const range = headers.Range || headers.range || "";
    calls.push({ name, range });
    const file = files[name];
    if (!file) return new Response("missing", { status: 404 });
    if (file.status) return new Response(file.body || "no", { status: file.status });
    const body = typeof file === "string" ? file : JSON.stringify(file.body);
    if (range.startsWith("bytes=") && file.honorRange !== false) {
      const end = Number(range.slice("bytes=".length).split("-")[1]);
      const slice = body.slice(0, Number.isFinite(end) ? end + 1 : 64);
      return new Response(slice, {
        status: 206,
        headers: { "content-range": `bytes 0-${slice.length - 1}/${body.length}` },
      });
    }
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
  impl.calls = calls;
  return impl;
}

test("parseLeadingRevision reads the stream_map header", () => {
  assert.equal(parseLeadingRevision('{\n  "_revision": 192,\n  "trt1": []'), 192);
  assert.equal(parseLeadingRevision("{}"), 0);
});

test("planCatalogRefresh keeps the metadata fast path and probes otherwise", () => {
  assert.deepEqual(planCatalogRefresh({ localRevision: 10, metadataRevision: 12 }), {
    refresh: true,
    reason: "metadata",
    probeStreamMap: false,
  });
  assert.deepEqual(planCatalogRefresh({ localRevision: 12, metadataRevision: 12 }), {
    refresh: false,
    reason: "probe",
    probeStreamMap: true,
  });
  assert.deepEqual(
    planCatalogRefresh({ localRevision: 12, metadataRevision: 9, streamMapRevision: 15 }),
    { refresh: true, reason: "stream-map-revision", probeStreamMap: false },
  );
  assert.deepEqual(
    planCatalogRefresh({ localRevision: 20, metadataRevision: 12, streamMapRevision: 18 }),
    { refresh: false, reason: "unchanged", probeStreamMap: false },
  );
});

test("happy path downloads when metadata.revision is newer and does not range-probe", async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-bundled-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-cache-"));
  writeJson(bundledDir, "stream_map.json", streamMap(39));
  writeJson(bundledDir, "channels.json", channels());
  const bundledBefore = fs.readFileSync(path.join(bundledDir, "stream_map.json"));
  const fetchImpl = mockFetch({
    "metadata.json": { body: { revision: 40, files: {} } },
    "stream_map.json": { body: streamMap(40, { trt1: ["https://example.com/new.m3u8"] }) },
    "channels.json": { body: channels() },
  });

  const result = await syncCatalog({ bundledDir, cacheDir, fetchImpl });

  assert.deepEqual(result, { updated: true, revision: 40, reason: "metadata" });
  assert.deepEqual(fetchImpl.calls.map((call) => call.name), [
    "metadata.json",
    "stream_map.json",
    "channels.json",
  ]);
  assert.equal(fetchImpl.calls.some((call) => call.range), false);
  const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, "stream_map.json"), "utf8"));
  assert.equal(cached._revision, 40);
  assert.deepEqual(fs.readFileSync(path.join(bundledDir, "stream_map.json")), bundledBefore);
});

test("equal metadata still applies a newer stream_map._revision", async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-bundled-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-cache-"));
  writeJson(bundledDir, "stream_map.json", streamMap(40));
  writeJson(bundledDir, "channels.json", channels());
  const fetchImpl = mockFetch({
    "metadata.json": { body: { revision: 40 } },
    "stream_map.json": { body: streamMap(41, { trt1: ["https://example.com/lag.m3u8"] }) },
    "channels.json": { body: [{ name: "NOW", url: "https://example.com/now", category: "Ulusal" }] },
  });

  const result = await syncCatalog({ bundledDir, cacheDir, fetchImpl });

  assert.deepEqual(result, { updated: true, revision: 41, reason: "stream-map-revision" });
  assert.equal(fetchImpl.calls[1].name, "stream_map.json");
  assert.match(fetchImpl.calls[1].range, /^bytes=0-/);
  assert.equal(fetchImpl.calls[2].range, "");
  const cachedChannels = JSON.parse(fs.readFileSync(path.join(cacheDir, "channels.json"), "utf8"));
  assert.equal(cachedChannels[0].name, "NOW");
});

test("stale metadata does not downgrade and does not full-download when stream_map is older", async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-bundled-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-cache-"));
  writeJson(bundledDir, "stream_map.json", streamMap(20));
  const fetchImpl = mockFetch({
    "metadata.json": { body: { revision: 8 } },
    "stream_map.json": { body: streamMap(18) },
    "channels.json": { body: channels() },
  });

  const result = await syncCatalog({ bundledDir, cacheDir, fetchImpl });

  assert.equal(result.updated, false);
  assert.equal(result.reason, "unchanged");
  assert.deepEqual(fetchImpl.calls.map((call) => `${call.name}:${call.range ? "range" : "full"}`), [
    "metadata.json:full",
    "stream_map.json:range",
  ]);
  assert.equal(fs.existsSync(path.join(cacheDir, "stream_map.json")), false);
});

test("metadata ahead of a not-newer stream_map does not replace the catalog", async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-bundled-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-cache-"));
  writeJson(bundledDir, "stream_map.json", streamMap(40));
  const fetchImpl = mockFetch({
    "metadata.json": { body: { revision: 50 } },
    "stream_map.json": { body: streamMap(40) },
    "channels.json": { body: channels() },
  });

  const result = await syncCatalog({ bundledDir, cacheDir, fetchImpl });

  assert.deepEqual(result, { updated: false, revision: 40, reason: "not-newer" });
  assert.equal(fs.existsSync(path.join(cacheDir, "stream_map.json")), false);
});

test("a full 200 response to the range probe is reused", async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-bundled-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-cache-"));
  writeJson(bundledDir, "stream_map.json", streamMap(5));
  const fetchImpl = mockFetch({
    "metadata.json": { body: { revision: 5 } },
    "stream_map.json": { body: streamMap(6), honorRange: false },
    "channels.json": { body: channels() },
  });

  const result = await syncCatalog({ bundledDir, cacheDir, fetchImpl });

  assert.equal(result.updated, true);
  assert.equal(result.revision, 6);
  const streamMapCalls = fetchImpl.calls.filter((call) => call.name === "stream_map.json");
  assert.equal(streamMapCalls.length, 1);
});

test("failed channels download does not leave a newer stream_map behind", async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-bundled-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-cache-"));
  writeJson(bundledDir, "stream_map.json", streamMap(5));
  const fetchImpl = mockFetch({
    "metadata.json": { body: { revision: 6 } },
    "stream_map.json": { body: streamMap(6) },
    "channels.json": { status: 500 },
  });

  const result = await syncCatalog({ bundledDir, cacheDir, fetchImpl });

  assert.equal(result.updated, false);
  assert.equal(result.reason, "error");
  assert.equal(fs.existsSync(path.join(cacheDir, "stream_map.json")), false);
  assert.equal(fs.existsSync(path.join(cacheDir, "channels.json")), false);
});

test("resolveCatalogFile prefers a newer cache and falls back to bundled files", () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-bundled-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ota-cache-"));
  writeJson(bundledDir, "stream_map.json", streamMap(5));
  writeJson(bundledDir, "channels.json", channels());
  writeJson(cacheDir, "stream_map.json", streamMap(4));
  writeJson(cacheDir, "channels.json", [{ name: "old" }]);

  assert.equal(
    resolveCatalogFile("stream_map.json", { bundledDir, cacheDir }),
    path.join(bundledDir, "stream_map.json"),
  );

  writeJson(cacheDir, "stream_map.json", streamMap(6));
  assert.equal(
    resolveCatalogFile("channels.json", { bundledDir, cacheDir }),
    path.join(cacheDir, "channels.json"),
  );
  assert.equal(
    resolveCatalogFile("stream_map.json", { bundledDir, cacheDir }),
    path.join(cacheDir, "stream_map.json"),
  );
});
