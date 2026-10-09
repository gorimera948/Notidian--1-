import { Dropbox, DropboxAuth } from 'dropbox';
import {
  applyNotidianSnapshot,
  createNotidianSnapshot,
  getLocalSyncMeta,
  setLocalSyncMeta
} from './state.js';
import { showToast } from './utils.js';

const APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY || '';
const SYNC_PATH = '/notidian-sync.json';
const REFRESH_TOKEN_KEY = 'notidian_dropbox_refresh_token';
const ACCESS_TOKEN_KEY = 'notidian_dropbox_access_token';
const ACCESS_EXPIRES_KEY = 'notidian_dropbox_access_expires_at';
const REMOTE_REV_KEY = 'notidian_dropbox_remote_rev';
const PKCE_VERIFIER_KEY = 'notidian_dropbox_pkce_verifier';
const OAUTH_STATE_KEY = 'notidian_dropbox_oauth_state';
const DEBOUNCE_MS = 3500;
const SCOPES = ['files.content.read', 'files.content.write'];
const IMAGE_DIR = '/images';
const IMAGE_LINK_TTL_MS = 3 * 60 * 60 * 1000;

const syncState = {
  status: APP_KEY ? 'disconnected' : 'unconfigured',
  message: APP_KEY ? 'Dropbox disconnected' : 'Dropbox App Key is missing',
  connected: false,
  lastSyncedAt: 0
};

let auth = null;
let client = null;
let debounceTimer = null;
let initialized = false;
let applyingRemote = false;
let syncInFlight = null;
let remoteRev = localStorage.getItem(REMOTE_REV_KEY) || '';
const imageLinkCache = new Map();

function getRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function normalizeOAuthUrl(authUrl) {
  const rawUrl = new URL(authUrl);
  const safeUrl = new URL(`${rawUrl.origin}${rawUrl.pathname}`);
  rawUrl.searchParams.forEach((value, key) => {
    safeUrl.searchParams.set(key, value);
  });
  return safeUrl.toString();
}

function getDropboxSetupInfo() {
  return {
    appKey: APP_KEY,
    redirectUri: getRedirectUri(),
    syncPath: SYNC_PATH
  };
}

function unwrap(response) {
  return response && response.result ? response.result : response;
}

function getErrorText(err) {
  if (!err) return '';
  try {
    return JSON.stringify(err);
  } catch (e) {
    return String(err.message || err);
  }
}

function isDropboxNotFound(err) {
  return err && err.status === 409 && getErrorText(err).includes('not_found');
}

function isDropboxConflict(err) {
  return err && err.status === 409 && !isDropboxNotFound(err);
}

function hasDropboxRefreshToken() {
  return Boolean(localStorage.getItem(REFRESH_TOKEN_KEY));
}

function ensureDropboxImageClient() {
  if (!APP_KEY) {
    throw new Error('Dropbox App Key is missing.');
  }
  if (!client) {
    createAuth();
  }
  if (!hasDropboxRefreshToken()) {
    throw new Error('Dropbox is not connected.');
  }
  return client;
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function getDropboxDateFolder(date = new Date()) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate())
  ].join('-');
}

function sanitizeDropboxFileName(fileName) {
  const fallback = `image-${Date.now()}`;
  const cleanName = String(fileName || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanName || fallback;
}

function createDropboxImagePath(file) {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const fileName = sanitizeDropboxFileName(file && file.name);
  return `${IMAGE_DIR}/${getDropboxDateFolder()}/${Date.now()}-${randomPart}-${fileName}`;
}

function getSnapshotUpdatedAt(snapshot) {
  return Number(snapshot && snapshot.syncMeta && snapshot.syncMeta.updatedAt) || 0;
}

function estimateSnapshotUpdatedAt(snapshot) {
  const data = snapshot && snapshot.data ? snapshot.data : {};
  const times = [];
  (data.notes || []).forEach(note => times.push(Number(note.updatedAt) || 0, Number(note.sortIndex) || 0));
  (data.folders || []).forEach(folder => times.push(Number(folder.updatedAt) || 0, Number(folder.sortIndex) || 0));
  (data.focusLogs || []).forEach(log => times.push(Number(log.timestamp) || 0));

  const noteIds = new Set((data.notes || []).map(note => note.id));
  const isSampleOnly = (data.notes || []).length <= 3 &&
    noteIds.has('note-welcome') &&
    noteIds.has('note-links') &&
    noteIds.has('note-pomodoro');
  if (isSampleOnly) return 0;

  return Math.max(0, ...times.filter(Number.isFinite));
}

function emitSyncState() {
  window.dispatchEvent(new CustomEvent('notidian:sync-state', { detail: { ...syncState } }));
}

function setSyncState(next) {
  Object.assign(syncState, next);
  emitSyncState();
}

function createAuth() {
  const nextAuth = new DropboxAuth({ clientId: APP_KEY });
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const expiresAt = localStorage.getItem(ACCESS_EXPIRES_KEY);

  if (refreshToken) nextAuth.setRefreshToken(refreshToken);
  if (accessToken) nextAuth.setAccessToken(accessToken);
  if (expiresAt) nextAuth.setAccessTokenExpiresAt(new Date(Number(expiresAt)));

  auth = nextAuth;
  client = new Dropbox({ auth });
  syncState.connected = Boolean(refreshToken);
  return nextAuth;
}

function persistTokens(tokenResult) {
  if (tokenResult.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokenResult.refresh_token);
    auth.setRefreshToken(tokenResult.refresh_token);
  }
  if (tokenResult.access_token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokenResult.access_token);
    auth.setAccessToken(tokenResult.access_token);
  }
  if (tokenResult.expires_in) {
    const expiresAt = Date.now() + Number(tokenResult.expires_in) * 1000;
    localStorage.setItem(ACCESS_EXPIRES_KEY, String(expiresAt));
    auth.setAccessTokenExpiresAt(new Date(expiresAt));
  }
}

function clearOAuthQuery() {
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

function refreshAppAfterRemoteApply() {
  if (window.Notidian) {
    if (typeof window.Notidian.loadPomodoroData === 'function') window.Notidian.loadPomodoroData();
    if (typeof window.Notidian.renderPomodoro === 'function') window.Notidian.renderPomodoro();
    if (typeof window.Notidian.renderNoteList === 'function') window.Notidian.renderNoteList();
    if (typeof window.Notidian.renderEditor === 'function') window.Notidian.renderEditor();
    if (typeof window.Notidian.renderAnalytics === 'function') window.Notidian.renderAnalytics();
    if (typeof window.Notidian.updateExistingTagsDatalist === 'function') window.Notidian.updateExistingTagsDatalist();
    if (typeof window.Notidian.updateTimerTargetTableSelect === 'function') window.Notidian.updateTimerTargetTableSelect();
    if (window.Notidian.mindMapInstance && typeof window.Notidian.mindMapInstance.updateData === 'function') {
      window.Notidian.mindMapInstance.updateData();
    }
  }
}

async function handleOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get('error');
  if (oauthError) {
    const errorDescription = params.get('error_description') || oauthError;
    setSyncState({ status: 'error', message: `Dropbox sign-in failed: ${errorDescription}` });
    clearOAuthQuery();
    return true;
  }

  const code = params.get('code');
  if (!code) return false;

  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const returnedState = params.get('state');
  if (expectedState && returnedState !== expectedState) {
    setSyncState({ status: 'error', message: 'Dropbox sign-in state did not match.' });
    clearOAuthQuery();
    return true;
  }

  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!verifier) {
    setSyncState({ status: 'error', message: 'Dropbox sign-in verifier was missing.' });
    clearOAuthQuery();
    return true;
  }

  setSyncState({ status: 'syncing', message: 'Connecting to Dropbox...' });
  auth.setCodeVerifier(verifier);

  try {
    const tokenResponse = await auth.getAccessTokenFromCode(getRedirectUri(), code);
    persistTokens(unwrap(tokenResponse));
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    clearOAuthQuery();
    setSyncState({ status: 'syncing', connected: true, message: 'Dropbox connected. Syncing...' });
    await syncNow({ reason: 'connect' });
  } catch (err) {
    clearOAuthQuery();
    setSyncState({ status: 'error', message: 'Dropbox sign-in failed.' });
    console.error('Dropbox OAuth failed:', err);
  }
  return true;
}

async function downloadRemoteSnapshot() {
  const response = await client.filesDownload({ path: SYNC_PATH });
  const result = unwrap(response);
  remoteRev = result.rev || '';
  if (remoteRev) localStorage.setItem(REMOTE_REV_KEY, remoteRev);

  const blob = result.fileBlob || new Blob([result.fileBinary]);
  const text = await blob.text();
  return JSON.parse(text);
}

async function uploadLocalSnapshot(expectedRev = remoteRev) {
  const snapshot = createNotidianSnapshot();
  const contents = JSON.stringify(snapshot, null, 2);
  const mode = expectedRev
    ? { '.tag': 'update', update: expectedRev }
    : { '.tag': 'overwrite' };

  const response = await client.filesUpload({
    path: SYNC_PATH,
    mode,
    autorename: false,
    mute: true,
    contents
  });
  const result = unwrap(response);
  remoteRev = result.rev || '';
  if (remoteRev) localStorage.setItem(REMOTE_REV_KEY, remoteRev);
  return result;
}

async function applyRemoteSnapshot(snapshot) {
  applyingRemote = true;
  try {
    applyNotidianSnapshot(snapshot, { markLocalChange: false });
    refreshAppAfterRemoteApply();
  } finally {
    applyingRemote = false;
  }
}

async function resolveConflictWithLatestWins(localSnapshot) {
  const remoteSnapshot = await downloadRemoteSnapshot();
  const localUpdatedAt = getSnapshotUpdatedAt(localSnapshot);
  const remoteUpdatedAt = getSnapshotUpdatedAt(remoteSnapshot);

  if (remoteUpdatedAt > localUpdatedAt) {
    await applyRemoteSnapshot(remoteSnapshot);
    return 'remote';
  }

  await uploadLocalSnapshot(remoteRev);
  return 'local';
}

export async function connectDropbox() {
  if (!APP_KEY) {
    setSyncState({ status: 'unconfigured', message: 'Set VITE_DROPBOX_APP_KEY first.' });
    showToast('Dropbox App Key is not configured.');
    return;
  }

  const state = `notidian-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  try {
    const authUrl = await auth.getAuthenticationUrl(
      getRedirectUri(),
      state,
      'code',
      'offline',
      SCOPES,
      'none',
      true
    );
    sessionStorage.setItem(PKCE_VERIFIER_KEY, auth.getCodeVerifier());
    window.location.assign(normalizeOAuthUrl(authUrl));
  } catch (err) {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    setSyncState({ status: 'error', message: 'Dropbox sign-in URL could not be created.' });
    console.error('Dropbox auth URL failed:', err);
  }
}

export async function disconnectDropbox() {
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(ACCESS_EXPIRES_KEY);
  localStorage.removeItem(REMOTE_REV_KEY);
  remoteRev = '';
  createAuth();
  setSyncState({ status: APP_KEY ? 'disconnected' : 'unconfigured', connected: false, message: 'Dropbox disconnected.' });
}

export async function syncNow(options = {}) {
  if (!APP_KEY) {
    setSyncState({ status: 'unconfigured', message: 'Set VITE_DROPBOX_APP_KEY first.' });
    return;
  }
  if (!localStorage.getItem(REFRESH_TOKEN_KEY)) {
    setSyncState({ status: 'disconnected', connected: false, message: 'Dropbox disconnected.' });
    return;
  }
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    setSyncState({ status: 'syncing', connected: true, message: 'Syncing with Dropbox...' });

    const localSnapshot = createNotidianSnapshot();
    const localUpdatedAt = getSnapshotUpdatedAt(localSnapshot);

    try {
      let remoteSnapshot = null;
      try {
        remoteSnapshot = await downloadRemoteSnapshot();
      } catch (err) {
        if (!isDropboxNotFound(err)) throw err;
      }

      if (!remoteSnapshot) {
        await uploadLocalSnapshot('');
      } else {
        const remoteUpdatedAt = getSnapshotUpdatedAt(remoteSnapshot);
        if (remoteUpdatedAt > localUpdatedAt) {
          await applyRemoteSnapshot(remoteSnapshot);
        } else if (localUpdatedAt > remoteUpdatedAt || options.reason === 'manual') {
          try {
            await uploadLocalSnapshot(remoteRev);
          } catch (err) {
            if (!isDropboxConflict(err)) throw err;
            await resolveConflictWithLatestWins(localSnapshot);
          }
        }
      }

      const now = Date.now();
      setSyncState({ status: 'synced', connected: true, message: 'Synced', lastSyncedAt: now });
      localStorage.setItem('notidian_dropbox_last_synced_at', String(now));
    } catch (err) {
      setSyncState({ status: navigator.onLine ? 'error' : 'offline', connected: true, message: 'Dropbox sync failed.' });
      console.error('Dropbox sync failed:', err);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export function scheduleDropboxSync() {
  if (!initialized || !localStorage.getItem(REFRESH_TOKEN_KEY) || applyingRemote) return;
  clearTimeout(debounceTimer);
  setSyncState({ status: 'pending', connected: true, message: 'Waiting to sync...' });
  debounceTimer = setTimeout(() => {
    syncNow({ reason: 'debounce' });
  }, DEBOUNCE_MS);
}

export function getDropboxSyncState() {
  return { ...syncState };
}

export function isApplyingRemote() {
  return applyingRemote;
}

export function isDropboxImageStorageAvailable() {
  return Boolean(APP_KEY && hasDropboxRefreshToken());
}

export async function uploadDropboxImageFile(file) {
  if (!file) {
    throw new Error('Image file is missing.');
  }

  const dbx = ensureDropboxImageClient();
  const requestedPath = createDropboxImagePath(file);
  const response = await dbx.filesUpload({
    path: requestedPath,
    mode: { '.tag': 'add' },
    autorename: true,
    mute: true,
    contents: file
  });
  const result = unwrap(response);
  const storedPath = result.path_lower || result.path_display || requestedPath;
  imageLinkCache.delete(storedPath);

  return {
    path: storedPath,
    fileName: file.name || '',
    mimeType: file.type || 'application/octet-stream',
    size: Number(file.size) || 0,
    uploadedAt: Date.now()
  };
}

export async function getDropboxImageTemporaryLink(path, options = {}) {
  if (!path) {
    throw new Error('Dropbox image path is missing.');
  }

  const cacheKey = String(path);
  const cached = imageLinkCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.link;
  }

  const dbx = ensureDropboxImageClient();
  const response = await dbx.filesGetTemporaryLink({ path: cacheKey });
  const result = unwrap(response);
  if (!result.link) {
    throw new Error('Dropbox temporary image link was missing.');
  }

  imageLinkCache.set(cacheKey, {
    link: result.link,
    expiresAt: Date.now() + IMAGE_LINK_TTL_MS
  });
  return result.link;
}

export function createDropboxSyncControls() {
  const wrapper = document.createElement('div');
  wrapper.className = 'notidian-sync-controls';

  const status = document.createElement('span');
  status.className = 'notidian-sync-status';
  wrapper.appendChild(status);

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'btn-secondary btn-sync-action';
  wrapper.appendChild(actionBtn);

  const disconnectBtn = document.createElement('button');
  disconnectBtn.type = 'button';
  disconnectBtn.className = 'btn-secondary btn-sync-disconnect';
  disconnectBtn.title = 'Dropbox disconnect';
  disconnectBtn.innerHTML = '<i class="fa-solid fa-link-slash"></i>';
  wrapper.appendChild(disconnectBtn);

  function render(current = getDropboxSyncState()) {
    wrapper.dataset.status = current.status;
    status.textContent = current.message;

    const connected = Boolean(current.connected);
    disconnectBtn.style.display = connected ? 'inline-flex' : 'none';

    if (current.status === 'unconfigured') {
      actionBtn.disabled = true;
      actionBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span>Dropbox未設定</span>';
      actionBtn.title = 'Set VITE_DROPBOX_APP_KEY in .env';
    } else if (connected) {
      actionBtn.disabled = current.status === 'syncing';
      actionBtn.innerHTML = current.status === 'syncing'
        ? '<i class="fa-solid fa-rotate fa-spin"></i><span>同期中</span>'
        : '<i class="fa-solid fa-rotate"></i><span>同期</span>';
      actionBtn.title = 'Dropbox sync now';
    } else {
      actionBtn.disabled = false;
      actionBtn.innerHTML = '<i class="fa-brands fa-dropbox"></i><span>Dropboxに接続</span>';
      actionBtn.title = 'Connect Dropbox';
    }
  }

  actionBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const current = getDropboxSyncState();
    if (current.connected) {
      syncNow({ reason: 'manual' });
    } else {
      connectDropbox();
    }
  });

  disconnectBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    disconnectDropbox();
  });

  window.addEventListener('notidian:sync-state', (event) => render(event.detail));
  render();
  return wrapper;
}

export async function initDropboxSync() {
  createAuth();

  window.NotidianSync = {
    connectDropbox,
    disconnectDropbox,
    syncNow,
    scheduleDropboxSync,
    getDropboxSyncState,
    isApplyingRemote,
    getDropboxSetupInfo,
    isDropboxImageStorageAvailable,
    uploadDropboxImageFile,
    getDropboxImageTemporaryLink
  };

  window.addEventListener('notidian:data-changed', scheduleDropboxSync);
  window.addEventListener('online', () => syncNow({ reason: 'online' }));
  window.addEventListener('offline', () => setSyncState({ status: 'offline', message: 'Offline', connected: syncState.connected }));

  if (!APP_KEY) {
    initialized = true;
    emitSyncState();
    return;
  }

  setSyncState({
    status: localStorage.getItem(REFRESH_TOKEN_KEY) ? 'syncing' : 'disconnected',
    connected: Boolean(localStorage.getItem(REFRESH_TOKEN_KEY)),
    message: localStorage.getItem(REFRESH_TOKEN_KEY) ? 'Preparing Dropbox sync...' : 'Dropbox disconnected.'
  });

  const localMeta = getLocalSyncMeta();
  if (!localMeta.updatedAt) {
    setLocalSyncMeta({ updatedAt: estimateSnapshotUpdatedAt(createNotidianSnapshot()), source: 'initial' }, false);
  }

  const handledOAuth = await handleOAuthReturn();
  initialized = true;
  if (!handledOAuth && localStorage.getItem(REFRESH_TOKEN_KEY)) {
    await syncNow({ reason: 'startup' });
  } else {
    emitSyncState();
  }
}
