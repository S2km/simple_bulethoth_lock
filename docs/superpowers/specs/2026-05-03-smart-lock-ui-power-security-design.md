# Smart Lock UI, Power, and Security Hardening Design

**Date:** 2026-05-03

**Project:**
- Firmware: `C:\Users\S2km\Desktop\bulethoth_lock\code\test`
- Mini Program: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram`

## Goal

Turn the current BLE smart-lock prototype into a more commercial first-release baseline by:

1. splitting the Mini Program into a cleaner `主页 / 设置` structure with a native bottom dock,
2. moving operational settings into a dedicated settings surface,
3. tightening firmware behavior for battery-powered use,
4. fixing the most urgent product-security problems that can be safely addressed in the current hardware and protocol envelope.

This phase is a hardening and productization pass. It preserves the already-completed features:

- multi-phone trusted list,
- auto reconnect memory,
- optional saved PIN,
- optional auto auth,
- optional RSSI proximity unlock,
- firmware-owned delayed auto relock.

## Current Problems Being Solved

### Mini Program UX problems

- The current `index` page mixes connection, unlock actions, maintenance controls, logs, security settings, automation settings, and trusted-phone management into one page.
- There is no bottom navigation, so the app does not feel like a product app yet.
- `Lock Settings` is not isolated from daily-use lock controls.

### Firmware power and reliability problems

- The MCU main loop spins continuously in `while (1)` without sleeping.
- UART TX uses `HAL_UART_Transmit(..., HAL_MAX_DELAY)`, which can stall the control loop for too long.
- Debug logging is verbose and not appropriate for a battery-powered production build.
- The current boot posture starts the lock logic in an unlocked position, which is not acceptable for a commercial lock.

### Security problems

- Invalid or missing config falls back to a predictable default PIN.
- Sensitive auth commands can be exposed in debug logs.
- The BLE protocol still uses static PIN messages without freshness protection.
- The Mini Program can persist a raw PIN locally.

The first two must be fixed now. The latter two are acknowledged as real risks, but full remediation needs a larger protocol redesign.

## Confirmed Product Direction

The user-approved direction for this phase is:

- Use the native WeChat `tabBar` as the bottom dock.
- Provide exactly two tabs:
  - `主页`
  - `设置`
- Move `Lock Settings` into `设置`.
- Keep battery life in scope because the lock is battery powered.
- Run code review and security review over both the firmware and the Mini Program.
- Continue using subagents for implementation.

## Mini Program Information Architecture

### 主页

The home tab is the daily-use surface. It should only contain the information needed to connect, authenticate, operate the lock, and understand recent behavior.

It owns:

- connection summary,
- scan/connect/disconnect actions,
- PIN auth entry,
- `LOCK / UNLOCK` primary actions,
- live lock/auth status,
- recent activity logs,
- RSSI and automation state summary.

It should not own advanced settings or long-form configuration blocks.

### 设置

The settings tab is the configuration surface. It owns all current `Lock Settings` content plus maintenance-only controls that should not be mixed with everyday unlocking.

It is grouped into these sections:

1. **Connection Preferences**
   - auto reconnect
   - per-lock auto connect memory

2. **Automation**
   - save PIN locally
   - auto auth
   - proximity unlock
   - RSSI threshold
   - live automation state

3. **Lock Security**
   - current auth state summary
   - change PIN
   - first-time PIN provisioning state when lock is unprovisioned

4. **Trusted Phones**
   - bind current phone
   - trusted phone list
   - remove trusted phone

5. **Lock Behavior**
   - auto relock seconds

6. **Maintenance**
   - servo angle controls
   - manual maintenance-only angle send

This keeps the home tab focused and makes risky or advanced operations intentionally one step farther away.

## Mini Program State Strategy

The tab split introduces one important engineering problem: both tabs must see the same BLE connection state and must be able to send commands through the active BLE session.

For this phase, the Mini Program should adopt a shared runtime module instead of duplicating BLE logic across pages.

The shared runtime owns:

- adapter lifecycle,
- scan/connect/disconnect,
- current device session,
- BLE notify listeners,
- auth countdown state,
- trusted-phone list state,
- lock profile storage,
- proximity reducer runtime,
- command send helpers,
- subscriber notifications to pages.

Each tab page becomes a thinner view/controller that:

- subscribes to runtime snapshots on show/load,
- renders derived state,
- triggers runtime actions,
- unsubscribes cleanly on unload/hide.

This is the key structural change that makes the bottom dock reliable instead of cosmetic.

## Firmware Security and Provisioning Model

### Boot posture

The lock must boot to the locked state by default.

Required behavior:

- servo angle initializes to `LOCK`,
- logical lock state initializes to `LOCK`,
- no unlock state survives reset unless a fresh authenticated unlock is sent after boot.

### Removing the universal bootstrap PIN

The firmware must stop using `123456` as a universal fallback.

For this phase, the safe implementation model is:

- invalid or missing config loads an **unprovisioned** lock state,
- the lock remains locked,
- normal `PIN` auth is unavailable until a real PIN is provisioned,
- the Mini Program may provision the first PIN through a dedicated initial path in the unprovisioned state.

To minimize scope, the existing `PINSET` command may be extended to support one explicit bootstrap form for unprovisioned locks, such as:

- `PINSET INIT <newPin>`

Rules:

- this path is accepted only when no PIN is configured,
- once a PIN is set and saved, the bootstrap path is permanently disabled until factory reset or invalidated config,
- subsequent changes continue using the normal authenticated `PINSET <oldPin> <newPin>` flow.

This removes the known universal secret without forcing a full manufacturing backend or printed per-device credential system in this phase.

### Immediate security hardening in scope now

Implement now:

- no universal default PIN,
- boot locked,
- redact sensitive logs,
- compile-time production debug gate,
- bounded UART TX timeout,
- clearer unprovisioned status reporting.

Defer to a later security phase:

- challenge/response auth,
- cryptographic trusted-phone identity,
- secure local secret storage on phone,
- explicit BLE link identity / MITM protection.

## Firmware Power Strategy

The hardware is battery powered, but this phase should use a **safe baseline** rather than an aggressive low-power redesign.

### Required now

1. **Idle sleep**
   - Main loop enters `WFI` when there is no immediate work.
   - UART RX interrupts and SysTick still wake the MCU.

2. **No busy diagnostic polling**
   - Production build disables periodic debug chatter.

3. **Bounded blocking**
   - UART transmit timeouts become bounded instead of infinite.

4. **Keep relock/auth timers working**
   - Do not suspend the system tick in this phase.
   - Use regular sleep, not deep sleep/standby.

### Explicitly out of scope for this phase

- deep sleep modes that stop timer behavior,
- wake-on-external-hardware redesign,
- HC-04 hardware state-pin rewiring,
- RTC-based low-power scheduler redesign.

This gives a measurable battery improvement without risking regressions in lock timing behavior.

## Firmware/App Synchronization Rules

The current app already depends on firmware `STATUS` responses to stay aligned with relock and lock state. This phase should make that contract explicit.

Required rules:

- Home page requests `STATUS` after connect.
- Home page requests `TRUST LIST` after connect.
- After firmware accepts `UNLOCK`, the app schedules a delayed `STATUS` sync near relock completion.
- Firmware `STATUS` remains the source of truth for:
  - lock state,
  - auth window,
  - relock seconds,
  - lockout state,
  - unprovisioned/PIN-ready state if implemented.

The app should never assume its local relock selection is authoritative after reconnect.

## Review Findings to Carry Forward

The code-review and security-review passes for this phase established these priorities:

### Must fix in this implementation pass

- remove predictable fallback PIN,
- boot locked,
- redact sensitive firmware and Mini Program logs,
- preserve relock/status sync correctness,
- keep trusted-phone state updates ack-driven,
- introduce safe low-power idle behavior.

### Should improve in this implementation pass

- move Mini Program to shared runtime for tab stability,
- keep firmware TX bounded,
- surface relock state from firmware to UI reliably,
- keep auto-unlock reducer state deterministic after relock.

### Known residual risks after this phase

- static `PIN` / `TPIN` replayability remains,
- trusted phone is still string-bound rather than cryptographically bound,
- saved PIN in local storage remains a product-risk tradeoff when enabled,
- auth invalidation still depends on transport/session limitations of the current HC-04 wiring.

These residual risks must be documented in the final delivery notes.

## Verification Standard

### Mini Program

- Home and Settings tabs both render without runtime errors.
- BLE connection survives tab switching.
- Settings actions still work from the Settings tab.
- Home status reflects firmware updates triggered from Settings.
- Auto reconnect memory still works after a successful prior connection.
- Trusted-phone list stays in sync after bind/unbind.

### Firmware

- Cold boot enters locked state.
- Unprovisioned state cannot unlock until PIN is provisioned.
- Provisioned PIN survives power loss.
- Auto relock still executes after unlock.
- `WFI` sleep path does not break UART RX or relock timing.
- Production logging no longer prints raw PIN-bearing commands.
- Keil build still succeeds within reserved flash/RAM limits.

## Implementation Recommendation

Implement this phase in two coordinated lanes:

1. **Mini Program runtime + tab split**
   - shared BLE runtime
   - `主页 / 设置` tabs
   - settings regrouping

2. **Firmware hardening**
   - boot locked
   - unprovisioned PIN model
   - debug-gated logs
   - bounded UART TX
   - idle sleep

This is the smallest change set that materially improves commercial readiness without pretending the current static-PIN BLE protocol is already production-secure.
