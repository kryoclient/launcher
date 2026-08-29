import type {
  Account,
  InstalledVersion,
  LauncherState,
  LoaderInfo,
  LoaderVersion,
  ModEntry,
  ModrinthHit,
  Profile,
  ReleaseEntry,
  ServerEntry,
  ServerStatus,
  UpdateStatus,
  VersionSummary
} from "./types";

const api = window.kryo;

let state: LauncherState;
let versions: VersionSummary[] = [];
let installed: InstalledVersion[] = [];
let mods: ModEntry[] = [];
let servers: ServerEntry[] = [];
let loaders: LoaderInfo[] = [];
let loaderBuilds: LoaderVersion[] = [];
let releases: ReleaseEntry[] = [];
let releaseChannel: "all" | "stable" | "beta" = "all";
let authPending = false;

const typeFilters = new Set<string>(["release"]);
let installedOnly = false;

function $<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function activeProfile(): Profile | null {
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? null;
}

function activeAccount(): Account | null {
  return state.accounts.find((a) => a.id === state.activeAccountId) ?? null;
}

function loaderName(id: string): string {
  return loaders.find((loader) => loader.id === id)?.name ?? id;
}

let toastTimer = 0;

function toast(message: string, isError = false): void {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("show"), 5200);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^(Auth)?Error:\s*/, "");
  }
  return String(error);
}

function appendLog(line: string): void {
  const log = $("#log");
  log.textContent = `${log.textContent ?? ""}${line}`;
  const lines = (log.textContent ?? "").split("\n");
  if (lines.length > 500) log.textContent = lines.slice(-500).join("\n");
  log.scrollTop = log.scrollHeight;
}

function setProgress(label: string, current: number, total: number): void {
  $("#progress-label").textContent = label;
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  $("#progress-count").textContent = total > 1 ? `${current} / ${total}` : "";
  ($("#progress-bar") as HTMLElement).style.width = `${percent}%`;
}

function switchView(view: string): void {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", (item as HTMLElement).dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", (section as HTMLElement).dataset.view === view);
  });

  if (view === "servers") void refreshServers();
  if (view === "mods") void refreshMods();
  if (view === "settings") void renderJava();
  if (view === "updates") void refreshReleases(false);
}

function renderAccountCard(): void {
  const account = activeAccount();
  $("#account-name").textContent = account ? account.username : "No account";
  $("#account-type").textContent = account ? (account.licensed ? "licensed" : "offline") : "add one";

  const avatar = $("#account-avatar");
  avatar.style.backgroundImage = account?.skinUrl ? `url("${account.skinUrl}")` : "";
  avatar.classList.toggle("licensed", Boolean(account?.licensed));
}

function renderAccounts(): void {
  renderAccountCard();

  const list = $("#account-list");
  list.innerHTML = "";

  if (state.accounts.length === 0) {
    list.innerHTML =
      '<p class="empty">No accounts yet. Sign in with Microsoft to use your licence, or add an offline name.</p>';
    return;
  }

  for (const account of state.accounts) {
    const row = document.createElement("div");
    row.className = `list-row${account.id === state.activeAccountId ? " current" : ""}`;
    row.innerHTML = `
      <div class="list-main">
        <div class="list-name">${account.username}</div>
        <div class="list-sub">${account.licensed ? "microsoft · licensed" : "offline"} · ${account.uuid}</div>
      </div>
      <div class="list-actions">
        ${
          account.id === state.activeAccountId
            ? '<span class="chip on">active</span>'
            : `<button type="button" class="chip" data-use="${account.id}">use</button>`
        }
        <button type="button" class="chip" data-forget="${account.id}">remove</button>
      </div>`;
    list.appendChild(row);
  }
}

function renderProfiles(): void {
  const select = $<HTMLSelectElement>("#profile-select");
  select.innerHTML = "";

  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} · ${profile.versionId || "no version"}`;
    option.selected = profile.id === state.activeProfileId;
    select.appendChild(option);
  }

  const profile = activeProfile();
  $("#play-title").textContent = profile
    ? `${profile.versionId || "Pick a version"}${profile.loader === "vanilla" ? "" : ` · ${loaderName(profile.loader)}`}`
    : "No profile";

  if (!profile) return;

  $<HTMLInputElement>("#memory-range").value = String(profile.memoryMb);
  $("#memory-value").textContent = `${profile.memoryMb} MB`;
  $<HTMLInputElement>("#jvm-args").value = profile.jvmArgs;
  $<HTMLInputElement>("#res-width").value = String(profile.width);
  $<HTMLInputElement>("#res-height").value = String(profile.height);
  $<HTMLInputElement>("#opt-fullscreen").checked = profile.fullscreen;
  $("#stat-played").textContent = profile.lastPlayed ? new Date(profile.lastPlayed).toLocaleDateString() : "never";
}

function isInstalled(versionId: string): boolean {
  return installed.some((entry) => entry.id === versionId || entry.id.endsWith(`-${versionId}`));
}

function versionType(version: VersionSummary): string {
  if (version.type === "release" || version.type === "snapshot") return version.type;
  return "old";
}

function renderVersionTrigger(): void {
  const profile = activeProfile();
  const current = profile?.versionId ?? "";
  $("#version-current").textContent = current || "Pick a version";

  const summary = versions.find((version) => version.id === current);
  const bits: string[] = [];
  if (summary) bits.push(versionType(summary));
  if (current && isInstalled(current)) bits.push("installed");
  $("#version-meta").textContent = bits.join(" · ");

  $("#stat-installed").textContent = String(installed.length);
}

function renderVersionList(): void {
  const list = $("#version-list");
  const query = $<HTMLInputElement>("#version-search").value.trim().toLowerCase();
  const profile = activeProfile();

  const matches = versions.filter((version) => {
    if (installedOnly && !isInstalled(version.id)) return false;
    if (typeFilters.size > 0 && !typeFilters.has(versionType(version))) return false;
    if (query && !version.id.toLowerCase().includes(query)) return false;
    return true;
  });

  list.innerHTML = "";

  if (matches.length === 0) {
    list.innerHTML = '<p class="empty">Nothing matches those filters.</p>';
    return;
  }

  for (const version of matches.slice(0, 400)) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `picker-row${version.id === profile?.versionId ? " current" : ""}`;
    row.dataset.version = version.id;
    row.innerHTML = `
      <span class="picker-id">${version.id}</span>
      <span class="picker-type">${versionType(version)}</span>
      <span class="picker-date mono">${version.releaseTime.slice(0, 10)}</span>
      <span class="picker-mark">${isInstalled(version.id) ? "installed" : ""}</span>`;
    list.appendChild(row);
  }

  if (matches.length > 400) {
    const note = document.createElement("p");
    note.className = "empty";
    note.textContent = `${matches.length - 400} more — narrow the search to see them.`;
    list.appendChild(note);
  }
}

function renderLoaderRow(): void {
  const row = $("#loader-row");
  const profile = activeProfile();
  row.innerHTML = "";

  for (const loader of loaders) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `loader-chip${profile?.loader === loader.id ? " active" : ""}`;
    button.dataset.loader = loader.id;
    button.innerHTML = `<span>${loader.name}</span><span class="loader-tag">${loader.tag}</span>`;
    row.appendChild(button);
  }
}

async function refreshLoaderBuilds(): Promise<void> {
  const field = $("#loader-build-field");
  const select = $<HTMLSelectElement>("#loader-build");
  const profile = activeProfile();

  if (!profile || profile.loader === "vanilla" || !profile.versionId) {
    field.hidden = true;
    loaderBuilds = [];
    return;
  }

  field.hidden = false;
  select.disabled = true;
  select.innerHTML = '<option value="">Loading builds…</option>';

  try {
    loaderBuilds = await api.listLoaderVersions(profile.loader, profile.versionId);
  } catch (error) {
    loaderBuilds = [];
    select.innerHTML = `<option value="">${errorMessage(error)}</option>`;
    return;
  }

  select.innerHTML = "";

  if (loaderBuilds.length === 0) {
    select.innerHTML = `<option value="">${loaderName(profile.loader)} has no build for ${profile.versionId}</option>`;
    return;
  }

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = `Recommended · ${loaderBuilds.find((b) => b.recommended)?.label ?? loaderBuilds[0].label}`;
  select.appendChild(auto);

  for (const build of loaderBuilds) {
    const option = document.createElement("option");
    option.value = build.id;
    const marks = [build.recommended ? "recommended" : "", build.stable ? "" : "beta"].filter(Boolean);
    option.textContent = marks.length > 0 ? `${build.label} · ${marks.join(" · ")}` : build.label;
    option.selected = profile.loaderVersion === build.id;
    select.appendChild(option);
  }

  select.disabled = false;
}

function renderMods(): void {
  const container = $("#mods-installed");
  const profile = activeProfile();
  container.innerHTML = "";
  $("#mods-count").textContent = String(mods.length);
  $("#stat-mods").textContent = String(mods.filter((m) => m.enabled).length);
  $("#mods-eyebrow").textContent = profile ? `${loaderName(profile.loader).toLowerCase()} mods` : "mods";

  if (mods.length === 0) {
    container.innerHTML =
      '<p class="empty">No mods yet. Install one from Modrinth or drop a .jar into the profile folder.</p>';
    return;
  }

  for (const mod of mods) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="list-main">
        <div class="list-name">${mod.name}</div>
        <div class="list-sub">${mod.sizeKb} KB · ${mod.enabled ? "enabled" : "disabled"}</div>
      </div>
      <div class="list-actions">
        <button type="button" class="chip ${mod.enabled ? "on" : ""}" data-toggle="${mod.fileName}">
          ${mod.enabled ? "on" : "off"}
        </button>
        <button type="button" class="chip" data-remove="${mod.fileName}">remove</button>
      </div>`;
    container.appendChild(row);
  }
}

function renderResults(hits: ModrinthHit[]): void {
  const container = $("#mods-results");
  container.innerHTML = "";

  if (hits.length === 0) {
    container.innerHTML = '<p class="empty">Nothing found for this Minecraft version.</p>';
    return;
  }

  for (const hit of hits) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="list-main">
        <div class="list-name">${hit.title}</div>
        <div class="list-sub">${hit.downloads.toLocaleString("en-US")} downloads · ${hit.categories.join(", ")}</div>
      </div>
      <div class="list-actions">
        <button type="button" class="chip" data-install="${hit.projectId}">install</button>
      </div>`;
    container.appendChild(row);
  }
}

function renderSkin(): void {
  const account = activeAccount();
  const preview = $("#skin-preview");
  const hint = $("#skin-hint");

  preview.style.backgroundImage = account?.skinUrl ? `url("${account.skinUrl}")` : "";

  const buttons = [$<HTMLButtonElement>("#skin-classic"), $<HTMLButtonElement>("#skin-slim")];
  const licensed = Boolean(account?.licensed);
  buttons.forEach((button) => (button.disabled = !licensed));

  hint.textContent = licensed
    ? "Pick a 64x64 PNG. Classic is the 4px arm model, slim is the 3px one. The change applies to your Mojang profile."
    : "Skin uploads need a licensed Microsoft account. Offline accounts use whatever the server decides.";
}

function renderCapes(): void {
  const grid = $("#cape-grid");
  const account = activeAccount();
  grid.innerHTML = "";
  renderSkin();

  if (!account) {
    $("#capes-note").textContent = "Add an account first.";
    grid.innerHTML = '<p class="empty">No account selected.</p>';
    return;
  }

  if (!account.licensed) {
    $("#capes-note").textContent = "Offline accounts have no capes — sign in with Microsoft to use yours.";
    grid.innerHTML = '<p class="empty">Capes are tied to a licensed Minecraft account.</p>';
    return;
  }

  if (account.capes.length === 0) {
    $("#capes-note").textContent = `${account.username} owns no capes yet.`;
    grid.innerHTML = '<p class="empty">This account has no capes on it.</p>';
    return;
  }

  $("#capes-note").textContent = "Click a cape to wear it. Changes apply to your Mojang profile.";

  const none = document.createElement("div");
  none.className = `cape${account.activeCapeId ? "" : " selected"}`;
  none.dataset.cape = "";
  none.innerHTML = `
    <div class="cape-swatch empty-swatch"></div>
    <div class="cape-meta"><span>No cape</span><span class="cape-state">${account.activeCapeId ? "" : "worn"}</span></div>`;
  grid.appendChild(none);

  for (const cape of account.capes) {
    const card = document.createElement("div");
    card.className = `cape${cape.active ? " selected" : ""}`;
    card.dataset.cape = cape.id;
    card.innerHTML = `
      <div class="cape-swatch"><img src="${cape.url}" alt="${cape.name}" /></div>
      <div class="cape-meta">
        <span>${cape.name}</span>
        <span class="cape-state">${cape.active ? "worn" : "owned"}</span>
      </div>`;
    grid.appendChild(card);
  }
}

async function refreshServers(): Promise<void> {
  if (servers.length === 0) servers = await api.listServers();

  const list = $("#server-list");
  list.innerHTML = "";

  for (const server of servers) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.dataset.address = server.address;
    row.innerHTML = `
      <div class="list-main">
        <div class="list-name">${server.name}</div>
        <div class="list-sub">${server.address} · ${server.tag}</div>
      </div>
      <div class="list-actions">
        <span class="mono status" data-status="${server.address}">pinging…</span>
        <button type="button" class="chip" data-copy="${server.address}">copy ip</button>
      </div>`;
    list.appendChild(row);
  }

  await Promise.all(
    servers.map(async (server) => {
      let status: ServerStatus | undefined;
      try {
        [status] = await api.pingServers([server.address]);
      } catch {
        status = undefined;
      }

      const node = list.querySelector<HTMLElement>(`[data-status="${server.address}"]`);
      if (!node) return;

      if (!status?.online) {
        node.textContent = "offline";
        node.classList.remove("online");
        return;
      }

      node.textContent = `${status.players.toLocaleString("en-US")}/${status.maxPlayers.toLocaleString("en-US")} · ${status.ping} ms`;
      node.classList.add("online");
      node.title = status.motd;
    })
  );
}

function inlineInto(parent: HTMLElement, text: string): void {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > index) parent.appendChild(document.createTextNode(text.slice(index, at)));

    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else {
      const label = token.slice(1, token.indexOf("]"));
      const href = match[2];
      const link = document.createElement("button");
      link.type = "button";
      link.className = "link inline";
      link.textContent = label;
      link.dataset.href = href;
      parent.appendChild(link);
    }

    index = at + token.length;
  }

  if (index < text.length) parent.appendChild(document.createTextNode(text.slice(index)));
}

function renderNotes(container: HTMLElement, markdown: string): void {
  const lines = markdown.split("\n");
  let list: HTMLUListElement | null = null;
  let table: HTMLTableElement | null = null;
  let paragraph: HTMLParagraphElement | null = null;

  const closeBlocks = (): void => {
    list = null;
    table = null;
    paragraph = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      closeBlocks();
      continue;
    }

    if (line.startsWith("#")) {
      closeBlocks();
      const heading = document.createElement("h3");
      heading.textContent = line.replace(/^#+\s*/, "");
      container.appendChild(heading);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      table = null;
      paragraph = null;
      if (!list) {
        list = document.createElement("ul");
        container.appendChild(list);
      }
      const item = document.createElement("li");
      inlineInto(item, line.replace(/^\s*[-*]\s+/, ""));
      list.appendChild(item);
      continue;
    }

    if (line.trim().startsWith("|")) {
      list = null;
      paragraph = null;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;

      if (!table) {
        table = document.createElement("table");
        table.className = "notes-table";
        container.appendChild(table);
      }

      const row = document.createElement("tr");
      for (const cell of cells) {
        const node = document.createElement(table.rows.length === 0 ? "th" : "td");
        inlineInto(node, cell);
        row.appendChild(node);
      }
      table.appendChild(row);
      continue;
    }

    list = null;
    table = null;

    if (!paragraph) {
      paragraph = document.createElement("p");
      container.appendChild(paragraph);
    } else {
      paragraph.appendChild(document.createTextNode(" "));
    }
    inlineInto(paragraph, line.trim());
  }
}

function renderReleases(): void {
  const container = $("#release-list");
  container.innerHTML = "";

  const visible = releases.filter((entry) => releaseChannel === "all" || entry.channel === releaseChannel);

  if (visible.length === 0) {
    container.innerHTML = '<p class="empty">No releases in this channel yet.</p>';
    return;
  }

  for (const entry of visible) {
    const card = document.createElement("article");
    card.className = "release";

    const head = document.createElement("header");
    head.className = "release-head";

    const title = document.createElement("h2");
    title.textContent = entry.name;
    head.appendChild(title);

    const badge = document.createElement("span");
    badge.className = `release-badge ${entry.channel}`;
    badge.textContent = entry.channel === "beta" ? "beta" : "release";
    head.appendChild(badge);

    const date = document.createElement("span");
    date.className = "release-date mono";
    date.textContent = entry.publishedAt || "unreleased";
    head.appendChild(date);

    card.appendChild(head);

    const notes = document.createElement("div");
    notes.className = "release-notes";
    if (entry.notes) renderNotes(notes, entry.notes);
    else notes.innerHTML = '<p class="empty">No notes for this build.</p>';
    card.appendChild(notes);

    const footer = document.createElement("footer");
    footer.className = "release-foot";

    for (const asset of entry.assets) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.href = asset.url;
      chip.textContent = `${asset.name} · ${asset.sizeMb} MB`;
      footer.appendChild(chip);
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "link";
    open.dataset.href = entry.url;
    open.textContent = entry.bundled ? "open the tag on GitHub" : "open on GitHub";
    footer.appendChild(open);

    card.appendChild(footer);
    container.appendChild(card);
  }
}

async function refreshReleases(force: boolean): Promise<void> {
  if (releases.length === 0) {
    $("#release-list").innerHTML = '<p class="empty">Loading the release history…</p>';
  }

  try {
    releases = await api.listReleases(force);
  } catch (error) {
    toast(errorMessage(error), true);
  }

  renderReleases();
}

function renderSettings(): void {
  $<HTMLInputElement>("#game-dir").value = state.settings.gameDir;
  $<HTMLInputElement>("#azure-id").value = state.settings.azureClientId;
  $<HTMLInputElement>("#opt-snapshots").checked = state.settings.showSnapshots;
  $<HTMLInputElement>("#opt-keep-open").checked = state.settings.keepLauncherOpen;
  $<HTMLInputElement>("#opt-telemetry").checked = state.settings.telemetry;
  $<HTMLInputElement>("#opt-managed-java").checked = state.settings.managedJava;
}

async function renderJava(): Promise<void> {
  const select = $<HTMLSelectElement>("#java-select");
  const profile = activeProfile();
  select.innerHTML = "";

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Automatic";
  select.appendChild(auto);

  try {
    const runtimes = await api.listJava();
    for (const runtime of runtimes) {
      const option = document.createElement("option");
      option.value = runtime.path;
      option.textContent = `Java ${runtime.major} · ${runtime.version}${runtime.managed ? " · managed" : ""}`;
      option.selected = profile?.javaPath === runtime.path;
      select.appendChild(option);
    }
    $("#stat-java").textContent = runtimes.length > 0 ? String(runtimes[0].major) : "auto";
  } catch {
    $("#stat-java").textContent = "auto";
  }

  if (profile?.javaPath && !Array.from(select.options).some((o) => o.value === profile.javaPath)) {
    const custom = document.createElement("option");
    custom.value = profile.javaPath;
    custom.textContent = profile.javaPath;
    custom.selected = true;
    select.appendChild(custom);
  }
}

async function refreshMods(): Promise<void> {
  const profile = activeProfile();
  if (!profile) return;
  mods = await api.listMods(profile.id);
  renderMods();
}

function renderAll(): void {
  renderAccounts();
  renderProfiles();
  renderSettings();
  renderCapes();
  renderLoaderRow();
  renderVersionTrigger();
}

async function apply(next: Promise<LauncherState>): Promise<void> {
  state = await next;
  renderAll();
}

function bindWindowControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-window]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.window;
      if (action === "minimize") void api.minimize();
      if (action === "maximize") void api.maximize();
      if (action === "close") void api.close();
    });
  });
}

function bindNavigation(): void {
  document.querySelectorAll<HTMLElement>(".nav-item, #account-card").forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view;
      if (view) switchView(view);
    });
  });

  document.body.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest<HTMLElement>("[data-href]");
    if (!link?.dataset.href) return;
    void api.openExternal(link.dataset.href);
  });
}

function bindAccounts(): void {
  $("#add-offline-open").addEventListener("click", () => {
    const form = $("#offline-form");
    form.hidden = !form.hidden;
    if (!form.hidden) $<HTMLInputElement>("#offline-name").focus();
  });

  const addOffline = async (): Promise<void> => {
    const input = $<HTMLInputElement>("#offline-name");
    try {
      await apply(api.addOfflineAccount(input.value));
      input.value = "";
      $("#offline-form").hidden = true;
      toast("Offline account added");
    } catch (error) {
      toast(errorMessage(error), true);
    }
  };

  $("#add-offline").addEventListener("click", () => void addOffline());
  $<HTMLInputElement>("#offline-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void addOffline();
  });

  $("#add-microsoft").addEventListener("click", async () => {
    if (authPending) return;
    authPending = true;

    $("#auth-error").textContent = "";
    $("#auth-dismiss").classList.add("hidden");
    $("#auth-title").textContent = "Opening Microsoft";
    $("#auth-text").textContent = "A Microsoft window is opening. Pick the account that owns Minecraft.";
    $("#auth-overlay").classList.remove("hidden");

    try {
      await apply(api.linkMicrosoft());
      $("#auth-overlay").classList.add("hidden");
      toast("Microsoft account linked");
    } catch (error) {
      const message = errorMessage(error);
      if (/cancel|closed/i.test(message)) {
        $("#auth-overlay").classList.add("hidden");
      } else {
        $("#auth-title").textContent = "Sign-in failed";
        $("#auth-text").textContent = "Nothing was saved. You can try again.";
        $("#auth-error").textContent = message;
        $("#auth-dismiss").classList.remove("hidden");
      }
    } finally {
      authPending = false;
    }
  });

  $("#auth-dismiss").addEventListener("click", () => $("#auth-overlay").classList.add("hidden"));

  $("#auth-forget").addEventListener("click", async () => {
    await api.forgetMicrosoftSession();
    toast("Microsoft browser session cleared");
  });

  $("#account-list").addEventListener("click", async (event) => {
    const element = event.target as HTMLElement;

    const use = element.closest<HTMLButtonElement>("[data-use]");
    if (use) {
      await apply(api.selectAccount(use.dataset.use ?? ""));
      return;
    }

    const forget = element.closest<HTMLButtonElement>("[data-forget]");
    if (forget) {
      await apply(api.removeAccount(forget.dataset.forget ?? ""));
    }
  });
}

async function patchProfile(patch: Partial<Profile>): Promise<void> {
  const profile = activeProfile();
  if (!profile) return;
  await apply(api.updateProfile(profile.id, patch));
}

function bindVersionPicker(): void {
  const overlay = $("#version-overlay");

  const open = (): void => {
    overlay.classList.remove("hidden");
    renderVersionList();
    $<HTMLInputElement>("#version-search").focus();
  };

  $("#version-trigger").addEventListener("click", open);
  $("#version-close").addEventListener("click", () => overlay.classList.add("hidden"));

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.classList.add("hidden");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") overlay.classList.add("hidden");
  });

  $<HTMLInputElement>("#version-search").addEventListener("input", () => renderVersionList());

  $("#version-filters").addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-vtype]");
    if (!chip) return;

    const type = chip.dataset.vtype ?? "";

    if (type === "installed") {
      installedOnly = !installedOnly;
      chip.classList.toggle("on", installedOnly);
    } else if (typeFilters.has(type)) {
      typeFilters.delete(type);
      chip.classList.remove("on");
    } else {
      typeFilters.add(type);
      chip.classList.add("on");
    }

    renderVersionList();
  });

  $("#version-list").addEventListener("click", async (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-version]");
    if (!row?.dataset.version) return;

    overlay.classList.add("hidden");
    await patchProfile({ versionId: row.dataset.version, loaderVersion: "" });
    await refreshLoaderBuilds();
    await refreshMods();
  });
}

function bindPlayView(): void {
  $<HTMLSelectElement>("#profile-select").addEventListener("change", async (event) => {
    await apply(api.selectProfile((event.target as HTMLSelectElement).value));
    await refreshLoaderBuilds();
    await refreshMods();
  });

  $("#profile-new").addEventListener("click", async () => {
    const profile = activeProfile();
    await apply(
      api.createProfile({
        name: `Profile ${state.profiles.length + 1}`,
        versionId: profile?.versionId ?? versions[0]?.id ?? ""
      })
    );
    await refreshLoaderBuilds();
  });

  $("#profile-delete").addEventListener("click", async () => {
    const profile = activeProfile();
    if (!profile) return;
    if (state.profiles.length <= 1) {
      toast("Keep at least one profile", true);
      return;
    }
    await apply(api.deleteProfile(profile.id));
    await refreshLoaderBuilds();
  });

  $("#loader-row").addEventListener("click", async (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-loader]");
    if (!chip?.dataset.loader) return;

    await patchProfile({ loader: chip.dataset.loader as Profile["loader"], loaderVersion: "" });
    await refreshLoaderBuilds();
  });

  $<HTMLSelectElement>("#loader-build").addEventListener("change", (event) => {
    void patchProfile({ loaderVersion: (event.target as HTMLSelectElement).value });
  });

  const memory = $<HTMLInputElement>("#memory-range");
  memory.addEventListener("input", () => {
    $("#memory-value").textContent = `${memory.value} MB`;
  });
  memory.addEventListener("change", () => void patchProfile({ memoryMb: Number(memory.value) }));

  $<HTMLInputElement>("#jvm-args").addEventListener("change", (event) => {
    void patchProfile({ jvmArgs: (event.target as HTMLInputElement).value });
  });

  $<HTMLInputElement>("#res-width").addEventListener("change", (event) => {
    void patchProfile({ width: Number((event.target as HTMLInputElement).value) });
  });

  $<HTMLInputElement>("#res-height").addEventListener("change", (event) => {
    void patchProfile({ height: Number((event.target as HTMLInputElement).value) });
  });

  $<HTMLInputElement>("#opt-fullscreen").addEventListener("change", (event) => {
    void patchProfile({ fullscreen: (event.target as HTMLInputElement).checked });
  });

  $("#play-button").addEventListener("click", async () => {
    const profile = activeProfile();
    if (!profile) return;

    if (!activeAccount()) {
      toast("Add an account first", true);
      switchView("accounts");
      return;
    }

    if (!profile.versionId) {
      toast("Pick a Minecraft version first", true);
      return;
    }

    const button = $<HTMLButtonElement>("#play-button");
    button.disabled = true;
    button.textContent = "Working…";

    try {
      await api.launch(profile.id);
      $("#kill-button").classList.remove("hidden");
      button.textContent = "Running";
      installed = await api.listInstalled();
      renderVersionTrigger();
    } catch (error) {
      toast(errorMessage(error), true);
      setProgress("Failed", 0, 1);
      button.disabled = false;
      button.textContent = "Play";
    }
  });

  $("#install-button").addEventListener("click", async () => {
    const profile = activeProfile();
    if (!profile?.versionId) {
      toast("Pick a Minecraft version first", true);
      return;
    }

    const button = $<HTMLButtonElement>("#install-button");
    button.setAttribute("disabled", "true");

    try {
      installed = await api.install(profile.id);
      renderVersionTrigger();
      toast(`${profile.versionId} is ready`);
    } catch (error) {
      toast(errorMessage(error), true);
    } finally {
      button.removeAttribute("disabled");
    }
  });

  $("#folder-button").addEventListener("click", () => {
    void api.openGameDir(activeProfile()?.id ?? null);
  });

  $("#kill-button").addEventListener("click", async () => {
    await api.kill();
    $("#kill-button").classList.add("hidden");
  });

  $("#log-clear").addEventListener("click", () => {
    $("#log").textContent = "";
  });

  $("#log-open").addEventListener("click", () => void api.openLogs());
}

function bindModsView(): void {
  const search = async (): Promise<void> => {
    const profile = activeProfile();
    if (!profile?.versionId) {
      toast("Pick a Minecraft version first", true);
      return;
    }

    const query = $<HTMLInputElement>("#mod-search").value.trim();
    $("#mods-results").innerHTML = '<p class="empty">Searching…</p>';

    try {
      renderResults(await api.searchMods(query, profile.versionId, profile.loader));
    } catch (error) {
      $("#mods-results").innerHTML = '<p class="empty">Search failed.</p>';
      toast(errorMessage(error), true);
    }
  };

  $("#mod-search-button").addEventListener("click", () => void search());
  $<HTMLInputElement>("#mod-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void search();
  });

  $("#mods-results").addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-install]");
    const profile = activeProfile();
    if (!target || !profile?.versionId) return;

    target.textContent = "…";
    try {
      mods = await api.installMod(profile.id, target.dataset.install ?? "", profile.versionId, profile.loader);
      renderMods();
      toast("Mod installed");
      target.textContent = "done";
    } catch (error) {
      toast(errorMessage(error), true);
      target.textContent = "install";
    }
  });

  $("#mods-installed").addEventListener("click", async (event) => {
    const element = event.target as HTMLElement;
    const profile = activeProfile();
    if (!profile) return;

    const toggle = element.closest<HTMLButtonElement>("[data-toggle]");
    if (toggle) {
      mods = await api.toggleMod(profile.id, toggle.dataset.toggle ?? "");
      renderMods();
      return;
    }

    const remove = element.closest<HTMLButtonElement>("[data-remove]");
    if (remove) {
      mods = await api.deleteMod(profile.id, remove.dataset.remove ?? "");
      renderMods();
    }
  });
}

function bindCapes(): void {
  const upload = async (variant: "classic" | "slim"): Promise<void> => {
    const account = activeAccount();
    if (!account?.licensed) return;

    try {
      await apply(api.setSkin(account.id, variant));
      toast("Skin updated");
    } catch (error) {
      toast(errorMessage(error), true);
    }
  };

  $("#skin-classic").addEventListener("click", () => void upload("classic"));
  $("#skin-slim").addEventListener("click", () => void upload("slim"));

  $("#cape-grid").addEventListener("click", async (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-cape]");
    const account = activeAccount();
    if (!card || !account?.licensed) return;

    const capeId = card.dataset.cape || null;
    try {
      await apply(api.setCape(account.id, capeId));
      toast(capeId ? "Cape applied" : "Cape removed");
    } catch (error) {
      toast(errorMessage(error), true);
    }
  });
}

function bindServers(): void {
  $("#servers-refresh").addEventListener("click", () => void refreshServers());

  $("#server-list").addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!button) return;
    await api.copy(button.dataset.copy ?? "");
    toast(`${button.dataset.copy} copied`);
  });
}

function bindReleases(): void {
  $("#releases-refresh").addEventListener("click", () => void refreshReleases(true));

  $("#channel-row").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-channel]");
    if (!button) return;

    releaseChannel = (button.dataset.channel ?? "all") as typeof releaseChannel;
    document.querySelectorAll<HTMLElement>("#channel-row [data-channel]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });

    renderReleases();
  });
}

function bindSettings(): void {
  $("#game-dir-pick").addEventListener("click", async () => {
    const folder = await api.pickFolder();
    if (!folder) return;
    await apply(api.updateSettings({ gameDir: folder }));
    installed = await api.listInstalled();
    renderVersionTrigger();
  });

  $("#java-pick").addEventListener("click", async () => {
    const path = await api.pickJava();
    if (!path) return;
    await patchProfile({ javaPath: path });
    await renderJava();
  });

  $<HTMLSelectElement>("#java-select").addEventListener("change", async (event) => {
    await patchProfile({ javaPath: (event.target as HTMLSelectElement).value || null });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-java]").forEach((button) => {
    button.addEventListener("click", async () => {
      const major = Number(button.dataset.java);
      button.textContent = "downloading…";
      try {
        const info = await api.downloadJava(major);
        toast(`Java ${info.major} installed`);
        await renderJava();
      } catch (error) {
        toast(errorMessage(error), true);
      } finally {
        button.textContent = `get java ${major}`;
        setProgress("Ready", 0, 1);
      }
    });
  });

  $<HTMLInputElement>("#azure-id").addEventListener("change", async (event) => {
    await apply(api.updateSettings({ azureClientId: (event.target as HTMLInputElement).value.trim() }));
    toast("Client ID saved");
  });

  $<HTMLInputElement>("#opt-managed-java").addEventListener("change", async (event) => {
    await apply(api.updateSettings({ managedJava: (event.target as HTMLInputElement).checked }));
  });

  $<HTMLInputElement>("#opt-snapshots").addEventListener("change", async (event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    await apply(api.updateSettings({ showSnapshots: enabled }));
    applySnapshotFilter(enabled);
    renderVersionList();
  });

  $<HTMLInputElement>("#opt-keep-open").addEventListener("change", async (event) => {
    await apply(api.updateSettings({ keepLauncherOpen: (event.target as HTMLInputElement).checked }));
  });

  $<HTMLInputElement>("#opt-telemetry").addEventListener("change", async (event) => {
    await apply(api.updateSettings({ telemetry: (event.target as HTMLInputElement).checked }));
  });

  $("#open-logs").addEventListener("click", () => void api.openLogs());
}

function applySnapshotFilter(enabled: boolean): void {
  if (enabled) typeFilters.add("snapshot");
  else typeFilters.delete("snapshot");

  document.querySelectorAll<HTMLElement>("#version-filters [data-vtype]").forEach((chip) => {
    const type = chip.dataset.vtype ?? "";
    if (type === "installed") chip.classList.toggle("on", installedOnly);
    else chip.classList.toggle("on", typeFilters.has(type));
  });
}

function renderUpdate(status: UpdateStatus): void {
  const text = $("#update-text");
  const install = $("#update-install");

  const labels: Record<UpdateStatus["state"], string> = {
    idle: `Version ${status.version}`,
    dev: `Version ${status.version} · dev build, updates disabled`,
    checking: "Checking for updates…",
    current: `Version ${status.version} · up to date`,
    downloading: `Downloading ${status.newVersion ?? ""} · ${status.percent ?? 0}%`,
    ready: `Version ${status.newVersion ?? ""} ready to install`,
    error: `Update check failed: ${status.message ?? "unknown error"}`
  };

  text.textContent = labels[status.state];
  install.classList.toggle("hidden", status.state !== "ready");
  if (status.version) $("#titlebar-version").textContent = status.version;
}

function bindUpdates(): void {
  $("#update-check").addEventListener("click", async () => {
    renderUpdate({ state: "checking", version: "" });
    renderUpdate(await api.checkUpdates());
  });

  $("#update-install").addEventListener("click", () => void api.installUpdate());

  api.onUpdateStatus((status) => renderUpdate(status));
}

function bindGameEvents(): void {
  api.onProgress((progress) => setProgress(progress.label, progress.current, progress.total));
  api.onLog((line) => appendLog(line));

  api.onExit((code) => {
    const button = $<HTMLButtonElement>("#play-button");
    button.disabled = false;
    button.textContent = "Play";
    $("#kill-button").classList.add("hidden");
    setProgress(code === 0 ? "Session ended" : `Minecraft exited with code ${code}`, 0, 1);
    appendLog(`\nprocess exited with code ${code}\n`);
  });

  api.onAuthPhase((phase) => {
    $("#auth-title").textContent = phase.phase === "browser" ? "Waiting for Microsoft" : "Almost there";
    $("#auth-text").textContent = phase.message;
  });
}

async function boot(): Promise<void> {
  bindWindowControls();
  bindNavigation();
  bindAccounts();
  bindVersionPicker();
  bindPlayView();
  bindModsView();
  bindCapes();
  bindServers();
  bindReleases();
  bindSettings();
  bindGameEvents();
  bindUpdates();

  state = await api.getState();

  try {
    loaders = await api.listLoaders();
  } catch {
    loaders = [];
  }

  renderAll();
  applySnapshotFilter(state.settings.showSnapshots);

  setProgress("Loading version list", 0, 1);

  try {
    versions = await api.listVersions();
    installed = await api.listInstalled();

    const profile = activeProfile();
    if (profile && !profile.versionId) {
      const first = versions.find((version) => version.type === "release") ?? versions[0];
      if (first) await patchProfile({ versionId: first.id });
    }

    renderVersionTrigger();
    setProgress("Ready", 0, 1);
  } catch (error) {
    setProgress("Offline — version list unavailable", 0, 1);
    toast(errorMessage(error), true);
  }

  await refreshLoaderBuilds();
  await refreshMods();
  await renderJava();

  renderUpdate(await api.updateStatus());

  if (state.accounts.length === 0) switchView("accounts");
}

void boot();
