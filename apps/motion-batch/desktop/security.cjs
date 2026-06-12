const SAFE_EXTERNAL_HTTPS_HOSTS = new Set([
  "fadrecords.com",
  "www.fadrecords.com"
]);

function isSafeExternalUrl(url, { trustedOrigin } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    return false;
  }

  if (parsed.protocol === "https:") return SAFE_EXTERNAL_HTTPS_HOSTS.has(parsed.hostname.toLowerCase());
  return isSafeLocalAssetUrl(parsed, { trustedOrigin });
}

function buildTrustedLocalAssetUrl(assetId, { trustedOrigin } = {}) {
  const id = String(assetId ?? "").trim();
  if (!isSafeAssetId(id)) return null;
  let url;
  try {
    url = new URL("/api/asset", String(trustedOrigin ?? ""));
  } catch {
    return null;
  }
  url.searchParams.set("id", id);
  return isSafeExternalUrl(url.href, { trustedOrigin }) ? url.href : null;
}

function isSafeLocalAssetUrl(parsed, { trustedOrigin } = {}) {
  if (!isTrustedRendererUrl(parsed.href, { trustedOrigin })) return false;
  if (parsed.pathname !== "/api/asset") return false;
  if (parsed.searchParams.has("path")) return false;
  return isSafeAssetId(parsed.searchParams.get("id"));
}

function isSafeAssetId(assetId) {
  const id = String(assetId ?? "").trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function isTrustedRendererUrl(url, { trustedOrigin } = {}) {
  try {
    const parsed = new URL(String(url ?? ""));
    const trusted = new URL(String(trustedOrigin ?? ""));
    return parsed.origin === trusted.origin;
  } catch {
    return false;
  }
}

module.exports = {
  buildTrustedLocalAssetUrl,
  isSafeExternalUrl,
  isTrustedRendererUrl
};
