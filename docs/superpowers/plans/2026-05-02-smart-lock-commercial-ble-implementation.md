# Smart Lock Commercial BLE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement persistent multi-phone BLE lock control with configurable auto relock, trusted-phone binding, optional saved-PIN auto-auth, and guarded RSSI-based proximity unlock across the STM32 firmware and WeChat Mini Program.

**Architecture:** Keep lock authority in firmware and keep proximity decision logic in the Mini Program. Split the firmware into a persistence helper plus command/state orchestration, and split Mini Program pure logic into protocol helpers and a proximity state reducer so most risky behavior is testable before page integration.

**Tech Stack:** STM32 HAL on STM32F103C8T6, Keil uVision project XML, Flash page persistence, WeChat Mini Program native BLE APIs, CommonJS helpers, Node.js built-in test runner

---

## File Structure

### Firmware

- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\lock_config.h`
  Responsibility: persistent lock config types, constants, and persistence API.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c`
  Responsibility: dual-page Flash load/save, checksum verification, trusted-phone CRUD helpers, default config recovery.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\servo_control.h`
  Responsibility: keep the public control API aligned if config helpers need exposure.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c`
  Responsibility: command parsing, auth modes, relock timer, trusted-phone flows, config save/load integration.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx`
  Responsibility: reserve the top two Flash pages and register `lock_config.c` in the Keil project.

### Mini Program

- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
  Responsibility: protocol command builders, response parsing, trusted-phone list mapping, per-lock profile helpers, relock settings helpers.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js`
  Responsibility: pure proximity state reducer and anti-repeat gating logic.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`
  Responsibility: protocol and profile helper regression tests.
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js`
  Responsibility: guarded RSSI hold, one-shot unlock, and cooldown tests.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`
  Responsibility: BLE orchestration, per-lock storage, trusted-phone settings actions, RSSI polling, proximity runtime.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
  Responsibility: settings UI, trusted-phone list, relock controls, RSSI indicators.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxss`
  Responsibility: settings card layout and trusted-phone management styling.

### Constraint Note

The current hardware leaves the HC-04 `STATE` pin unconnected, so the firmware cannot truly detect BLE transport disconnect in real time. This release therefore relies on:

- short auth windows,
- firmware auto relock,
- Mini Program disconnect cleanup,
- stale-command prevention in the app.

That limitation must stay explicit during implementation and verification.

### Task 1: Expand Mini Program Protocol and Profile Helpers

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`

- [ ] **Step 1: Write the failing helper tests**

Add these imports and tests to `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`:

```javascript
const {
  buildBindCommand,
  buildPinSetCommand,
  buildRelockCommand,
  buildTrustedPinCommand,
  buildTrustedPhoneListView,
  buildUnbindCommand,
  createDefaultLockProfile,
  mergeLockProfile,
  normalizeClientId,
  normalizeNickname,
  parseLockResponse,
} = require('../miniprogram/utils/servo_helpers')

test('normalizeClientId uppercases and strips surrounding whitespace', () => {
  assert.equal(normalizeClientId(' phone-a '), 'PHONE-A')
})

test('normalizeNickname converts internal spaces to underscores for protocol safety', () => {
  assert.equal(normalizeNickname('Alice One'), 'Alice_One')
})

test('buildTrustedPinCommand formats trusted-phone auth command', () => {
  assert.equal(buildTrustedPinCommand('phone-a', '123456'), 'TPIN PHONE-A 123456\n')
})

test('buildPinSetCommand formats pin change command', () => {
  assert.equal(buildPinSetCommand('123456', '654321'), 'PINSET 123456 654321\n')
})

test('buildBindCommand formats trusted-phone bind command', () => {
  assert.equal(buildBindCommand('phone-a', 'Alice One'), 'BIND PHONE-A Alice_One\n')
})

test('buildUnbindCommand formats trusted-phone unbind command', () => {
  assert.equal(buildUnbindCommand('phone-a'), 'UNBIND PHONE-A\n')
})

test('buildRelockCommand limits relock values to approved options', () => {
  assert.equal(buildRelockCommand(8), 'RELOCK 8\n')
})

test('parseLockResponse reads trusted-phone auth success', () => {
  assert.deepEqual(parseLockResponse('TPIN OK 30'), {
    kind: 'trusted_auth_ok',
    remainingSeconds: 30,
    action: '',
    message: 'Trusted phone authorized for 30 seconds',
  })
})

test('parseLockResponse reads trusted-phone denial for unknown client', () => {
  assert.deepEqual(parseLockResponse('TPIN DENY UNKNOWN_CLIENT'), {
    kind: 'trusted_auth_deny',
    remainingSeconds: 0,
    action: '',
    reason: 'UNKNOWN_CLIENT',
    message: 'Trusted phone is not bound to this lock',
  })
})

test('parseLockResponse reads trusted-phone list payloads', () => {
  assert.deepEqual(parseLockResponse('TRUST LIST PHONEA|Alice|1;PHONEB|Bob|0'), {
    kind: 'trust_list',
    remainingSeconds: 0,
    action: '',
    message: 'Trusted phone list received',
    phones: [
      { clientId: 'PHONEA', nickname: 'Alice', enabled: true },
      { clientId: 'PHONEB', nickname: 'Bob', enabled: false },
    ],
  })
})

test('createDefaultLockProfile returns safe local defaults', () => {
  assert.deepEqual(createDefaultLockProfile('dev-1', 'HC-04BLE'), {
    deviceId: 'dev-1',
    deviceName: 'HC-04BLE',
    clientId: '',
    nickname: '',
    savedPin: '',
    autoConnect: true,
    autoAuth: false,
    proximityUnlock: false,
    rssiThreshold: -60,
    relockSeconds: 5,
  })
})

test('mergeLockProfile preserves defaults while applying updates', () => {
  const profile = mergeLockProfile(createDefaultLockProfile('dev-1', 'HC-04BLE'), {
    clientId: 'PHONEA',
    autoAuth: true,
  })

  assert.equal(profile.clientId, 'PHONEA')
  assert.equal(profile.autoAuth, true)
  assert.equal(profile.autoConnect, true)
  assert.equal(profile.relockSeconds, 5)
})

test('buildTrustedPhoneListView marks the current phone in the trusted list', () => {
  const result = buildTrustedPhoneListView(
    [
      { clientId: 'PHONEA', nickname: 'Alice', enabled: true },
      { clientId: 'PHONEB', nickname: 'Bob', enabled: false },
    ],
    'PHONEB',
  )

  assert.deepEqual(result[1], {
    clientId: 'PHONEB',
    nickname: 'Bob',
    enabled: false,
    isCurrentPhone: true,
    statusText: 'Disabled on lock',
  })
})
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
```

Expected:

```text
FAIL
ReferenceError or AssertionError for the new command builders, profile helpers, and trust-list parsing
```

- [ ] **Step 3: Implement the minimal helper additions**

Add these functions to `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js` and export them:

```javascript
function normalizeClientId(value) {
  return String(value || '').trim().toUpperCase()
}

function normalizeNickname(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 20)
}

function buildTrustedPinCommand(clientId, pin) {
  return `TPIN ${normalizeClientId(clientId)} ${String(pin || '').trim()}\n`
}

function buildPinSetCommand(oldPin, newPin) {
  return `PINSET ${String(oldPin || '').trim()} ${String(newPin || '').trim()}\n`
}

function buildBindCommand(clientId, nickname) {
  return `BIND ${normalizeClientId(clientId)} ${normalizeNickname(nickname)}\n`
}

function buildUnbindCommand(clientId) {
  return `UNBIND ${normalizeClientId(clientId)}\n`
}

function buildRelockCommand(seconds) {
  const allowed = [3, 5, 8, 10]
  const numeric = Number(seconds)
  const selected = allowed.includes(numeric) ? numeric : 5
  return `RELOCK ${selected}\n`
}

function createDefaultLockProfile(deviceId, deviceName) {
  return {
    deviceId: String(deviceId || ''),
    deviceName: String(deviceName || ''),
    clientId: '',
    nickname: '',
    savedPin: '',
    autoConnect: true,
    autoAuth: false,
    proximityUnlock: false,
    rssiThreshold: -60,
    relockSeconds: 5,
  }
}

function mergeLockProfile(profile, patch) {
  return {
    ...createDefaultLockProfile(profile && profile.deviceId, profile && profile.deviceName),
    ...(profile || {}),
    ...(patch || {}),
  }
}

function buildTrustedPhoneListView(phones, currentClientId) {
  return (Array.isArray(phones) ? phones : []).map((item) => ({
    ...item,
    isCurrentPhone: item.clientId === normalizeClientId(currentClientId),
    statusText: item.enabled ? 'Enabled on lock' : 'Disabled on lock',
  }))
}
```

Extend `parseLockResponse` with:

```javascript
const trustedAuthOkMatch = normalized.match(/^TPIN OK (\d+)$/)
const trustedAuthDenyMatch = normalized.match(/^TPIN DENY ([A-Z_]+)$/)
const trustListMatch = normalized.match(/^TRUST LIST\s*(.*)$/)

if (trustedAuthOkMatch) {
  const remainingSeconds = Number(trustedAuthOkMatch[1])
  return {
    kind: 'trusted_auth_ok',
    remainingSeconds,
    action: '',
    message: `Trusted phone authorized for ${remainingSeconds} seconds`,
  }
}

if (trustedAuthDenyMatch) {
  const reason = trustedAuthDenyMatch[1]
  return {
    kind: 'trusted_auth_deny',
    remainingSeconds: 0,
    action: '',
    reason,
    message: reason === 'UNKNOWN_CLIENT' ? 'Trusted phone is not bound to this lock' : 'Trusted phone authorization failed',
  }
}

if (trustListMatch) {
  const payload = String(trustListMatch[1] || '').trim()
  const phones = payload
    ? payload.split(';').filter(Boolean).map((row) => {
        const [clientId, nickname, enabled] = row.split('|')
        return {
          clientId: normalizeClientId(clientId),
          nickname: String(nickname || ''),
          enabled: enabled === '1',
        }
      })
    : []
  return {
    kind: 'trust_list',
    remainingSeconds: 0,
    action: '',
    message: 'Trusted phone list received',
    phones,
  }
}
```

- [ ] **Step 4: Run the helper tests and syntax check**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js'
```

Expected:

```text
All tests pass
No syntax errors
```

### Task 2: Add a Pure Proximity State Reducer

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js`

- [ ] **Step 1: Write the failing proximity tests**

Create `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js`:

```javascript
const test = require('node:test')
const assert = require('node:assert/strict')

const { createProximityState, reduceProximityState } = require('../miniprogram/utils/proximity_helpers')

function makeInput(overrides = {}) {
  return {
    nowMs: 0,
    isConnected: true,
    isTrusted: true,
    autoAuthEnabled: true,
    proximityUnlockEnabled: true,
    hasSavedPin: true,
    lockState: 'LOCK',
    rssi: -55,
    threshold: -60,
    authSucceeded: false,
    authFailed: false,
    disconnected: false,
    ...overrides,
  }
}

test('continuous hold is required before requesting trusted auto auth', () => {
  let state = createProximityState()
  let result = reduceProximityState(state, makeInput({ nowMs: 0 }))
  assert.equal(result.action, 'none')

  result = reduceProximityState(result.state, makeInput({ nowMs: 1500 }))
  assert.equal(result.action, 'none')

  result = reduceProximityState(result.state, makeInput({ nowMs: 2100 }))
  assert.equal(result.action, 'request_trusted_auth')
})

test('one strong sample below hold time does not trigger auth', () => {
  const result = reduceProximityState(createProximityState(), makeInput({ nowMs: 500 }))
  assert.equal(result.action, 'none')
})

test('auth success triggers exactly one unlock request', () => {
  let state = createProximityState()
  state = reduceProximityState(state, makeInput({ nowMs: 2100 })).state
  const result = reduceProximityState(state, makeInput({ nowMs: 2200, authSucceeded: true }))
  assert.equal(result.action, 'request_unlock')

  const repeat = reduceProximityState(result.state, makeInput({ nowMs: 2300, authSucceeded: true }))
  assert.equal(repeat.action, 'none')
})

test('remaining above threshold after one unlock keeps cooldown active until exit', () => {
  let state = createProximityState()
  state = reduceProximityState(state, makeInput({ nowMs: 2100 })).state
  state = reduceProximityState(state, makeInput({ nowMs: 2200, authSucceeded: true })).state
  const sameZone = reduceProximityState(state, makeInput({ nowMs: 7000, lockState: 'LOCK' }))
  assert.equal(sameZone.action, 'none')

  const exited = reduceProximityState(sameZone.state, makeInput({ nowMs: 7200, rssi: -72 }))
  const reentered = reduceProximityState(exited.state, makeInput({ nowMs: 9400, rssi: -55 }))
  assert.equal(reentered.action, 'request_trusted_auth')
})

test('disconnect clears the active proximity session', () => {
  let state = createProximityState()
  state = reduceProximityState(state, makeInput({ nowMs: 2100 })).state
  const result = reduceProximityState(state, makeInput({ nowMs: 2150, disconnected: true, isConnected: false }))
  assert.equal(result.state.phase, 'idle')
  assert.equal(result.action, 'none')
})
```

- [ ] **Step 2: Run the proximity tests to verify they fail**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js'
```

Expected:

```text
FAIL
Cannot find module '../miniprogram/utils/proximity_helpers'
```

- [ ] **Step 3: Implement the minimal reducer**

Create `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js`:

```javascript
function createProximityState() {
  return {
    phase: 'idle',
    holdStartedAt: 0,
    unlockSent: false,
    requiresExit: false,
  }
}

function shouldReset(input) {
  return (
    input.disconnected ||
    !input.isConnected ||
    !input.isTrusted ||
    !input.autoAuthEnabled ||
    !input.proximityUnlockEnabled ||
    !input.hasSavedPin
  )
}

function reduceProximityState(state, input) {
  if (shouldReset(input)) {
    return { state: createProximityState(), action: 'none' }
  }

  const current = state || createProximityState()
  const aboveThreshold = Number(input.rssi) >= Number(input.threshold)

  if (!aboveThreshold) {
    return {
      state: {
        ...current,
        phase: 'idle',
        holdStartedAt: 0,
        requiresExit: false,
      },
      action: 'none',
    }
  }

  if (current.requiresExit) {
    return { state: current, action: 'none' }
  }

  if (current.phase === 'idle') {
    return {
      state: { ...current, phase: 'observing', holdStartedAt: input.nowMs },
      action: 'none',
    }
  }

  if (current.phase === 'observing' && (input.nowMs - current.holdStartedAt) >= 2000) {
    return {
      state: { ...current, phase: 'auth_pending' },
      action: 'request_trusted_auth',
    }
  }

  if (current.phase === 'auth_pending' && input.authSucceeded && !current.unlockSent && input.lockState === 'LOCK') {
    return {
      state: { ...current, phase: 'cooldown', unlockSent: true, requiresExit: true },
      action: 'request_unlock',
    }
  }

  if (current.phase === 'auth_pending' && input.authFailed) {
    return {
      state: { ...current, phase: 'idle', holdStartedAt: 0 },
      action: 'none',
    }
  }

  return { state: current, action: 'none' }
}

module.exports = {
  createProximityState,
  reduceProximityState,
}
```

- [ ] **Step 4: Run the proximity tests and syntax check**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js'
```

Expected:

```text
All tests pass
No syntax errors
```

### Task 3: Add Persistent Lock Config Storage in Firmware

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\lock_config.h`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx`

- [ ] **Step 1: Record the current failing firmware persistence behavior**

Use this red-state checklist before editing:

```text
Current failing behavior:
1. PIN changes cannot survive power loss because PIN is compiled into servo_control.c.
2. Auto relock seconds cannot be changed or persisted.
3. Trusted phones cannot be stored.
4. Flash pages are not reserved for app-owned config.
```

- [ ] **Step 2: Reserve the top two flash pages and register the new source file**

In `C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx`, shrink the application IROM size from `0x10000` to `0xF800` in both places:

```xml
<IROM>
  <Type>1</Type>
  <StartAddress>0x8000000</StartAddress>
  <Size>0xF800</Size>
</IROM>
```

```xml
<OCR_RVCT4>
  <Type>1</Type>
  <StartAddress>0x8000000</StartAddress>
  <Size>0xF800</Size>
</OCR_RVCT4>
```

Add the new source under `Application/User/Core`:

```xml
<File>
  <FileName>lock_config.c</FileName>
  <FileType>1</FileType>
  <FilePath>../Core/Src/lock_config.c</FilePath>
</File>
```

- [ ] **Step 3: Create the config header with durable types and limits**

Create `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\lock_config.h`:

```c
#ifndef __LOCK_CONFIG_H__
#define __LOCK_CONFIG_H__

#include "main.h"

#define LOCK_CONFIG_MAGIC                0x4C434647UL
#define LOCK_CONFIG_VERSION              1U
#define LOCK_CONFIG_PAGE_A_ADDRESS       0x0800F800UL
#define LOCK_CONFIG_PAGE_B_ADDRESS       0x0800FC00UL
#define LOCK_MAX_PIN_LENGTH              11U
#define LOCK_MAX_CLIENT_ID_LENGTH        32U
#define LOCK_MAX_NICKNAME_LENGTH         20U
#define LOCK_MAX_TRUSTED_PHONES          5U

typedef struct
{
  uint8_t enabled;
  char clientId[LOCK_MAX_CLIENT_ID_LENGTH + 1U];
  char nickname[LOCK_MAX_NICKNAME_LENGTH + 1U];
} LockTrustedPhoneRecord;

typedef struct
{
  char pin[LOCK_MAX_PIN_LENGTH + 1U];
  uint8_t relockSeconds;
  LockTrustedPhoneRecord phones[LOCK_MAX_TRUSTED_PHONES];
} LockConfigData;

void LockConfig_SetDefaults(LockConfigData *config);
uint8_t LockConfig_Load(LockConfigData *config);
HAL_StatusTypeDef LockConfig_Save(const LockConfigData *config);
int8_t LockConfig_FindPhone(const LockConfigData *config, const char *clientId);
uint8_t LockConfig_UpsertPhone(LockConfigData *config, const char *clientId, const char *nickname, uint8_t *slotOut);
uint8_t LockConfig_RemovePhone(LockConfigData *config, const char *clientId);

#endif
```

- [ ] **Step 4: Create the dual-page Flash implementation**

Create `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c` around a versioned image:

```c
typedef struct
{
  uint32_t magic;
  uint16_t version;
  uint16_t sequence;
  uint32_t checksum;
  LockConfigData data;
} LockConfigImage;

static uint32_t LockConfig_ComputeChecksum(const LockConfigImage *image);
static uint8_t LockConfig_IsImageValid(const LockConfigImage *image);
static HAL_StatusTypeDef LockConfig_WritePage(uint32_t pageAddress, const LockConfigImage *image);
```

Implement defaults and save/load rules:

```c
void LockConfig_SetDefaults(LockConfigData *config)
{
  memset(config, 0, sizeof(*config));
  strcpy(config->pin, "123456");
  config->relockSeconds = 5U;
}

uint8_t LockConfig_Load(LockConfigData *config)
{
  const LockConfigImage *pageA = (const LockConfigImage *)LOCK_CONFIG_PAGE_A_ADDRESS;
  const LockConfigImage *pageB = (const LockConfigImage *)LOCK_CONFIG_PAGE_B_ADDRESS;
  const LockConfigImage *selected = NULL;

  if (LockConfig_IsImageValid(pageA) && LockConfig_IsImageValid(pageB)) {
    selected = (pageA->sequence >= pageB->sequence) ? pageA : pageB;
  } else if (LockConfig_IsImageValid(pageA)) {
    selected = pageA;
  } else if (LockConfig_IsImageValid(pageB)) {
    selected = pageB;
  }

  if (selected == NULL) {
    LockConfig_SetDefaults(config);
    return 0U;
  }

  memcpy(config, &selected->data, sizeof(*config));
  return 1U;
}
```

- [ ] **Step 5: Build in Keil and verify the module is part of the project**

Open `C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx` in uVision and build the `test` target.

Expected:

```text
lock_config.c is compiled
No duplicate symbol errors
No flash region overflow into the reserved top two pages
```

### Task 4: Extend Firmware Protocol, Auth Modes, and Auto Relock

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Inc\servo_control.h`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c`
- Read-only context: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\main.c`

- [ ] **Step 1: Expand the parsed command model and runtime state**

In `servo_control.c`, increase the UART command capacity and add auth-mode state:

```c
#define SERVO_COMMAND_BUFFER_SIZE        96U

typedef enum
{
  SERVO_COMMAND_NONE = 0,
  SERVO_COMMAND_PIN,
  SERVO_COMMAND_TPIN,
  SERVO_COMMAND_PINSET,
  SERVO_COMMAND_BIND,
  SERVO_COMMAND_UNBIND,
  SERVO_COMMAND_TRUST_LIST,
  SERVO_COMMAND_RELOCK,
  SERVO_COMMAND_LOCK,
  SERVO_COMMAND_UNLOCK,
  SERVO_COMMAND_STATUS,
  SERVO_COMMAND_ANGLE
} ServoCommandType;

typedef enum
{
  SERVO_AUTH_MODE_NONE = 0,
  SERVO_AUTH_MODE_MANUAL,
  SERVO_AUTH_MODE_TRUSTED
} ServoAuthMode;

typedef struct
{
  ServoCommandType type;
  uint8_t angle;
  uint8_t relockSeconds;
  char pin[12];
  char newPin[12];
  char clientId[33];
  char nickname[21];
} ServoParsedCommand;
```

Update `ServoUartChannel`:

```c
char rxBuffer[SERVO_COMMAND_BUFFER_SIZE];
char commandBuffer[SERVO_COMMAND_BUFFER_SIZE];
```

Add globals:

```c
static LockConfigData servoConfig;
static ServoAuthMode servoAuthMode;
static char servoAuthorizedClientId[33];
static uint8_t servoRelockArmed;
static uint32_t servoRelockDeadlineTick;
```

- [ ] **Step 2: Load defaults/config and arm relock support during init**

At the top of `ServoControl_Init`, after UART/timer references are saved:

```c
uint8_t loaded = LockConfig_Load(&servoConfig);
servoAuthMode = SERVO_AUTH_MODE_NONE;
memset(servoAuthorizedClientId, 0, sizeof(servoAuthorizedClientId));
servoRelockArmed = 0U;
servoRelockDeadlineTick = 0U;

if (loaded == 0U)
{
  (void)LockConfig_Save(&servoConfig);
  ServoControl_DebugPrint("DBG config defaulted and saved\r\n");
}
```

- [ ] **Step 3: Parse the new commands**

Extend `ServoControl_ParseCommand` to support:

```text
PIN <pin>
TPIN <clientId> <pin>
PINSET <oldPin> <newPin>
BIND <clientId> <nickname>
UNBIND <clientId>
TRUST LIST
RELOCK <3|5|8|10>
LOCK
UNLOCK
STATUS
A<angle>
```

Use small manual token extraction helpers instead of `sscanf`. The `TRUST LIST` branch should require the exact two-token sequence:

```c
if ((cursor[0] == 'T') && ... && strcmp(cursor, "TRUST LIST") == 0)
{
  parsed->type = SERVO_COMMAND_TRUST_LIST;
  return 1U;
}
```

- [ ] **Step 4: Implement trusted auth, PIN change, bind/unbind, trust-list, and relock handlers**

Add handlers with these rules:

```c
static void ServoControl_RefreshAuthorization(ServoAuthMode mode, const char *clientId);
static void ServoControl_HandleTrustedPinCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandlePinSetCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleBindCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleUnbindCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleTrustListCommand(ServoUartChannel *channel);
static void ServoControl_HandleRelockCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
```

Trusted auth must:

```c
if (LockConfig_FindPhone(&servoConfig, parsed->clientId) < 0)
{
  ServoControl_SendText(channel, "TPIN DENY UNKNOWN_CLIENT\r\n");
  return;
}

if (strcmp(parsed->pin, servoConfig.pin) != 0)
{
  ServoControl_SendText(channel, "AUTH FAIL 1\r\n");
  return;
}

ServoControl_RefreshAuthorization(SERVO_AUTH_MODE_TRUSTED, parsed->clientId);
ServoControl_SendText(channel, "TPIN OK 30\r\n");
```

PIN change must require fresh manual auth:

```c
if (servoAuthMode != SERVO_AUTH_MODE_MANUAL)
{
  ServoControl_SendText(channel, "PINSET FAIL\r\n");
  return;
}

if (strcmp(parsed->pin, servoConfig.pin) != 0)
{
  ServoControl_SendText(channel, "PINSET FAIL\r\n");
  return;
}

strcpy(servoConfig.pin, parsed->newPin);
if (LockConfig_Save(&servoConfig) == HAL_OK) {
  ServoControl_SendText(channel, "PINSET OK\r\n");
} else {
  ServoControl_SendText(channel, "PINSET FAIL\r\n");
}
```

- [ ] **Step 5: Add firmware-owned auto relock timing**

Add relock helpers:

```c
static void ServoControl_ArmRelock(uint8_t seconds)
{
  servoRelockArmed = 1U;
  servoRelockDeadlineTick = HAL_GetTick() + ((uint32_t)seconds * 1000UL);
}

static void ServoControl_CancelRelock(void)
{
  servoRelockArmed = 0U;
  servoRelockDeadlineTick = 0U;
}
```

Use them in action handling:

```c
case SERVO_COMMAND_UNLOCK:
  ServoControl_SetLockedState(1U);
  ServoControl_ArmRelock(servoConfig.relockSeconds);
  ServoControl_SendText(channel, "ACTION OK UNLOCK\r\n");
  break;

case SERVO_COMMAND_LOCK:
  ServoControl_CancelRelock();
  ServoControl_SetLockedState(0U);
  ServoControl_SendText(channel, "ACTION OK LOCK\r\n");
  break;
```

In `ServoControl_Task()`:

```c
if (servoRelockArmed != 0U && (int32_t)(HAL_GetTick() - servoRelockDeadlineTick) >= 0)
{
  ServoControl_CancelRelock();
  ServoControl_SetLockedState(0U);
  ServoControl_DebugPrint("DBG auto relock executed\r\n");
}
```

- [ ] **Step 6: Manually verify the firmware behavior matrix**

Build and flash the board, then verify:

```text
1. STATUS after boot includes REL=5 when defaults are used.
2. PINSET changes PIN and the new PIN still works after reboot.
3. BIND PHONEA Alice stores a trusted phone and survives reboot.
4. TPIN PHONEA <pin> works after reboot.
5. UNBIND PHONEA revokes TPIN for that phone.
6. RELOCK 8 survives reboot.
7. UNLOCK relocks automatically after the configured delay even if the phone disconnects.
```

### Task 5: Add Mini Program Settings and Trusted-Phone Management

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxss`
- Reuse: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`

- [ ] **Step 1: Add per-lock profile state to the page**

In `index.js`, extend `data` with:

```javascript
lockProfile: null,
trustedPhones: [],
trustedPhoneView: [],
currentClientId: '',
bindNickname: '',
newPin: '',
newPinConfirm: '',
selectedRelockSeconds: 5,
currentRssi: null,
automationStateLabel: 'Automation idle',
```

Add storage helpers:

```javascript
const LOCK_PROFILE_MAP_KEY = 'ble-lock-profile-map'

loadLockProfile(deviceId, deviceName) {
  const map = wx.getStorageSync(LOCK_PROFILE_MAP_KEY) || {}
  return mergeLockProfile(createDefaultLockProfile(deviceId, deviceName), map[deviceId] || {})
}

saveLockProfile(patch) {
  const current = this.data.lockProfile || createDefaultLockProfile(this.data.deviceId, this.data.deviceName)
  const next = mergeLockProfile(current, patch)
  const map = wx.getStorageSync(LOCK_PROFILE_MAP_KEY) || {}
  map[next.deviceId] = next
  wx.setStorageSync(LOCK_PROFILE_MAP_KEY, map)
  this.setData({ lockProfile: next })
  return next
}
```

- [ ] **Step 2: Add bind, unbind, relock, and PIN change actions**

Add methods in `index.js`:

```javascript
async handleBindTap() {
  const profile = this.data.lockProfile || {}
  const clientId = profile.clientId || `PHONE-${Date.now().toString(16).toUpperCase()}`
  const nickname = this.data.bindNickname || 'MyPhone'
  const sent = await this.writeCommand(buildBindCommand(clientId, nickname))
  if (sent) {
    this.saveLockProfile({ clientId: normalizeClientId(clientId), nickname: normalizeNickname(nickname) })
  }
}

async handleChangePinTap() {
  const profile = this.data.lockProfile || {}
  const command = buildPinSetCommand(profile.savedPin, this.data.newPin)
  await this.writeCommand(command)
}

async handleRelockTap(event) {
  const seconds = Number(event.currentTarget.dataset.seconds)
  await this.writeCommand(buildRelockCommand(seconds))
}

async handleUnbindTap(event) {
  const clientId = event.currentTarget.dataset.clientId
  await this.writeCommand(buildUnbindCommand(clientId))
}
```

- [ ] **Step 3: Extend BLE response handling for the new protocol**

In `handleBleValueChange(result)`, after `parseLockResponse(text)`:

```javascript
case 'trusted_auth_ok':
  this.startAuthCountdown(response.remainingSeconds)
  this.setData({ automationStateLabel: 'Trusted phone authorized' })
  break
case 'trusted_auth_deny':
  this.setData({ automationStateLabel: response.message })
  break
case 'trust_list':
  this.setData({
    trustedPhones: response.phones,
    trustedPhoneView: buildTrustedPhoneListView(response.phones, this.data.lockProfile && this.data.lockProfile.clientId),
  })
  break
case 'unknown':
  if (response.message === 'PINSET OK') {
    this.saveLockProfile({ savedPin: this.data.newPin })
  }
  break
```

- [ ] **Step 4: Add settings markup for trusted phones and relock choices**

In `index.wxml`, add a settings panel:

```xml
<view class="panel settings-panel">
  <view class="panel-header">
    <view class="panel-title">Lock Settings</view>
    <view class="status-pill neutral">{{selectedRelockSeconds}} sec relock</view>
  </view>

  <view class="switch-row">
    <text class="switch-label">Auto connect</text>
    <switch checked="{{lockProfile.autoConnect}}" bindchange="handleAutoConnectProfileToggle" color="#0b72ff" />
  </view>
  <view class="switch-row">
    <text class="switch-label">Save PIN locally</text>
    <switch checked="{{!!lockProfile.savedPin}}" bindchange="handleSavePinToggle" color="#0b72ff" />
  </view>
  <view class="switch-row">
    <text class="switch-label">Auto auth</text>
    <switch checked="{{lockProfile.autoAuth}}" bindchange="handleAutoAuthToggle" color="#0b72ff" />
  </view>

  <view class="preset-grid relock-grid">
    <button class="preset-button" data-seconds="3" bindtap="handleRelockTap">3 sec</button>
    <button class="preset-button" data-seconds="5" bindtap="handleRelockTap">5 sec</button>
    <button class="preset-button" data-seconds="8" bindtap="handleRelockTap">8 sec</button>
    <button class="preset-button" data-seconds="10" bindtap="handleRelockTap">10 sec</button>
  </view>

  <view class="device-section">
    <view class="device-title">Trusted Phones</view>
    <view wx:for="{{trustedPhoneView}}" wx:key="clientId" class="trusted-phone-item">
      <view>
        <view class="device-name">{{item.nickname}}</view>
        <view class="device-id">{{item.clientId}}</view>
      </view>
      <button class="text-button" data-client-id="{{item.clientId}}" bindtap="handleUnbindTap">Remove</button>
    </view>
  </view>
</view>
```

- [ ] **Step 5: Add supporting settings styles**

In `index.wxss`, add:

```css
.settings-panel {
  border-color: #d7e4f8;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
}

.trusted-phone-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 18rpx 0;
  border-bottom: 1px solid #e7eff9;
}

.relock-grid .preset-button {
  flex: 0 0 calc((100% - 48rpx) / 4);
  width: calc((100% - 48rpx) / 4);
}
```

- [ ] **Step 6: Run Mini Program tests and syntax checks**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js'
```

Expected:

```text
Helper tests still pass
No syntax errors in index.js
```

### Task 6: Integrate Live RSSI Polling and Proximity Unlock Runtime

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
- Reuse: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js`

- [ ] **Step 1: Add runtime timers and reducer state**

In `onLoad()`:

```javascript
this.proximityState = createProximityState()
this.rssiPollTimer = null
```

In `onUnload()`:

```javascript
this.stopRssiPolling()
this.proximityState = createProximityState()
```

- [ ] **Step 2: Start and stop RSSI polling with connection state**

Add:

```javascript
startRssiPolling() {
  this.stopRssiPolling()
  this.rssiPollTimer = setInterval(async () => {
    if (!this.data.isConnected || !this.data.deviceId) {
      return
    }

    try {
      const result = await wxAsync(wx.getBLEDeviceRSSI, { deviceId: this.data.deviceId })
      this.handleRssiSample(result.RSSI)
    } catch (error) {
      this.appendLog(`rssi read failed: ${this.getErrorText(error)}`)
    }
  }, 500)
}

stopRssiPolling() {
  if (this.rssiPollTimer) {
    clearInterval(this.rssiPollTimer)
    this.rssiPollTimer = null
  }
}
```

Call `startRssiPolling()` after a successful BLE connection and `stopRssiPolling()` inside `resetConnectionState()`.

- [ ] **Step 3: Drive proximity actions through the reducer**

Add:

```javascript
async handleRssiSample(rssi) {
  const profile = this.data.lockProfile || createDefaultLockProfile(this.data.deviceId, this.data.deviceName)
  this.setData({ currentRssi: Number(rssi) })

  const result = reduceProximityState(this.proximityState, {
    nowMs: Date.now(),
    isConnected: this.data.isConnected,
    isTrusted: !!profile.clientId,
    autoAuthEnabled: !!profile.autoAuth,
    proximityUnlockEnabled: !!profile.proximityUnlock,
    hasSavedPin: !!profile.savedPin,
    lockState: this.data.lastLockAction || 'LOCK',
    rssi,
    threshold: profile.rssiThreshold,
    authSucceeded: false,
    authFailed: false,
    disconnected: false,
  })

  this.proximityState = result.state
  if (result.action === 'request_trusted_auth') {
    this.setData({ automationStateLabel: 'Proximity matched, authorizing' })
    await this.writeCommand(buildTrustedPinCommand(profile.clientId, profile.savedPin))
  }

  if (result.action === 'request_unlock') {
    this.setData({ automationStateLabel: 'Trusted phone unlocking' })
    await this.writeCommand(buildLockCommand('UNLOCK'))
  }
}
```

Inside `handleBleValueChange`, feed auth outcomes back into the reducer:

```javascript
if (response.kind === 'trusted_auth_ok') {
  const reduced = reduceProximityState(this.proximityState, {
    nowMs: Date.now(),
    isConnected: true,
    isTrusted: true,
    autoAuthEnabled: true,
    proximityUnlockEnabled: true,
    hasSavedPin: true,
    lockState: this.data.lastLockAction || 'LOCK',
    rssi: Number(this.data.currentRssi),
    threshold: Number(this.data.lockProfile && this.data.lockProfile.rssiThreshold),
    authSucceeded: true,
    authFailed: false,
    disconnected: false,
  })
  this.proximityState = reduced.state
  if (reduced.action === 'request_unlock') {
    await this.writeCommand(buildLockCommand('UNLOCK'))
  }
}
```

- [ ] **Step 4: Surface live RSSI and automation status in the UI**

Add to `index.wxml`:

```xml
<view class="summary-row">
  <text class="summary-label">RSSI</text>
  <text class="summary-value">{{currentRssi === null ? 'Waiting' : currentRssi}}</text>
</view>
<view class="summary-row">
  <text class="summary-label">Automation</text>
  <text class="summary-value">{{automationStateLabel}}</text>
</view>
```

Add a proximity switch row:

```xml
<view class="switch-row">
  <text class="switch-label">Proximity unlock</text>
  <switch checked="{{lockProfile.proximityUnlock}}" bindchange="handleProximityUnlockToggle" color="#0b72ff" />
</view>
```

- [ ] **Step 5: Run the full Mini Program verification command set**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\proximity_helpers.js'
```

Expected:

```text
All Node tests pass
No syntax errors in the Mini Program JS files
```

### Task 7: Run the Cross-Device Verification Matrix

**Files:**
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`

- [ ] **Step 1: Verify persistence after power loss**

Manual matrix:

```text
1. Bind Phone A and set relock to 8 seconds.
2. Change PIN from 123456 to 654321.
3. Power-cycle the board.
4. Confirm STATUS still reports REL=8.
5. Confirm PIN 654321 works and 123456 fails.
6. Confirm TPIN for Phone A still works.
```

- [ ] **Step 2: Verify multi-phone trust management**

Manual matrix:

```text
1. Bind Phone A with nickname Alice.
2. Bind Phone B with nickname Bob.
3. Confirm TRUST LIST returns both rows.
4. Remove Phone A.
5. Confirm TPIN for Phone A now returns TPIN DENY UNKNOWN_CLIENT.
6. Confirm TPIN for Phone B still works.
```

- [ ] **Step 3: Verify guarded proximity unlock**

Manual matrix:

```text
1. Enable saved PIN, auto auth, and proximity unlock on Phone B.
2. Set RSSI threshold to a nearby value.
3. Approach the lock and hold near it.
4. Confirm one trusted auto-auth request occurs.
5. Confirm exactly one UNLOCK is sent.
6. Stay near the lock and confirm no repeated auto-unlock occurs.
7. Move away until RSSI drops below threshold.
8. Re-enter and confirm a second auto-unlock can occur.
```

- [ ] **Step 4: Verify auto relock survives app-side failure**

Manual matrix:

```text
1. Unlock the lock.
2. Force-close the Mini Program immediately.
3. Confirm the firmware still relocks after the configured delay.
4. Confirm a new connection sees STATUS LOCK afterward.
```

## Self-Review

### Spec coverage

- Persistent PIN and relock config: Task 3 and Task 4.
- Trusted multi-phone model: Task 3, Task 4, and Task 5.
- Optional saved PIN and auto-auth: Task 5 and Task 6.
- RSSI proximity gating and anti-repeat rules: Task 2 and Task 6.
- Cross-device and persistence verification: Task 7.

### Placeholder scan

- No unresolved placeholders remain.
- Each task contains exact file paths and exact verification commands where command-line verification is available.
- Firmware-only steps use explicit manual matrices where no unit harness currently exists.

### Type consistency

- Trusted auth command: `TPIN <clientId> <pin>` everywhere.
- Local profile fields: `clientId`, `nickname`, `savedPin`, `autoConnect`, `autoAuth`, `proximityUnlock`, `rssiThreshold`, `relockSeconds`.
- Proximity reducer actions: `none`, `request_trusted_auth`, `request_unlock`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-smart-lock-commercial-ble-implementation.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints
