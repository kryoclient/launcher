A screen for profiles, a dialog that makes them in one pass, and a new look.

## What is new in VERSION

**Profiles have their own screen.** One card per profile with its version, loader and build, memory, mod count and when it was last played. Play, edit, duplicate, open folder and delete sit on every card — and delete now asks a second time instead of removing a profile on the first click. Clicking a card selects it; the Play screen keeps the dropdown and links here.

**Making a profile is one dialog.** Start from a preset — Vanilla, Fabric, Forge, OptiFine, or a copy of the profile you are on — and everything is filled in: the latest release, the loader, its recommended build. The version field is the same searchable picker, the memory row offers presets bounded by the RAM your machine actually has, and the name writes itself from the version and loader unless you type one. Enter creates it. JVM arguments and window size stay behind *Advanced*, where they belong.

**A new coat of paint.** Warm near-black instead of blue-grey, one orange accent, rounded corners, and Manrope — bundled with the launcher, so it looks the same on a machine that has never installed a font. The application icon follows.

### Fixes

- Skins and capes load again. Mojang hands back texture URLs on `http`, which the launcher's own content security policy refuses, so the account avatar stayed blank. The scheme is upgraded now, including for accounts stored before this build.

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
