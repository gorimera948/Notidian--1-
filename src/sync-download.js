import { validateSnapshot } from './sync-snapshot.js';

// Dropbox documents GET + If-None-Match for content-download endpoints:
// https://docs.dropboxapi.com/dropbox-api/docs/technical-reference/request-response-formats
export function createSyncDownloadTransport(path, fetchImpl = globalThis.fetch) {
  let cache = null, responseETag = '';
  return {
    fetch: async (url, options = {}) => {
      const headers = new Headers(options.headers);
      let syncDownload = false;
      if (String(url) === 'https://content.dropboxapi.com/2/files/download') {
        try { syncDownload = JSON.parse(headers.get('Dropbox-API-Arg')).path === path; } catch {}
      }
      if (!syncDownload) return fetchImpl(url, options);
      if (cache?.etag) headers.set('If-None-Match', cache.etag);
      const response = await fetchImpl(url, { ...options, method: 'GET', body: undefined, headers });
      responseETag = response.headers.get('etag') || '';
      return response;
    },
    async read(client) {
      let response;
      try { response = await client.filesDownload({ path }); }
      catch (err) {
        if (err.status === 304 && cache) return structuredClone(cache.entry);
        throw err;
      }
      const result = response.result || response;
      const blob = result.fileBlob || new Blob([result.fileBinary]);
      const snapshot = validateSnapshot(JSON.parse(await blob.text()));
      if (!result.rev) throw new Error('Dropbox sync revision is missing.');
      const entry = { snapshot, rev: result.rev };
      cache = { etag: responseETag, entry: structuredClone(entry) };
      return entry;
    },
    clear() { cache = null; responseETag = ''; }
  };
}
