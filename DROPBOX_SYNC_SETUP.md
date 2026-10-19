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
Sync compares actual content size (UTF-8 bytes) and update time. A newer
snapshot may replace the other side only if it is at least as large and retains
all existing note, folder, and work-log IDs. If these conditions disagree, sync
stops with a data-protection message and preserves both copies. Deliberate
deletions or shortening text can therefore pause sync too.

An untouched initial sample never replaces real content, even if an old client
stamped it with a newer time. Manual sync follows the same rules as automatic
sync. Timer initialization does not count as a user edit.

Before replacing real content, sync saves a rolling backup for the current device
at `/backups/notidian-sync/<device-id>-before-sync.json`. A failed backup stops
the replacement. Dropbox revision checks prevent another device's intervening
upload from being overwritten; conflicts are downloaded and checked again.
