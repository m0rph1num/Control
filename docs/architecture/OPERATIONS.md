# Модель операций (OPERATIONS)

## OperationSnapshot (единый контракт Rust ⇄ TS)

```rust
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus { Queued, Running, Succeeded, Failed, Cancelled }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshot {
    pub id: Uuid,
    pub kind: String,                        // "protection_start", "version_install", …
    pub status: OperationStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub progress: Option<Progress>,          // { current, total, message }
    pub message: String,                     // человекочитаемо, ru
    pub revision: u64,                       // монотонный счётчик снапшота
    pub error: Option<OperationError>,       // { code, user_message, details }
    pub cancelable: bool,
}
```

`OperationError { code, user_message, details }` — коды стабильные
(`PROCESS_SPAWN_FAILED`, `TIMEOUT`, `CANCELLED`, `EXIT_CODE_NONZERO`, `IO_*`, `INVALID_PATH`, …).
`user_message` — на русском, объясняет что произошло и что делать; `details` — техническое, для диагностики.

## Правила выполнения

1. **Управляемая операция** — любой вызов, который может занять > ~300 мс. Ей сразу присваивается
   UUID, в реестр, статус `queued` → `running`. Command возвращает `id` немедленно.
2. Тело операции — Tokio task. Блокирующие вызовы (`std::process` с ожиданием, тяжёлый I/O) —
   только внутри `tokio::task::spawn_blocking` или через `tokio::process::Command`.
3. **stdout/stderr читаются параллельно** (две задачи, отдельные pipe-tasks), вывод попадает в лог
   процесса; рост логов ограничен ротацией.
4. **Кодировка**: output PowerShell/cmd ожидается в OEM-кодировке консоли (cp866 на RU-Windows).
   Runner запускает процессы с `[Console]::OutputEncoding`-агностикой: PowerShell вызовы
   обёрнуты в `$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;` где это наш
   скрипт; для стороннего вывода применяется попытка cp866 → fallback UTF-8 lossy (см. ADR-0002).
5. **Успех ≠ отсутствие исключения**: операции, которым нужен конкретный результат, проверяют
   exit code и/или постусловие (файл создан, версия отвечает, служба в статусе Running).
   Пустой stdout — не успех.
6. **Таймауты** — обязательный параметр каждой операции; по истечении — graceful kill дерева
   процессов (`taskkill /PID <pid> /T /F` по конкретному PID или Job Object), статус `failed(TIMEOUT)`.
7. **Отмена** — `operations_cancel(id)`: отменяет CancellationToken → kill дерева процессов →
   статус `cancelled`. UI обязан убрать loading по событию; нет состояний «висит навсегда».
8. **Дедупликация**: для операций с эксклюзивным ресурсом (winws, файл версии, служба) менеджер
   держит per-resource mutex. Повторный вызов того же вида при активной операции возвращает
   уже существующую операцию (`AlreadyRunning { operation_id }`) вместо запуска второй.
9. События переносят полный `OperationSnapshot` (снапшот, а не дельта) с монотонным `revision` —
   устаревшее событие не может перезаписать новое состояние в UI.
10. Никакой операции от имени UI с произвольной командой: внешние процессы запускаются только
    именованными сценариями с проверенными аргументами (см. SECURITY.md).

## Состояние защиты (protection state)

`ProtectionState::Unknown | Stopped | Starting | Active | Stopping | ExternalInstance | Error`.

- Источник истины: PID собственного spawned-процесса + (для external) путь образа через
  `QueryFullProcessImageNameW`. Приоритет: собственный экземпляр → служба zapret (sc query через
  кэш ≤2 c) → external winws по пути → unknown.
- При старте приложения — немедленная сверка факта; сохранённый `lastState` — только подсказка,
  не истина.
- Watchdog перезапуска (до 3 попыток) остаётся, но работает внутри операции `protection_start`
  и репортит прогресс.
