# Архитектура Control 2.x

Десктопное приложение для Windows: Tauri 2 + Rust в основе, React 19 в интерфейсе.
Документ описывает фактическое устройство кода, а не план.

## 1. Общая схема

```
┌─────────────────────── WebView: React 19 + TS + Vite + Tailwind 4 ────────────────────┐
│  features/*  ──экраны──▶  shared/api  ──invoke/listen──▶  IPC                          │
│  components/*  (ui, layout, fx)        shared/* (theme, sound, operations, palette)    │
└───────────────────────────────────────────┬──────────────────────────────────────────┘
                                            │ invoke / emit
┌───────────────────────────────────────────┴──────────────────────────────────────────┐
│ src-tauri: Rust + Tokio                                                              │
│  commands.rs   тонкий слой IPC: валидация входа → сервис → Result<T, AppError>        │
│  services/     операции, процессы, zapret, версии, фильтры, профили, tgws, трей…      │
│  domain/       стратегии и режимы фильтров                                            │
│  storage/      settings, atomic write, locks                                          │
│  state.rs      AppState: реестр сервисов и разделяемые блокировки                     │
│  errors.rs     AppError { code, user_message, details }                               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Правила:

- Интерфейс не знает о конкретных командах ОС: единственная точка IPC — `app/src/shared/api`.
- Rust — источник истины о процессах, файлах и статусах. UI хранит только проекцию.
- `commands.rs` не содержит бизнес-логики: он валидирует вход и вызывает сервис.
- Ошибки пересекают границу как `AppError` / `OperationError` с русским `user_message`
  и машинным `code`.

## 2. Rust: модули и ответственность

| Модуль | Ответственность |
|---|---|
| `services::operations` | Реестр операций: `OperationSnapshot` в `watch`-канале, прогресс, отмена через `CancellationToken`, блокировки по ресурсам, дедупликация |
| `services::process_runner` | Запуск внешних процессов: параллельные stdout/stderr, таймауты, kill дерева процессов |
| `services::zapret_control` | Жизненный цикл защиты: запуск `winws.exe`, остановка, watchdog, сверка реального состояния |
| `services::zapret` | Парсинг `.bat` стратегий, аргументы запуска |
| `services::zapret_service` | Служба Windows `zapret`: установка, удаление, запросы состояния |
| `services::process_scan` | Поиск `winws.exe` в системе (в том числе запущенного вне Control) |
| `services::service_query` | Кэшированный опрос службы (TTL ~2 с) |
| `services::versions` | Список установленных версий, релизы Flowseal с GitHub, загрузка и атомарная установка |
| `services::filters` | Игровой фильтр, IPSet, пользовательские списки, fake-пакеты |
| `services::profiles` | Профили: сохранение, применение, экспорт и импорт |
| `services::presets` | Пресеты мастера первого запуска |
| `services::backup` | Сборка и восстановление бандла настроек |
| `services::diagnostics` | Набор проверок системы, каждая — отдельная функция |
| `services::tgws` | MTProto-прокси для Telegram: установка, запуск, порт, логи |
| `services::autostart` | Автозапуск с Windows, запуск в свёрнутом виде |
| `services::tray` | Иконка в трее, меню, состояние защиты |
| `services::events` | `EventSink`: события в WebView и системные уведомления Windows |
| `services::elevation` | Запуск elevated-помощника (`control-elevate.exe`) |
| `services::logging` | Файловый лог с ротацией, panic hook |
| `storage::settings` | `settings.json`: чтение, атомарная запись, восстановление из `.bak` |
| `storage::atomic` | Запись через `*.tmp` + `rename`, очистка осиротевших временных файлов |
| `storage::locks` | Именованные блокировки записи |

Elevated-помощник — отдельный бинарь `src-tauri/src/bin/control-elevate.rs` с манифестом
`requireAdministrator`; основное приложение запускает его через sidecar (ADR-0001).

## 3. IPC-контракт

Команды регистрируются одним списком в `lib.rs`; их около шестидесяти, по группам:

| Группа | Примеры |
|---|---|
| Приложение | `app_info`, `startup_flags` |
| Операции | `operations_list`, `operations_cancel` |
| Защита | `protection_status`, `protection_snapshot`, `protection_start`, `protection_stop`, `protection_apply` |
| Настройки | `settings_get`, `settings_set`, `settings_update`, `flowseal_config_get/set` |
| Фильтры | `lists_get/write`, `game_filter_get/set`, `ipset_filter_get/set`, `fakes_get/set` |
| Версии | `versions_list/available/download/install/delete/select/open_folder` |
| Профили | `profiles_list`, `profile_save/delete/apply`, `profile_export_*`, `profile_import_text` |
| Служба | `service_status`, `service_install_plan`, `service_install`, `service_remove` |
| Диагностика | `diagnostics_run`, `setup_run_checks`, `setup_apply`, `setup_default_dir` |
| Резервные копии | `backup_build`, `backup_export_file`, `backup_import_file` |
| TG Proxy | `tgws_status/install/start/stop/uninstall/set_port/logs/open_telegram` |
| Автозапуск | `autostart_get`, `autostart_info`, `autostart_set` |

События: `operation://<id>` (снапшот операции с монотонным `revision`) и события статуса
защиты. Типы продублированы в `app/src/shared/api/index.ts`; соответствие проверяется
типизированным тестом контракта.

## 4. Frontend

```
app/src
├─ App.tsx                 каркас: titlebar, сайдбар, ленивые экраны, палитра
├─ features/<name>/        экран и его локальная логика
│  ├─ protection           состояние защиты и запуск/остановка
│  ├─ profiles             список профилей, редактор, применение
│  ├─ filters              игровой фильтр, IPSet, списки, fake
│  ├─ tgproxy              MTProto-прокси
│  ├─ versions             установленные версии и релизы
│  ├─ backup               экспорт и импорт
│  ├─ diagnostics          проверки системы
│  ├─ settings             поведение, оформление, папка данных, лицензии
│  ├─ setup                мастер первого запуска
│  ├─ boot                 экран загрузки
│  └─ whatsnew             модалка «Что нового»
├─ components
│  ├─ ui                   button, input, modal, select, switch, progress, skeleton, sonner
│  ├─ layout               Titlebar
│  └─ fx                   command-palette, theme-menu, scroll-area
├─ shared
│  ├─ api                  единственная точка IPC + демо-заглушки
│  ├─ theme                провайдер темы (light/dark/system), localStorage
│  ├─ operations           подписка на события операций
│  ├─ palette              источник команд палитры
│  └─ ui                   Icon, BrandMark, CloseGlyph, screen (SectionCard, ListRow, FieldLabel…)
└─ styles/global.css       токены, утилиты, анимации
```

Экраны подключаются лениво (`lazy` + `Suspense`), список разделов описан в `App.tsx`.

## 5. Данные

| Что | Где |
|---|---|
| Настройки, профили, конфигурация | `%APPDATA%\control\` |
| Логи | `%APPDATA%\control\logs\control.log` |
| Версии Zapret | `C:\Control\` или папка, выбранная в настройках |
| Списки и fakes | папка активной версии Zapret |

Пути совместимы с Control 1.0.1, поэтому обновление поверх не теряет данные.
Подробности — `STORAGE.md`.

## 6. Безопасность

- Ни одна команда не принимает произвольную строку для запуска: аргументы собираются
  из проверенных значений, пути валидируются (см. `SECURITY.md`).
- Elevated-операции вынесены в отдельный процесс с манифестом администратора.
- CSP запрещает внешние скрипты и медиа; сеть используется только для GitHub и Telegram API.

## 7. Решения

| ADR | Тема |
|---|---|
| [0001](../decisions/ADR-0001-elevation.md) | Elevated-помощник и UAC |
| [0002](../decisions/ADR-0002-process-and-powershell.md) | Процессы и кодировки |
| [0003](../decisions/ADR-0003-storage.md) | Хранение и атомарная запись |
| [0004](../decisions/ADR-0004-service.md) | Служба Windows |
| [0005](../decisions/ADR-0005-testing.md) | Стратегия тестирования |
