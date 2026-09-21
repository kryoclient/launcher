# 🧩 KryoClient Addons Guide (Руководство по созданию аддонов)

_(🇷🇺 Русская версия руководства ниже)_

KryoClient features a modular Addon Engine that allows developers to extend the launcher with custom widgets, themes, integrations (e.g. Discord RPC, Server Monitors), and tools without modifying the core launcher codebase.

---

## 🏗 Addon Structure

An addon is distributed as a `.zip` archive containing at least `addon.json` and `index.js`:

```text
my-addon.zip
├── addon.json     # Manifest with metadata, permissions, and config schema
├── index.js       # Compiled ESM bundle exporting the addon lifecycle hooks
└── style.css      # (Optional) Injected CSS styles
```

### Manifest Example (`addon.json`)

```json
{
  "id": "my-cool-addon",
  "name": "My Cool Addon",
  "version": "1.0.0",
  "description": "Adds a custom widget and launch sound to the launcher.",
  "author": "YourName",
  "category": "customization",
  "permissions": ["ui:slots", "storage:local"],
  "tags": ["widget", "customization"],
  "configSchema": {
    "showWidget": {
      "type": "boolean",
      "label": "Enable Widget",
      "description": "Show the widget on the main launcher screen",
      "default": true
    }
  }
}
```

### Lifecycle & API (`src/index.js` or `src/index.tsx`)

```javascript
export function activate(context) {
  console.log("Addon activated with context:", context);

  // 1. Register a UI slot component (React component or DOM renderer)
  context.ui.registerSlot("main:hero:widget", () => {
    return React.createElement(
      "div",
      { className: "p-3 rounded-lg bg-card/60 border border-border text-xs" },
      "Hello from My Addon!",
    );
  });

  // 2. Subscribe to game launch events (requires "game:lifecycle" permission)
  if (context.game) {
    context.game.onBeforeLaunch(async (profile) => {
      console.log(`Starting Minecraft profile: ${profile.name}`);
    });
  }
}

export function deactivate() {
  console.log("Addon deactivated. Cleaning up resources...");
}

export function onConfigChange(newConfig) {
  console.log("Addon configuration updated:", newConfig);
}
```

### Discord Rich Presence (`context.discord`)

Addons cannot reach Discord themselves: its local WebSocket server only accepts
whitelisted origins, and Rich Presence runs over the `discord-ipc-0` socket,
which only the launcher core can open. Ask for the `integration:discord`
permission and hand the activity to the launcher instead — it owns connecting,
reconnecting and clearing. Requires KryoClient 2.0.1 or newer.

```javascript
await context.discord.setActivity({
  details: "Playing Minecraft 1.21.4", // top line, 2-128 characters
  state: "Steve", // second line, optional
  timestamps: { start: Math.floor(Date.now() / 1000) },
  assets: { large_image: "https://.../logo.png", large_text: "KryoClient" },
});

const status = await context.discord.getStatus();
// status.state: "idle" | "connecting" | "connected" | "unavailable"
// status.reason: "notRunning" | "refused" | "disconnected" | "activityRejected" | null
// status.error: untranslated detail; show your own text based on `reason`
const unsubscribe = context.discord.onStatusChange(console.log);
await context.discord.clearActivity();
```

Game events available through `context.events.on`: `game:launching`,
`game:started`, `game:exited` and `state:updated` (profile, version or
language changed). Read the language from
`context.game.getLauncherState().language` (`"ENGLISH"` or `"RUSSIAN"`).

---

## 🚀 How to Publish & Share Community Addons

### Option 1: Direct Sharing (No approval needed)

1. Build your addon into a `.zip` file.
2. Publish it on GitHub Releases, your Discord, or website.
3. Users can install it directly in KryoClient by clicking **"Install from URL"** or **"Install .zip"**.

### Option 2: Add to Official Store (Pull Request)

1. Fork the `kryoclient` repository.
2. Add your addon source code to `addons/src/<your-addon-id>/` (or host it in your own repo).
3. Add your addon manifest entry to [`addons/catalog.json`](./catalog.json).
4. Submit a Pull Request. Once approved and merged, your addon will automatically appear in the launcher Store for all users!

---

---

# 🇷🇺 Руководство по разработке аддонов для KryoClient

KryoClient оснащен модульным движком аддонов, который позволяет разработчикам создавать кастомные виджеты, темы оформления, интеграции (Discord RPC, мониторинг серверов, браузер модов) и хуки запуска без изменения исходного кода лаунчера.

---

## 🏗 Структура аддона

Аддон распространяется в виде `.zip` архива, содержащего `addon.json` и точку входа `index.js`:

```text
my-addon.zip
├── addon.json     # Манифест: ID, версия, запрашиваемые права и схема настроек
├── index.js       # Скомпилированный JavaScript модуль с хуками жизненного цикла
└── style.css      # (Опционально) CSS-стили, автоматически внедряемые в интерфейс
```

### 1. Манифест (`addon.json`)

```json
{
  "id": "my-cool-addon",
  "name": "Мой крутой аддон",
  "version": "1.0.0",
  "description": "Добавляет полезный виджет на главный экран лаунчера.",
  "author": "ВашНик",
  "category": "customization",
  "permissions": ["ui:slots", "storage:local"],
  "tags": ["widget", "customization"],
  "configSchema": {
    "showWidget": {
      "type": "boolean",
      "label": "Показывать виджет",
      "description": "Отображать виджет на главном экране",
      "default": true
    },
    "customText": {
      "type": "string",
      "label": "Текст виджета",
      "placeholder": "Введите текст...",
      "default": "Привет, мир!"
    }
  }
}
```

### 2. Права доступа (`permissions`)

Лаунчер изолирует возможности аддонов. Указывайте только те права, которые действительно нужны вашему модулю:

- `ui:slots` — встраивание компонентов в слоты интерфейса лаунчера.
- `game:lifecycle` — перехват параметров запуска Minecraft (JVM-аргументы, хуки до и после старта).
- `game:profiles` — доступ к имени выбранного профиля и версии игры.
- `network:fetch` — выполнение сетевых запросов к внешним API.
- `storage:local` — сохранение данных и настроек на диск.
- `fs:instances` — доступ к папкам установленных версий и скриншотам.
- `integration:discord` — управление статусом Rich Presence в профиле Discord.

### Статус в Discord (`context.discord`)

Напрямую из аддона до Discord не достучаться: локальный WebSocket-сервер Discord
принимает только доверенные origin, а Rich Presence работает через IPC-канал
(`discord-ipc-0`), доступный лишь ядру лаунчера. Поэтому аддон передаёт статус
через `context.discord`, а подключение, переподключение и очистку берёт на себя
KryoClient. Требуется право `integration:discord` и KryoClient 2.0.1 или новее.

```javascript
await context.discord.setActivity({
  details: "Играет в Minecraft 1.21.4", // верхняя строка, 2-128 символов
  state: "Ник: Steve", // нижняя строка, необязательна
  timestamps: { start: Math.floor(Date.now() / 1000) }, // счётчик времени
  assets: { large_image: "https://.../logo.png", large_text: "KryoClient" },
  buttons: [{ label: "Скачать", url: "https://example.com" }],
});

const status = await context.discord.getStatus();
// status.state: "idle" | "connecting" | "connected" | "unavailable"
// status.reason: "notRunning" | "refused" | "disconnected" | "activityRejected" | null
// status.error: подробность без перевода; свой текст показывайте по `reason`

const unsubscribe = context.discord.onStatusChange((next) => {
  console.log(next.state, next.reason, next.user, next.error);
});

await context.discord.clearActivity();
```

Статус в Discord один на весь лаунчер: его занимает тот аддон, который вызвал
`setActivity` последним. При выключении или сбое аддона лаунчер очищает статус
сам.

### События игры (`context.events`)

- `game:launching` — запуск начался, в payload `{ profileId, versionId }`.
- `game:started` — процесс Minecraft создан.
- `game:exited` — игра закрылась; `{ failed: true }`, если запуск сорвался.
- `state:updated` — выбран другой профиль, версия или язык. Язык лаунчера
  читается из `context.game.getLauncherState().language` (`"ENGLISH"` или
  `"RUSSIAN"`).

### 3. Логика аддона (`src/index.js` или `src/index.tsx`)

```javascript
export function activate(context) {
  console.log("Аддон активирован!");

  // Регистрация компонента в интерфейсе
  context.ui.registerSlot("main:hero:widget", (props) => {
    return React.createElement(
      "div",
      {
        className:
          "rounded-xl border border-primary/20 bg-primary/10 p-3 text-xs",
      },
      `Пользовательский виджет! Настройка: ${context.config.customText || ""}`,
    );
  });
}

export function deactivate() {
  console.log("Аддон отключен, очищаем ресурсы...");
}

export function onConfigChange(newConfig) {
  console.log("Настройки изменены пользователем:", newConfig);
}
```

---

## 🛠 Разработка и локальное тестирование

1. **Создайте папку аддона** в [`addons/src/<id-вашего-аддона>/`](./src).
2. **Соберите архивы:**
   ```bash
   bun run build:addons
   ```
   Скрипт автоматически соберет ESM-бандл и упакует архив в `addons/dist/<id>.zip`.
3. **Проверьте в лаунчере:**
   - Откройте окно «Аддоны» в запущенном лаунчере.
   - Нажмите **«Установить .zip»** и выберите собранный архив из `addons/dist/`.
   - Аддон запустится сразу без перезагрузки приложения!

---

## 🌐 Публикация аддонов

### Способ 1: Прямая ссылка (для собственных релизов)

- Загрузите собранный `.zip` в Releases своего GitHub-репозитория или поделитесь им в Discord.
- Пользователи смогут установить ваш аддон в один клик через кнопку **«По ссылке»** в лаунчере.

### Способ 2: Публикация в официальный каталог KryoClient Store

1. Сделайте Fork репозитория [kryoclient](https://github.com/kryoclient/launcher).
2. Добавьте запись о вашем аддоне в [`addons/catalog.json`](./catalog.json) (с ссылкой на ваш `.zip` или с исходниками в `addons/src/`).
3. Отправьте Pull Request.
4. После проверки и слияния PR ваш аддон **автоматически появится в общем каталоге у всех пользователей лаунчера**!
