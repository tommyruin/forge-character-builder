# Google Drive cross-device library

Google Drive is the current optional bring-your-own-storage provider. Fast Start is a separate,
free local browser optimization: it stores only an optimized rules copy in IndexedDB, never sends
source material to Drive, and always falls back to ordinary local processing. It does not require
Google Drive or a DM Forge account. Dropbox is planned and is not implemented by this document’s
current provider. When Drive applies changed imported content locally, Character Builder refreshes
the live rules library and automatically queues a matching Fast Start copy.

The provider-neutral and future Dropbox decisions are recorded in the
[storage-provider synchronization roadmap](./storage-provider-sync-roadmap.md).

## Goal

Google Drive is an optional, user-owned document store for moving a Character Builder library
between browsers and devices. IndexedDB remains the working copy and the application remains fully
usable without a Google account.

This is not a DM Forge account system:

- DM Forge does not receive or store a Google access token.
- The browser talks directly to Google Identity Services and the Drive REST API.
- Character rules, imports, conflict resolution, and persistence still run in the browser.
- Disconnecting Drive leaves both the local library and the Drive document intact.

## User flow

1. The user selects the persistent cloud-status icon and chooses **Connect Google Drive** from the
   responsive **Storage & Sync** drawer.
2. Google shows its account chooser and consent dialog.
3. DM Forge requests the non-sensitive `drive.file` scope.
4. DM Forge finds the visible library document it previously created for this OAuth application.
5. On first use, DM Forge creates a visible `DM Forge` folder and
   `dm-forge-library.json` document.
6. Local and Drive records are merged, Drive-only records are cached in IndexedDB, and the merged
   library is written back to Drive.
7. On another device, the user connects the same Google account and the same merge runs
   automatically.

The browser token flow does not issue a refresh token. A valid access token can support sync while
the page remains open, but after expiry the user must click to reconnect. This limitation is what
keeps the feature backend-free.

## Permission boundary

The initial implementation uses only:

```text
https://www.googleapis.com/auth/drive.file
```

This lets DM Forge read and update files it created, or files the user explicitly shares with it.
It does not let DM Forge silently inspect every file in the account.

Existing standalone `.dnd5e`, `.dnd5e-pkg`, `.xml`, and `.index` exports can later be admitted with
a filtered Google Picker. Picker preserves the same narrow scope and turns selected files into
files the app may read. Whole-Drive scanning would require the restricted `drive.readonly` scope
and a materially heavier Google review, so it is intentionally outside this branch.

References:

- [Google Identity Services browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker web integration](https://developers.google.com/workspace/drive/picker/guides/web-picker)

## Local data boundary

Only the Character Builder library is eligible:

- `characters`: raw `.dnd5e` XML, summary, and local update time
- `content`: uploaded `.xml`/`.index` bytes and source/path metadata
- `content-import-sources`: labels and refresh metadata for imported content sources
- `homebrew`: complete editable drafts, including their stable element identifiers

The following remain device-local:

- migration and recovery UI state
- theme and layout preferences
- map and token recent creations
- OAuth access tokens
- transient engine, worker, PDF, and boot state

Stable IndexedDB database and store names are unchanged.

## Document contract

The logical version-one library is a validated JSON document:

```json
{
  "format": "dm-forge-drive-snapshot",
  "version": 1,
  "updatedAt": "2026-07-25T12:00:00.000Z",
  "characters": [],
  "content": [],
  "contentSources": [],
  "homebrew": [],
  "tombstones": {
    "characters": [],
    "content": [],
    "contentSources": [],
    "homebrew": []
  },
  "conflicts": []
}
```

Every collection is sorted by its stable key before hashing or upload. The Drive file also carries
private `appProperties` identifying its DM Forge type and schema. Drive's immutable file ID is the
remote identity; filenames are presentation only and are not assumed unique.

The first branch implementation stores the logical document as one visible file. Before public
release, large-library testing must decide whether content records should move to separate Drive
files behind the same manifest. The logical merge contract does not change if physical storage is
split later.

## Merge and deletion rules

Sync is a three-way merge between:

- the current IndexedDB library;
- the current Drive library;
- the last successfully synchronized baseline stored in device-local metadata.

Per stable key:

- changed only locally → keep and upload the local record;
- changed only in Drive → cache the Drive record locally;
- unchanged → keep one copy;
- deleted on one side and unchanged on the other → carry a tombstone;
- changed independently on both sides → choose the newest record for the working library and keep
  both alternatives in bounded conflict history.

After the stable-key merge, content sources are also compared by their complete
set of normalized relative paths and exact file bytes. Matching sources with
different source IDs are reported as a duplicate group, but sync still saves
both and never deletes one automatically. The user can keep a selected source,
which creates ordinary source/file tombstones and immediately syncs them, or
keep all copies and synchronize an acknowledgement tied to that exact
fingerprint. Changed files invalidate the acknowledgement.

Drive `version`, record hashes, and the saved baseline prevent an overwrite from being treated as
an ordinary update. Local wall-clock timestamps alone are not considered a safe revision
identifier.

Before a sync snapshot is read, Character Builder flushes pending character and homebrew writes.
Additional content is then applied before a remotely changed character is reconciled so the
engine can resolve its selections. If sync changes the retained character, the loaded engine slot
is invalidated and the mounted workspace refreshes from IndexedDB in place. If sync deletes it, the
application returns to the character collection with a notice.

## Runtime and security rules

- Load `https://accounts.google.com/gsi/client` only after the user selects Connect. An
  unconnected visit must make zero Google requests.
- Keep access tokens in memory only. Never place them in IndexedDB, localStorage, logs, URLs,
  analytics, synchronized documents, or error reports.
- Use a public OAuth Web Client ID, never a client secret.
- Configure exact authorized JavaScript origins and HTTPS production hosting.
- Restrict any future Picker API key to the host's origins and only the required Google APIs.
- Revoke the active grant on Disconnect and clear local connection metadata without deleting user
  documents.
- Use one sync leader per origin with Web Locks when available so two open tabs do not write the
  Drive document at the same time.

## Deployment setup

Drive sync is off until the build supplies a public OAuth Web Client ID:

```text
VITE_GOOGLE_CLIENT_ID=<Google OAuth web client ID>
```

The client ID is an identifier that is visible in every browser OAuth application; it is not a
credential or secret. The Google Cloud project behind it needs the Google Drive API enabled, the
non-sensitive `drive.file` scope declared, the deployment's domain authorized, and the exact
deployment origin listed as an authorized JavaScript origin. Add a localhost origin only when
testing the real OAuth flow locally, and do not add a redirect URI: the browser token flow uses
none.

No secret belongs in the repository or browser bundle. The client ID is a public identifier.

The visible `DM Forge/dm-forge-library.json` file, its immutable file ID, current metadata,
`drive.file` authorization, and `dm-forge-drive-snapshot` version-1 wire identifier are the
compatibility contract for existing backups: they are persisted in users' Drives and must not
change. A future provider-neutral coordinator must preserve those values rather than silently
moving them into Google’s hidden `appDataFolder`.

## Release gates

Before enabling this publicly:

- unit-test document validation, merge, tombstones, conflicts, pagination, and API errors;
- browser-test connect/sync/disconnect with mocked Google endpoints;
- verify a new device receives characters, content sources, content files, and editable homebrew;
- verify a normal reload preserves local data and does not make an eager Google request;
- verify an expired token asks for a user click and never loses local edits;
- exercise simultaneous edits and deletes from two devices;
- verify independently imported identical sources are reviewable without
  automatic deletion, and that Keep all acknowledgements synchronize;
- test near the content import limits and decide whether the physical document must be split;
- review the privacy disclosure and Google Drive API terms with appropriate product/legal owners.
