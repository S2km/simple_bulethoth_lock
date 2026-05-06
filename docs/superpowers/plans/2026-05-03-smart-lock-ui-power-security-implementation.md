# Smart Lock UI, Power, and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-style `主页 / 设置` Mini Program structure and harden firmware boot, power, and logging behavior for a more commercial BLE smart-lock baseline.

**Architecture:** Move shared BLE/session logic into a reusable Mini Program runtime so both tabs can operate on one connection safely. Keep lock authority in firmware, but harden boot posture, first-PIN provisioning, UART/logging behavior, and idle power use without changing the existing transport stack.

**Tech Stack:** STM32 HAL on STM32F103C8T6, Keil MDK-ARM/ARMCC 5, WeChat Mini Program native BLE APIs, CommonJS utility modules, Node.js built-in test runner

---

## File Structure

### Mini Program

- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\app.json`
  Responsibility: register `主页 / 设置` pages and native tabBar.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\app.js`
  Responsibility: host shared runtime singleton and app-wide subscription hooks when needed.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.js`
  Responsibility: home-tab rendering and actions.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.json`
  Responsibility: page config.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.wxml`
  Responsibility: home-tab layout.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.wxss`
  Responsibility: home-tab styles.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.js`
  Responsibility: settings-tab rendering and configuration actions.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.json`
  Responsibility: page config.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.wxml`
  Responsibility: settings layout.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.wxss`
  Responsibility: settings styles.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\lock_runtime.js`
  Responsibility: shared BLE session manager, lock profile persistence, reducer runtime, and page subscriptions.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
  Responsibility: protocol parsing, redaction-safe command helpers, shared view-state helpers.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js`
  Responsibility: proximity state machine consistency after relock and reconnect.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`
  Responsibility: protocol parsing and helper regression tests.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js`
  Responsibility: reducer behavior regression tests.

### Firmware

- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\lock_config.h`
  Responsibility: config schema/version and provisioning rules.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c`
  Responsibility: remove universal default PIN and support unprovisioned config.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\servo_control.h`
  Responsibility: shared production/debug constants if needed.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c`
  Responsibility: boot posture, provisioning flow, log redaction, bounded UART TX, runtime power-safe control logic.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\main.c`
  Responsibility: enter low-power idle sleep between task cycles.

### Documentation

- Create: `C:\Users\S2km\Desktop\bulethoth_lock\docs\superpowers\specs\2026-05-03-smart-lock-ui-power-security-design.md`
  Responsibility: approved design for this phase.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\docs\superpowers\plans\2026-05-03-smart-lock-ui-power-security-implementation.md`
  Responsibility: execution plan for this phase.

## Task 1: Formalize the Approved Design and Execution Boundaries

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\docs\superpowers\specs\2026-05-03-smart-lock-ui-power-security-design.md`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\docs\superpowers\plans\2026-05-03-smart-lock-ui-power-security-implementation.md`

- [ ] **Step 1: Save the approved design**

Write the design doc with:

- native `tabBar` decision,
- `主页 / 设置` ownership boundaries,
- shared runtime requirement,
- firmware hardening scope,
- immediate vs deferred security items,
- verification matrix.

- [ ] **Step 2: Self-review the spec**

Verify:

- no placeholder text,
- no contradiction between UI/runtime split and firmware authority,
- deferred protocol-security work is clearly separated from this phase.

- [ ] **Step 3: Save the implementation plan**

Write the plan file with exact file paths, verification commands, and task ownership.

## Task 2: Create Shared Mini Program Runtime and Native Tab Structure

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\app.json`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\app.js`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\lock_runtime.js`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.json`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.json`

- [ ] **Step 1: Add runtime-driven page architecture**

The runtime must expose:

- `subscribe(listener)`
- `getSnapshot()`
- `init()`
- `dispose()`
- `actions` object for connect/auth/settings operations

The runtime snapshot should include:

- adapter and connection state,
- auth state,
- current device metadata,
- lock profile,
- trusted phones,
- logs,
- current RSSI,
- automation status,
- selected relock seconds,
- current angle.

- [ ] **Step 2: Register the new tab structure**

Update `app.json` so the primary page list becomes:

- `pages/home/home`
- `pages/settings/settings`
- `pages/logs/logs` only if still needed and reachable outside tab flow

Add a bottom `tabBar` for:

- `主页`
- `设置`

- [ ] **Step 3: Keep icons local and deterministic**

Use simple local tab assets stored inside the Mini Program project if icons are required by the chosen tabBar config.

- [ ] **Step 4: Move adapter startup into the runtime**

Ensure startup is called once from app/page initialization and does not duplicate BLE listeners on tab switches.

## Task 3: Split Home and Settings Responsibilities

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.js`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.wxml`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.wxss`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.js`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.wxml`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.wxss`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxss`

- [ ] **Step 1: Build the Home tab**

Home should contain:

- connection hero,
- scan/connect/disconnect,
- PIN authentication,
- `LOCK / UNLOCK`,
- compact status summaries,
- live logs,
- RSSI/automation summary.

- [ ] **Step 2: Build the Settings tab**

Settings should contain grouped sections:

- connection preferences,
- automation,
- lock security / PIN,
- trusted phones,
- lock behavior,
- maintenance controls.

- [ ] **Step 3: Remove settings overload from the old page implementation**

If `index` remains temporarily for migration, it must no longer be the active primary UX surface. The final app should route daily use through `home` and `settings`.

- [ ] **Step 4: Keep Settings actions runtime-backed**

Settings operations must call runtime actions, not duplicate BLE write logic locally.

## Task 4: Keep Protocol Parsing and Reducer Behavior Strict

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js`

- [ ] **Step 1: Preserve the existing passing parser behavior**

Keep tests for:

- `TPIN`,
- `TRUST LIST`,
- `RELOCK`,
- `STATUS ... REL=`,
- config acks,
- redacted logging assumptions.

- [ ] **Step 2: Add regression coverage for stale-state edge cases**

Add tests for:

- relock state syncing after delayed `STATUS`,
- proximity reducer returning to a clean idle/re-entry path,
- no repeated unlock after one proximity cycle until exit.

- [ ] **Step 3: Keep ack-driven state updates**

Mini Program profile mutations for:

- `BIND`,
- `UNBIND`,
- `PINSET`,
- `RELOCK`

must happen only after explicit firmware `OK` responses.

## Task 5: Harden Firmware Config and First-PIN Provisioning

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\lock_config.h`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c`

- [ ] **Step 1: Remove the universal default PIN**

Invalid or missing config must no longer become `123456`.

- [ ] **Step 2: Support an unprovisioned state**

Represent an unset PIN safely and keep relock defaults valid.

- [ ] **Step 3: Add a one-time initial provisioning path**

Support first-time setup through an explicit bootstrap form such as:

- `PINSET INIT <newPin>`

accepted only when the lock has no PIN configured.

- [ ] **Step 4: Surface unprovisioned state through status**

Firmware should expose enough machine-readable information for the Mini Program to show the owner that setup is required.

## Task 6: Harden Firmware Runtime Behavior

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\main.c`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\servo_control.h`

- [ ] **Step 1: Boot locked**

Initialize:

- servo angle to lock angle,
- logical lock state to locked.

- [ ] **Step 2: Add production-safe logging**

Implement:

- compile-time log enable/disable switch,
- command redaction for `PIN`, `PINSET`, `TPIN`,
- no raw secret-bearing command output in production logs.

- [ ] **Step 3: Bound UART TX waits**

Replace `HAL_MAX_DELAY` with bounded timeouts that still allow valid long responses such as trusted-phone lists.

- [ ] **Step 4: Enter idle sleep**

After each main-loop task cycle, use `__WFI()` or `HAL_PWR_EnterSLEEPMode(...WFI)` in a way that:

- preserves UART wake-up,
- preserves relock/auth timing,
- avoids deep-sleep side effects.

- [ ] **Step 5: Keep relock behavior correct**

Verify that auto relock still executes on time with the new sleep path.

## Task 7: Run Verification and Review Gates

**Files:**
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.js`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.js`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\main.c`

- [ ] **Step 1: Run Mini Program tests**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js'
```

- [ ] **Step 2: Run Mini Program syntax checks**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\lock_runtime.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.js'
```

- [ ] **Step 3: Rebuild firmware in Keil**

Use the existing Keil project:

- `C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx`

and confirm:

- no compile errors,
- flash size still fits the reserved app region,
- object files for updated firmware sources are rebuilt.

- [ ] **Step 4: Manual firmware behavior matrix**

Verify on hardware:

1. Power-cycle boots locked.
2. Fresh/unprovisioned device cannot unlock before provisioning.
3. First PIN can be provisioned once.
4. Provisioned PIN survives power loss.
5. Unlock still auto relocks after the configured delay.
6. Tab switching in the Mini Program does not break an active BLE session.
7. Bind/unbind/relock/PIN changes from Settings are reflected on Home.

## Self-Review

### Spec coverage

- `主页 / 设置` split: Task 2 and Task 3.
- Settings regrouping: Task 3.
- Shared runtime for tab stability: Task 2.
- Battery life hardening: Task 6.
- Boot locked and default-PIN removal: Task 5 and Task 6.
- Security-review carry-forward items: Task 4, Task 5, and Task 6.

### Placeholder scan

- No unresolved placeholders remain.
- All tasks include exact file paths and concrete verification categories.
- Manual-only hardware verification is called out explicitly where command-line evidence is not enough.

### Type consistency

- Shared runtime is the single source for page state snapshots.
- `PINSET INIT <newPin>` is reserved only for unprovisioned mode.
- Ack-driven config handling remains centered on `config_result`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-03-smart-lock-ui-power-security-implementation.md`.

Execution mode is already selected for this thread:

1. Subagent-Driven - approved by user and used for this implementation pass.
