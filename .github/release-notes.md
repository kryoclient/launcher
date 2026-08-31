Loaders, a real version picker, and a Microsoft sign-in that opens a browser window.

## What is new in VERSION

**Five loaders, not one.** Fabric, Quilt, Forge, NeoForge and OptiFine, each with its own build list per Minecraft version. Forge and NeoForge run the official installer end to end — libraries, extracted data, and every processor — so 1.13+ builds are patched exactly the way the Forge installer patches them. OptiFine is fetched from optifine.net and patched against the vanilla jar. Leave the build on *Recommended* and KRYO follows the loader's own promotion; pick an exact one if you need it pinned.

**A version picker that can be searched.** The dropdown is gone. In its place: the full Mojang manifest, a search box, and filters for release, snapshot, old builds and "installed only".

**Microsoft sign-in without the ceremony.** The real Microsoft page opens in a window — pick an account, approve, done. No device codes to copy, and no Azure application ID to register first. If you would rather use your own app registration, the field is still in Settings; leave it empty and the built-in one is used.

**A second launch that does not re-check everything.** KRYO used to re-hash the client jar and stat every one of the ~4 750 asset files before each start. It now keeps the checksums it has already verified, keyed by size and modification time, and remembers that a profile's assets are complete. On the machine this was measured on that is 2.4 seconds of disk work per launch turned into 16 milliseconds. *Install only* still runs the full verification pass whenever you want everything checked again.

**An Updates screen.** Every release and every beta, pulled from GitHub, with the notes rendered in the launcher. It is where you are reading this from, if you are reading it there.

**A new icon.** On the window, the taskbar and the installer.

### Fixes

- Natives are unpacked into the base version folder — which is where the launch command actually looks for them. Modded profiles on 1.18 and older were pointing at an empty directory.
- The classpath keeps one jar per artifact, so loader libraries no longer collide with the vanilla ones they replace.
- Profiles that inherit from a pre-1.13 release keep their launch arguments instead of starting with none.
- Libraries a loader builds locally are no longer downloaded, and no longer reported as failures.
- Modrinth search follows the profile loader instead of always asking for Fabric builds.

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
