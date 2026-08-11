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
The first version uses latest-snapshot-wins conflict handling.
