Uninstalling takes the downloads with it, and Settings can now clear them one folder at a time.

## What is new in VERSION

**Uninstalling actually uninstalls.** Removing KRYO used to leave everything it had downloaded behind — on the machine this was written on, 618 MB of versions, libraries, assets and Java runtimes the uninstaller never mentioned. It now asks whether to delete `%APPDATA%\.kryo` and the launcher's own settings as well. The question is skipped during an update, and a silent uninstall keeps your data, so the auto-updater can never wipe a profile.

**Files and reinstall, in Settings.** What is on disk, broken down by folder — versions, libraries, assets, Java runtimes, worlds and mods, caches, launcher data — with a total. Four actions sit under it:

- **Clear caches** — the verification cache and the loader installers KRYO keeps around
- **Remove Java** — the runtimes KRYO downloaded; the next launch that needs one fetches it again
- **Reinstall game files** — deletes versions, libraries and assets, and nothing else. Worlds, mods, profiles and accounts stay
- **Reset everything** — the game folder plus profiles and accounts, the stored Microsoft session cleared, and the launcher restarts

Every one of them asks a second time before it runs, and none of them will run while the game is open.

## Which file do I download?

| File | For | Notes |
| --- | --- | --- |
| **KryoClient-Setup-VERSION.exe** | Windows 10 / 11, 64-bit | The normal choice. Installs per user, no admin rights needed. |
| **KryoClient-VERSION.dmg** | macOS 12 or newer | Universal — works on both Intel and Apple Silicon. |
| **KryoClient-VERSION.AppImage** | Any modern Linux | `chmod +x KryoClient-VERSION.AppImage` and run it. No install step. |
| SHA256SUMS.txt | Anyone who wants to verify | Hashes of the Windows artifacts from this same build. |
| latest*.yml, *.blockmap | Nobody — leave them | Used by the launcher's own updater. Deleting them breaks auto-update. |

## What it does

- Installs any version Mojang lists, verifying every file by sha1
- Fabric, Quilt, Forge, NeoForge and OptiFine from their official sources
- A screen for profiles, and one dialog that creates them from a preset
- Settings shows what is on disk and can clear it: caches, Java, game files, or everything
- Finds your Java, or downloads a matching Adoptium runtime when a version needs one you do not have
- Mod browser over Modrinth: install, toggle and remove per profile, matched to the profile's loader
- Two kinds of account: an offline nickname, or a Microsoft licence through Xbox Live → XSTS → Minecraft services, with an ownership check
- Skins and capes from your Minecraft account
- Server list pinged for real, SRV records included
- Unlimited profiles, each with its own version, loader, loader build, RAM, JVM flags and window size

## Before you install

**Windows will warn you.** The installer is not code-signed yet — that is a missing certificate, not a verdict about the file. Verify it if you want to be sure:

```
certutil -hashfile KryoClient-Setup-VERSION.exe SHA256
```

and compare against `SHA256SUMS.txt` above. Every build here is produced by GitHub Actions from this repository, on this tag — nothing is uploaded by hand.

## Requirements

- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk for the launcher and one profile
- Java 17+ — detected or downloaded by the launcher, nothing to install by hand. Forge and NeoForge run their installers with that same runtime.

## Known log noise

Two messages come from Minecraft itself, not the launcher: the `Perflib 009` warning on Windows, and the `401` / Realms errors on offline accounts. Both are harmless; the second pair disappears once you sign in with Microsoft.
