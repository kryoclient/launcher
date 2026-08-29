A free Minecraft launcher: every version from 1.7.10 to the latest snapshot, Fabric in one switch, mods straight from Modrinth, and Java it installs for you.

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
- Fabric through the official Fabric meta API — flip one switch on a profile
- Finds your Java, or downloads a matching Adoptium runtime when a version needs one you do not have
- Mod browser over Modrinth: install, toggle and remove per profile
- Two kinds of account: an offline nickname, or a Microsoft licence through the official device-code flow (Xbox Live → XSTS → Minecraft services, with an ownership check)
- Skins and capes from your Minecraft account
- Server list pinged for real, SRV records included
- Unlimited profiles, each with its own version, loader, RAM, JVM flags and window size

## Before you install

**Windows will warn you.** The installer is not code-signed yet — that is a missing certificate, not a verdict about the file. Verify it if you want to be sure:

```
certutil -hashfile KryoClient-Setup-VERSION.exe SHA256
```

and compare against `SHA256SUMS.txt` above. Every build here is produced by GitHub Actions from this repository, on this tag — nothing is uploaded by hand.

**Microsoft sign-in needs your own Azure application ID.** Mojang does not hand out a shared one. Two minutes: portal.azure.com → App registrations → New registration → *Personal Microsoft accounts only* → Authentication → *Allow public client flows* → paste the client ID into Settings. Offline mode works without any of this.

## Requirements

- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk for the launcher and one profile
- Java 17+ — detected or downloaded by the launcher, nothing to install by hand

## Known log noise

Two messages come from Minecraft itself, not the launcher: the `Perflib 009` warning on Windows, and the `401` / Realms errors on offline accounts. Both are harmless; the second pair disappears once you sign in with Microsoft.
