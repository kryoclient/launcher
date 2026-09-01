# KRYO Client — launcher

Free Minecraft launcher built on Electron and TypeScript. Every version from 1.7.10 to the latest snapshot; Fabric, Quilt, Forge, NeoForge and OptiFine; mods from Modrinth; automatic Java setup; offline and licensed Microsoft accounts.

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

The launcher checks for updates four seconds after start and on demand from the Updates screen, pulling them from the repository named in `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: kryoclient
  repo: launcher
```

Publish a release with `npx electron-builder --win --publish always` (needs `GH_TOKEN`), or upload the installer to a GitHub release by hand — electron-updater reads `latest.yml` from the release assets either way. Update checks are skipped in a dev run; the Updates screen says so. That screen also lists every published release and pre-release from `kryoclient/launcher`, with a bundled copy of the notes so it still reads something offline.

## Accounts

- **Offline** — a nickname only. Singleplayer and offline-mode servers. The UUID comes from `OfflinePlayer:<name>`, the same way every other launcher derives it.
- **Microsoft (licensed)** — an OAuth authorization-code flow in a real browser window → Xbox Live → XSTS → Minecraft services, plus an entitlement check, so an account without the game is rejected before the game starts. Skins, capes, Realms and licensed servers work. The refresh token is encrypted with Electron `safeStorage`; sessions refresh themselves.

Sign-in opens `login.live.com` in a dedicated `BrowserWindow` on its own `persist:kryo-msa` session. The launcher never sees the password — it only reads the `code` parameter off the redirect and exchanges it for tokens. `prompt=select_account` means the account picker shows every time; *forget the Microsoft browser session* on the Accounts screen clears the cookies.

It works with no configuration. If you would rather sign in through your own Azure app registration, put its client ID in Settings → Microsoft sign-in:

1. portal.azure.com → **App registrations** → **New registration**
2. Supported account types: **Personal Microsoft accounts only**
3. **Authentication** → add a **Mobile and desktop applications** redirect URI of `https://login.microsoftonline.com/common/oauth2/nativeclient`
4. Turn on **Allow public client flows**
5. Paste the **Application (client) ID** into KRYO → Settings → Microsoft sign-in

With a client ID set, KRYO switches to the Azure v2 consumer endpoints with PKCE. With the field empty it uses the built-in public client and the legacy `login.live.com` endpoints. Both end at the same place: an Xbox Live token, an XSTS token, and a Minecraft session.

## Loaders

| Loader | Source | How it installs |
| --- | --- | --- |
| Fabric | `meta.fabricmc.net` | Writes the loader profile JSON, which inherits from the vanilla version |
| Quilt | `meta.quiltmc.org` | Same shape as Fabric |
| Forge | `files.minecraftforge.net` + `maven.minecraftforge.net` | Runs the official installer headlessly: install libraries, extracted `data` entries, then every client-side processor via `java -cp` |
| NeoForge | `maven.neoforged.net` | Same pipeline; 1.20.1 lives under `net.neoforged:forge`, later versions under `net.neoforged:neoforge` |
| OptiFine | `optifine.net`, BMCLAPI as a fallback | Extracts `launchwrapper-of`, runs `optifine.Patcher` against the vanilla jar, writes a version JSON with the OptiFine tweaker |

Forge, NeoForge and OptiFine need a JVM to run their installers — the same runtime the profile would launch with, downloaded automatically if it is missing. Pre-1.13 Forge installers use the legacy `install` / `versionInfo` profile and are handled without processors.

Each profile stores the loader and an exact loader build. Leave the build on *Recommended* and KRYO follows the loader's own promotion (Forge's `promotions_slim.json`, the newest stable build elsewhere).

## What it does

- Reads Mojang's `version_manifest_v2` and installs any listed version
- Downloads client jar, libraries, natives and assets with sha1 verification and a 12–16 way download pool
- Unpacks natives per platform, honouring library rules and `extract.exclude`
- Installs Fabric, Quilt, Forge, NeoForge and OptiFine, and merges `inheritsFrom` version JSON across the chain
- Finds installed Java, or downloads a matching Adoptium runtime when a version needs one you do not have
- Builds the launch command from `arguments.jvm` / `arguments.game` (or legacy `minecraftArguments`) with full placeholder substitution, including `auth_xuid` from XSTS and `user_type=msa` for licensed accounts
- Searches Modrinth for the profile's loader, installs mods into the active profile, toggles and removes them
- Pings servers with the real Server List Ping protocol, SRV records included
- Keeps unlimited profiles, each with its own version, loader, loader build, RAM, JVM flags, window size and mod folder
- The Profiles screen holds one card per profile — version, loader, memory, mod count, last played — with play, edit, duplicate, folder and a two-step delete on each
- New profiles are made in one dialog: a preset row (Vanilla, Fabric, Forge, OptiFine, or a copy of the active profile), a searchable version picker, the loader build list, memory presets sized against the machine's own RAM, and a name that writes itself from the version and loader unless you type one. Everything else sits behind *Advanced*

## Layout on disk

```
%APPDATA%/.kryo/
├── versions/<id>/<id>.json, <id>.jar, natives/
├── libraries/
├── assets/indexes, objects/
├── installers/               ← loader installers and their extracted data
├── runtime/<major>/          ← Java downloaded by the launcher
└── instances/<profileId>/    ← game directory, mods/, saves/, options.txt
```

Config lives in Electron's `userData` folder: `kryo-config.json` (profiles, settings), `kryo-accounts.json` (accounts, encrypted tokens), `logs/launcher.log`.

## Source layout

```
src/
├── main/          Electron main process
│   ├── auth/      Microsoft OAuth window, token exchange, account store
│   ├── loaders/   Fabric, Quilt, Forge, NeoForge and OptiFine installers
│   ├── install.ts version install pipeline
│   ├── launch.ts  launch command builder
│   ├── java*.ts   runtime discovery and Adoptium download
│   ├── mods.ts    Modrinth search and local mod management
│   ├── releases.ts GitHub release history for the Updates screen
│   └── serverPing.ts
├── preload/       context-isolated IPC bridge
├── renderer/      UI (no framework, plain TS + CSS)
└── shared/        types shared between processes
```

## Known log noise

Two messages come from the game, not the launcher:

- `Unable to locate English counter names in registry Perflib 009` — an OSHI/JNA quirk on Windows. Cosmetic.
- `Failed to fetch user properties: 401` and `Realms authentication error` — expected on an offline account; they disappear once you sign in with Microsoft.

## Releasing from CI

`.github/workflows/release.yml` builds Windows, macOS and Linux on a tag and publishes them to a GitHub release, `latest.yml` included — which is the file electron-updater reads:

```bash
npm version 1.0.1
git push --follow-tags
```

`GITHUB_TOKEN` is provided by Actions, so no secret setup is needed for a public repository.

To publish a build by hand instead, upload **all** of `release/KryoClient-Setup-<version>.exe`, `.blockmap` and `latest.yml` to the release — without `latest.yml` the updater has nothing to compare against.

## Licence

MIT. Minecraft is a trademark of Mojang Studios; KRYO is not affiliated with Mojang Studios or Microsoft.
