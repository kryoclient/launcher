# KRYO Client — launcher

Free Minecraft launcher built on Electron and TypeScript. Every version from 1.7.10 to the latest snapshot, one-click Fabric mods from Modrinth, automatic Java setup, offline and licensed Microsoft accounts.

The marketing site lives in [kryoclient/website](https://github.com/kryoclient/website).

## Run it

```bash
npm install
npm start
```

## Build an installer

```bash
npm run dist
```

Artifacts land in `release/` together with `SHA256SUMS.txt`. `npm run dist:all` builds Windows, macOS and Linux.

**If the build fails with `Cannot create symbolic link`**, Windows is refusing electron-builder's signing bundle. Either turn on Developer Mode (Settings → System → For developers) or skip the executable-editing step:

```bash
npx electron-builder --win nsis --publish never --config.win.signAndEditExecutable=false
```

**Code signing** is off because there is no certificate. With one, electron-builder picks it up from the environment:

```bash
set CSC_LINK=file://C:/path/to/certificate.pfx
set CSC_KEY_PASSWORD=your-password
npm run dist
```

Until then Windows SmartScreen warns on first run, so publish the hash from `SHA256SUMS.txt` next to every download. `npm run checksums` regenerates it for whatever is in `release/`.

## Releases and auto-update

The launcher checks for updates four seconds after start and on demand from Settings → Updates, pulling them from the repository named in `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: kryoclient
  repo: launcher
```

Publish a release with `npx electron-builder --win --publish always` (needs `GH_TOKEN`), or upload the installer to a GitHub release by hand — electron-updater reads `latest.yml` from the release assets either way. Update checks are skipped in a dev run; the Settings panel says so.

## Accounts

- **Offline** — a nickname only. Singleplayer and offline-mode servers. The UUID comes from `OfflinePlayer:<name>`, the same way every other launcher derives it.
- **Microsoft (licensed)** — device code → Xbox Live → XSTS → Minecraft services, plus an entitlement check, so an account without the game is rejected before the game starts. Skins, capes, Realms and licensed servers work. The refresh token is encrypted with Electron `safeStorage`; sessions refresh themselves.

Microsoft sign-in needs your own Azure application ID — Mojang does not hand out a shared one:

1. portal.azure.com → **App registrations** → **New registration**
2. Supported account types: **Personal Microsoft accounts only**
3. No redirect URI is needed for the device flow
4. **Authentication** → turn on **Allow public client flows**
5. Paste the **Application (client) ID** into KRYO → Settings → Microsoft sign-in

The launcher never sees the password: it shows a code, the user enters it on microsoft.com, and Microsoft returns the tokens.

## What it does

- Reads Mojang's `version_manifest_v2` and installs any listed version
- Downloads client jar, libraries, natives and assets with sha1 verification and a 12–16 way download pool
- Unpacks natives per platform, honouring library rules and `extract.exclude`
- Installs Fabric through the official Fabric meta API and merges `inheritsFrom` version JSON
- Finds installed Java, or downloads a matching Adoptium runtime when a version needs one you do not have
- Builds the launch command from `arguments.jvm` / `arguments.game` (or legacy `minecraftArguments`) with full placeholder substitution, including `auth_xuid` from XSTS and `user_type=msa` for licensed accounts
- Searches Modrinth, installs mods into the active profile, toggles and removes them
- Pings servers with the real Server List Ping protocol, SRV records included
- Keeps unlimited profiles, each with its own version, loader, RAM, JVM flags, window size and mod folder

## Layout on disk

```
%APPDATA%/.kryo/
├── versions/<id>/<id>.json, <id>.jar, natives/
├── libraries/
├── assets/indexes, objects/
├── runtime/<major>/          ← Java downloaded by the launcher
└── instances/<profileId>/    ← game directory, mods/, saves/, options.txt
```

Config lives in Electron's `userData` folder: `kryo-config.json` (profiles, settings), `kryo-accounts.json` (accounts, encrypted tokens), `logs/launcher.log`.

## Source layout

```
src/
├── main/          Electron main process
│   ├── auth/      Microsoft device flow, account store
│   ├── install.ts version install pipeline
│   ├── launch.ts  launch command builder
│   ├── java*.ts   runtime discovery and Adoptium download
│   ├── mods.ts    Modrinth search and local mod management
│   └── serverPing.ts
├── preload/       context-isolated IPC bridge
├── renderer/      UI (no framework, plain TS + CSS)
└── shared/        types shared between processes
```

## Known log noise

Two messages come from the game, not the launcher:

- `Unable to locate English counter names in registry Perflib 009` — an OSHI/JNA quirk on Windows. Cosmetic.
- `Failed to fetch user properties: 401` and `Realms authentication error` — expected on an offline account; they disappear once you sign in with Microsoft.

## Licence

MIT. Minecraft is a trademark of Mojang Studios; KRYO is not affiliated with Mojang Studios or Microsoft.
