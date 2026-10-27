# Dropbox Sync Setup

1. Create a Dropbox app at https://www.dropbox.com/developers/apps.
2. Choose **Scoped access** and **App folder** access.
3. Enable these permissions:
   - `files.content.read`
   - `files.content.write`
4. Add your deployed Notidian URL as an OAuth redirect URI. The URI must match the app URL exactly, for example:
   - `https://your-notidian-site.example/`
   - `http://localhost:5173/` for local development
5. Copy `.env.example` to `.env` and set:

```env
VITE_DROPBOX_APP_KEY=your_dropbox_app_key_here
```

6. Restart the dev server or rebuild the app.
7. Open Notidian and click **Dropboxに接続** in the editor toolbar.

The synced file is stored in the Dropbox app folder as `/notidian-sync.json`.

Sync combines changes against this device's last successful shared snapshot,
which is saved in IndexedDB. Different notes, blocks and ID-based database rows
merge independently. Shortening text and deleting content no longer stops sync.
Deleted record versions are carried in `syncTombstones`, so an unchanged offline
copy cannot bring them back. An edit concurrent with a deletion is kept.

If the same field changes on both devices, both versions are preserved: one is
used in the merged note and the other is saved as a separate note with the suffix
`（別端末の変更）`. Other conflicting settings or logs are saved in a recovery note.
On the first sync after upgrading, when no shared baseline exists, missing items
are conservatively retained and differing versions are saved instead of guessed.
Untouched initial samples still never replace real user content.

While online and visible, the app checks for remote changes every 15 seconds,
and also when returning to the page or finishing an edit. Changes on this device
are uploaded after the existing 3.5-second debounce. Text input is saved locally
without waiting for the block to lose focus. Incoming changes to an actively
edited note wait until the edit finishes; unrelated notes can update meanwhile.
Closed or suspended browsers resume synchronization when opened again.

Conditional GET downloads use Dropbox's ETag support so unchanged polls do not
redownload the notebook. No additional Dropbox permissions are needed.
See https://docs.dropboxapi.com/dropbox-api/docs/technical-reference/request-response-formats.

Before replacing content, sync saves separate rolling local and cloud backups
at `/backups/notidian-sync/<device-id>-<local|cloud>-before-sync.json`. A failed
backup stops the replacement. Uploads are checked against the downloaded Dropbox
revision; simultaneous uploads re-read and merge the newer version before retrying.
Refresh the page on every device to activate the new synchronization protocol.
