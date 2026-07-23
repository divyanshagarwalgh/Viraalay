'use strict';

const { config } = require('../config');
const { fetchJson, httpError, sleep } = require('./util');

/**
 * Thin Webflow Data API v2 client.
 *
 * Rate limit is 60 requests/minute per token, so every write path here batches
 * where the API allows it and the sync job paces itself.
 */

function headers(extra = {}) {
  config.assertWebflow();
  return {
    Authorization: `Bearer ${config.webflow.token}`,
    accept: 'application/json',
    ...extra,
  };
}

async function api(pathname, { method = 'GET', query, body, label } = {}) {
  const url = new URL(config.webflow.base + pathname);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return fetchJson(
    url.toString(),
    {
      method,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { label: label || `Webflow ${method} ${pathname}` }
  );
}

/** Page through every item in a collection. */
async function listAllItems(collectionId, { pageSize = 100, pauseMs = 150 } = {}) {
  const items = [];
  let offset = 0;
  for (;;) {
    const page = await api(`/collections/${collectionId}/items`, {
      query: { limit: pageSize, offset },
      label: 'Webflow list items',
    });
    const batch = page.items || [];
    items.push(...batch);
    const total = page.pagination?.total ?? items.length;
    offset += batch.length;
    if (!batch.length || offset >= total) break;
    if (pauseMs) await sleep(pauseMs);
  }
  return items;
}

async function createItem(collectionId, fieldData, { isDraft = true, isArchived = false } = {}) {
  return api(`/collections/${collectionId}/items`, {
    method: 'POST',
    body: { isArchived, isDraft, fieldData },
    label: 'Webflow create item',
  });
}

async function updateItem(collectionId, itemId, fieldData, opts = {}) {
  const body = { fieldData };
  if (opts.isDraft !== undefined) body.isDraft = opts.isDraft;
  if (opts.isArchived !== undefined) body.isArchived = opts.isArchived;
  return api(`/collections/${collectionId}/items/${itemId}`, {
    method: 'PATCH',
    body,
    label: 'Webflow update item',
  });
}

async function publishItems(collectionId, itemIds) {
  if (!itemIds.length) return null;
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += 100) chunks.push(itemIds.slice(i, i + 100));
  const results = [];
  for (const chunk of chunks) {
    results.push(
      await api(`/collections/${collectionId}/items/publish`, {
        method: 'POST',
        body: { itemIds: chunk },
        label: 'Webflow publish items',
      })
    );
    await sleep(200);
  }
  return results;
}

async function publishSite({ toWebflowSubdomain = true, customDomains = [] } = {}) {
  return api(`/sites/${config.webflow.siteId}/publish`, {
    method: 'POST',
    body: { publishToWebflowSubdomain: toWebflowSubdomain, customDomains },
    label: 'Webflow publish site',
  });
}

/**
 * Build a lookup of one field's value -> item, for join keys such as
 * `guesty-listing-id`. Cached briefly because the sync job hits it per listing.
 */
const indexCache = new Map();

async function indexBy(collectionId, fieldSlug, { ttlMs = 60_000 } = {}) {
  const key = `${collectionId}:${fieldSlug}`;
  const hit = indexCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.map;

  const items = await listAllItems(collectionId);
  const map = new Map();
  for (const item of items) {
    const value = item.fieldData?.[fieldSlug];
    if (value) map.set(String(value), item);
  }
  indexCache.set(key, { at: Date.now(), map });
  return map;
}

function invalidateIndex(collectionId, fieldSlug) {
  if (fieldSlug) indexCache.delete(`${collectionId}:${fieldSlug}`);
  else for (const k of indexCache.keys()) if (k.startsWith(`${collectionId}:`)) indexCache.delete(k);
}

/** Create if the join key is new, patch if it already exists. */
async function upsertByField(collectionId, fieldSlug, value, fieldData, opts = {}) {
  const map = await indexBy(collectionId, fieldSlug);
  const existing = map.get(String(value));
  if (existing) {
    const updated = await updateItem(collectionId, existing.id, fieldData, opts);
    map.set(String(value), { ...existing, fieldData: { ...existing.fieldData, ...fieldData } });
    return { action: 'updated', item: updated, id: existing.id };
  }
  const created = await createItem(collectionId, fieldData, opts);
  map.set(String(value), created);
  return { action: 'created', item: created, id: created.id };
}

/**
 * Delete one item. Webflow keeps staged and live copies separately, so a
 * published item is removed from live first — otherwise it lingers on the
 * published site until the next full publish.
 */
async function deleteItem(collectionId, itemId, { wasPublished = true } = {}) {
  if (wasPublished) {
    try {
      await api(`/collections/${collectionId}/items/${itemId}/live`, {
        method: 'DELETE',
        label: 'Webflow delete live item',
      });
    } catch (err) {
      // 404 simply means it was never published.
      if (err.status !== 404) throw err;
    }
  }
  return api(`/collections/${collectionId}/items/${itemId}`, {
    method: 'DELETE',
    label: 'Webflow delete item',
  });
}

async function getItem(collectionId, itemId) {
  return api(`/collections/${collectionId}/items/${itemId}`, { label: 'Webflow get item' });
}

module.exports = {
  api,
  listAllItems,
  createItem,
  updateItem,
  publishItems,
  publishSite,
  indexBy,
  invalidateIndex,
  upsertByField,
  deleteItem,
  getItem,
  httpError,
};
