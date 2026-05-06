# Smart Lock BLE Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixed-PIN authentication, a 30-second authorization window, and lock/unlock commands to the STM32 + HC-04BLE smart-lock flow so BLE connection alone can no longer operate the lock.

**Architecture:** Keep the existing UART/BLE transport, but upgrade the application protocol from raw servo-angle control to authenticated lock commands. The firmware owns the authorization state machine and lock actuator mapping, while the mini program owns PIN entry, countdown display, response parsing, and only exposes lock-safe actions in the UI.

**Tech Stack:** STM32 HAL on STM32F103C8T6, CubeMX-generated project structure, WeChat Mini Program page code, Node built-in test runner for helper tests.

---

## File Structure

### Firmware

- Modify: `Core/Src/servo_control.c`
  - Extend the UART command parser from `A<angle>` only into `PIN`, `LOCK`, `UNLOCK`, `STATUS`, plus authorized maintenance `A<angle>`.
  - Own the auth timer, failure counter, lockout timer, lock/unlock angle dispatch, and `USART1` debug messages.
- Modify: `Core/Inc/servo_control.h`
  - Keep the public interface stable unless a small config accessor is truly required.
- Read-only context: `Core/Src/main.c`
  - Verify all runtime hooks remain inside `USER CODE BEGIN/END` regions and no new generated-file edits are needed.

### Mini Program

- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
  - Add protocol helpers for PIN, lock/unlock/status commands and response parsing.
  - Add auth view helpers for countdown/state labels.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`
  - Add failing tests for auth command formatting, response parsing, and auth view derivation.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`
  - Replace raw lock-page send flow with authenticated lock flow.
  - Track auth state, countdown timer, button enablement, and BLE response handling.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
  - Add PIN input, authenticate button, auth status block, and lock/unlock buttons.
  - De-emphasize or hide raw angle controls in lock mode.
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxss`
  - Style the auth card, countdown badge, and lock/unlock action row so the lock state is obvious.

### Documentation

- Modify: `docs/superpowers/specs/2026-04-24-lock-security-auth-design.md`
  - Only if implementation reveals a concrete mismatch that must be reflected.

## Task 1: Add Mini Program Auth Protocol Helpers

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`

- [ ] **Step 1: Write the failing helper tests**

Add these tests near the end of `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`:

```javascript
test('buildPinCommand formats PIN command with newline', () => {
  assert.equal(buildPinCommand('123456'), 'PIN 123456\n')
})

test('buildLockCommand formats lock action commands', () => {
  assert.equal(buildLockCommand('LOCK'), 'LOCK\n')
  assert.equal(buildLockCommand('UNLOCK'), 'UNLOCK\n')
  assert.equal(buildLockCommand('STATUS'), 'STATUS\n')
})

test('parseLockResponse reads auth success and remaining seconds', () => {
  assert.deepEqual(parseLockResponse('AUTH OK 30'), {
    kind: 'auth_ok',
    remainingSeconds: 30,
    action: '',
    message: 'Authorized for 30 seconds',
  })
})

test('parseLockResponse reads auth lockout and remaining seconds', () => {
  assert.deepEqual(parseLockResponse('AUTH LOCKED 60'), {
    kind: 'auth_locked',
    remainingSeconds: 60,
    action: '',
    message: 'Too many failures, try again in 60 seconds',
  })
})

test('parseLockResponse reads action ok responses', () => {
  assert.deepEqual(parseLockResponse('ACTION OK UNLOCK'), {
    kind: 'action_ok',
    remainingSeconds: 0,
    action: 'UNLOCK',
    message: 'Unlock succeeded',
  })
})

test('buildAuthViewState returns authorized presentation', () => {
  assert.deepEqual(
    buildAuthViewState({
      isConnected: true,
      authAuthorized: true,
      authRemainingSeconds: 18,
      authLockedSeconds: 0,
    }),
    {
      authStateLabel: 'Authorized',
      authStateDetail: '18 seconds remaining',
      authActionEnabled: true,
      authTone: 'ready',
      canUnlock: true,
    },
  )
})
```

- [ ] **Step 2: Run the helper test file and verify it fails**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
```

Expected:

```text
FAIL
ReferenceError or TypeError for buildPinCommand / buildLockCommand / parseLockResponse / buildAuthViewState
```

- [ ] **Step 3: Write the minimal helper implementation**

Add these functions to `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js` and export them:

```javascript
function buildPinCommand(pin) {
  const normalizedPin = String(pin || '').trim()
  return `PIN ${normalizedPin}\n`
}

function buildLockCommand(action) {
  const normalizedAction = String(action || '').trim().toUpperCase()
  return `${normalizedAction}\n`
}

function parseLockResponse(text) {
  const normalized = String(text || '').trim()

  if (/^AUTH OK (\d+)$/.test(normalized)) {
    const remainingSeconds = Number(normalized.match(/^AUTH OK (\d+)$/)[1])
    return {
      kind: 'auth_ok',
      remainingSeconds,
      action: '',
      message: `Authorized for ${remainingSeconds} seconds`,
    }
  }

  if (/^AUTH LOCKED (\d+)$/.test(normalized)) {
    const remainingSeconds = Number(normalized.match(/^AUTH LOCKED (\d+)$/)[1])
    return {
      kind: 'auth_locked',
      remainingSeconds,
      action: '',
      message: `Too many failures, try again in ${remainingSeconds} seconds`,
    }
  }

  if (/^AUTH FAIL (\d+)$/.test(normalized)) {
    const failures = Number(normalized.match(/^AUTH FAIL (\d+)$/)[1])
    return {
      kind: 'auth_fail',
      remainingSeconds: 0,
      action: '',
      message: `PIN incorrect (${failures}/5)`,
    }
  }

  if (/^ACTION OK (LOCK|UNLOCK)$/.test(normalized)) {
    const action = normalized.match(/^ACTION OK (LOCK|UNLOCK)$/)[1]
    return {
      kind: 'action_ok',
      remainingSeconds: 0,
      action,
      message: action === 'LOCK' ? 'Lock succeeded' : 'Unlock succeeded',
    }
  }

  if (normalized === 'DENY AUTH REQUIRED') {
    return {
      kind: 'deny_auth_required',
      remainingSeconds: 0,
      action: '',
      message: 'Authenticate before unlock',
    }
  }

  if (normalized === 'DENY AUTH EXPIRED') {
    return {
      kind: 'deny_auth_expired',
      remainingSeconds: 0,
      action: '',
      message: 'Authorization expired',
    }
  }

  return {
    kind: 'unknown',
    remainingSeconds: 0,
    action: '',
    message: normalized || 'Unknown response',
  }
}

function buildAuthViewState(input) {
  const state = input || {}
  const remainingSeconds = Number(state.authRemainingSeconds || 0)
  const lockedSeconds = Number(state.authLockedSeconds || 0)

  if (!state.isConnected) {
    return {
      authStateLabel: 'Disconnected',
      authStateDetail: 'Connect to HC-04BLE first',
      authActionEnabled: false,
      authTone: 'danger',
      canUnlock: false,
    }
  }

  if (lockedSeconds > 0) {
    return {
      authStateLabel: 'Locked Out',
      authStateDetail: `${lockedSeconds} seconds before retry`,
      authActionEnabled: false,
      authTone: 'danger',
      canUnlock: false,
    }
  }

  if (state.authAuthorized && remainingSeconds > 0) {
    return {
      authStateLabel: 'Authorized',
      authStateDetail: `${remainingSeconds} seconds remaining`,
      authActionEnabled: true,
      authTone: 'ready',
      canUnlock: true,
    }
  }

  return {
    authStateLabel: 'Authorization Required',
    authStateDetail: 'Enter PIN to operate the lock',
    authActionEnabled: true,
    authTone: 'idle',
    canUnlock: false,
  }
}
```

- [ ] **Step 4: Run tests again and verify they pass**

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

- [ ] **Step 5: Checkpoint the helper change**

Because the current folders are not Git repositories, record the checkpoint by listing the touched files and keeping the test output in the task notes:

```text
Touched:
- miniprogram/utils/servo_helpers.js
- tests/servo_helpers.test.js

Verified:
- node --test tests/servo_helpers.test.js
- node --check miniprogram/utils/servo_helpers.js
```

## Task 2: Add Firmware Authentication State Machine

**Files:**
- Modify: `Core/Src/servo_control.c`
- Optional minimal header update only if needed: `Core/Inc/servo_control.h`
- Read-only context: `Core/Src/main.c`

- [ ] **Step 1: Write down the failing firmware behavior matrix before editing**

Use this manual checklist as the “red” state for firmware behavior:

```text
Current failing behavior:
1. Send UNLOCK before PIN -> current firmware does not understand it
2. Send LOCK before PIN -> current firmware does not understand it
3. Send A180 before PIN -> current firmware executes it immediately
4. Send PIN 123456 -> current firmware rejects it
5. Wait 30 seconds after auth -> current firmware has no auth timeout
```

- [ ] **Step 2: Add authentication constants, state, and helper prototypes**

Add these declarations near the top of `Core/Src/servo_control.c`:

```c
#define SERVO_LOCK_ANGLE                0U
#define SERVO_UNLOCK_ANGLE              90U
#define SERVO_AUTH_WINDOW_MS            30000UL
#define SERVO_AUTH_MAX_FAILURES         5U
#define SERVO_AUTH_LOCKOUT_MS           60000UL
#define SERVO_AUTH_PIN                  "123456"

typedef enum
{
  SERVO_COMMAND_NONE = 0,
  SERVO_COMMAND_PIN,
  SERVO_COMMAND_LOCK,
  SERVO_COMMAND_UNLOCK,
  SERVO_COMMAND_STATUS,
  SERVO_COMMAND_ANGLE
} ServoCommandType;

typedef struct
{
  ServoCommandType type;
  uint8_t angle;
  char pin[12];
} ServoParsedCommand;
```

Add state fields near the existing static globals:

```c
static uint8_t servoLockIsUnlocked;
static uint8_t servoAuthAuthorized;
static uint8_t servoAuthFailureCount;
static uint32_t servoAuthExpiresTick;
static uint32_t servoAuthLockoutTick;
static uint8_t servoAuthExpiredPending;
```

Add helper prototypes:

```c
static void ServoControl_ClearAuthorization(void);
static void ServoControl_RefreshAuthorization(void);
static uint8_t ServoControl_IsAuthorized(void);
static uint8_t ServoControl_IsLockoutActive(uint32_t nowTick, uint32_t *remainingSeconds);
static uint8_t ServoControl_ParseCommand(const char *command, ServoParsedCommand *parsed);
static void ServoControl_HandlePinCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleActionCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_SendStatus(ServoUartChannel *channel);
static void ServoControl_SetLockedState(uint8_t unlockRequested);
```

- [ ] **Step 3: Implement minimal auth timer and parser logic**

Implement the helpers in `Core/Src/servo_control.c` using manual parsing instead of `sscanf`:

```c
static void ServoControl_ClearAuthorization(void)
{
  servoAuthAuthorized = 0U;
  servoAuthExpiresTick = 0U;
}

static void ServoControl_RefreshAuthorization(void)
{
  servoAuthAuthorized = 1U;
  servoAuthFailureCount = 0U;
  servoAuthExpiresTick = HAL_GetTick() + SERVO_AUTH_WINDOW_MS;
}

static uint8_t ServoControl_IsAuthorized(void)
{
  uint32_t nowTick = HAL_GetTick();

  if ((servoAuthAuthorized != 0U) && ((int32_t)(nowTick - servoAuthExpiresTick) >= 0))
  {
    servoAuthAuthorized = 0U;
    servoAuthExpiresTick = 0U;
    servoAuthExpiredPending = 1U;
  }

  return servoAuthAuthorized;
}
```

Implement parser behavior:

```c
PIN 123456  -> SERVO_COMMAND_PIN
LOCK        -> SERVO_COMMAND_LOCK
UNLOCK      -> SERVO_COMMAND_UNLOCK
STATUS      -> SERVO_COMMAND_STATUS
A90         -> SERVO_COMMAND_ANGLE with parsed->angle = 90
```

Any unknown or malformed line should still produce a UART reply:

```text
ERROR COMMAND
```

- [ ] **Step 4: Update the command execution flow**

Replace the body of `ServoControl_ProcessChannelCommand` with a dispatch that:

```c
ServoParsedCommand parsed;

if (ServoControl_ParseCommand(command, &parsed) == 0U)
{
  ServoControl_SendText(channel, "ERROR COMMAND\r\n");
  return;
}

if (parsed.type == SERVO_COMMAND_PIN)
{
  ServoControl_HandlePinCommand(channel, &parsed);
  return;
}

if (parsed.type == SERVO_COMMAND_STATUS)
{
  ServoControl_SendStatus(channel);
  return;
}

ServoControl_HandleActionCommand(channel, &parsed);
```

`ServoControl_HandlePinCommand` must:

```text
Correct PIN       -> AUTH OK 30
Wrong PIN         -> AUTH FAIL <count>
5th wrong PIN     -> AUTH LOCKED 60
During lockout    -> AUTH LOCKED <remaining>
```

`ServoControl_HandleActionCommand` must:

```text
Before auth       -> DENY AUTH REQUIRED
After expiry      -> DENY AUTH EXPIRED
LOCK              -> move servo to SERVO_LOCK_ANGLE and send ACTION OK LOCK
UNLOCK            -> move servo to SERVO_UNLOCK_ANGLE and send ACTION OK UNLOCK
A<angle>          -> only when authorized, then send ACTION OK ANGLE
```

- [ ] **Step 5: Wire periodic expiry and debug visibility**

Update `ServoControl_Task()` so it:

```c
if (ServoControl_IsAuthorized() == 0U && servoAuthExpiredPending != 0U)
{
  servoAuthExpiredPending = 0U;
  ServoControl_DebugPrint("DBG auth expired\r\n");
}
```

Update disconnect-sensitive behavior by clearing authorization when the active BLE command path resets. At minimum, call `ServoControl_ClearAuthorization()`:

```c
static void ServoControl_ClearAuthorization(void);
```

from the disconnect handling point you add for the BLE channel or from any explicit reset path you already own for the channel state.

- [ ] **Step 6: Build the firmware in the normal toolchain and verify expected UART behavior manually**

Manual verification script:

```text
1. Flash firmware.
2. Open USART1 log terminal.
3. Connect BLE and send UNLOCK -> expect DENY AUTH REQUIRED.
4. Send PIN 123456 -> expect AUTH OK 30.
5. Send UNLOCK -> expect ACTION OK UNLOCK and servo motion.
6. Wait 30 seconds.
7. Send UNLOCK -> expect DENY AUTH EXPIRED.
8. Send wrong PIN five times -> expect AUTH LOCKED 60.
```

Expected `USART1` debug fragments:

```text
DBG auth success on USART2, window=30000ms
DBG unlock accepted
DBG auth expired
DBG auth fail on USART2, count=5
DBG auth lockout on USART2
```

- [ ] **Step 7: Checkpoint the firmware change**

Record the touched firmware file set and manual verification result:

```text
Touched:
- Core/Src/servo_control.c
- Core/Inc/servo_control.h (only if required)

Verified:
- Firmware builds
- UART manual matrix matches expected AUTH / DENY / ACTION responses
```

## Task 3: Integrate Auth State Into Mini Program Logic

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`

- [ ] **Step 1: Write the failing auth-state test additions**

Add a helper test that locks in response parsing for denial and unknown cases:

```javascript
test('parseLockResponse reads auth denial states', () => {
  assert.deepEqual(parseLockResponse('DENY AUTH REQUIRED'), {
    kind: 'deny_auth_required',
    remainingSeconds: 0,
    action: '',
    message: 'Authenticate before unlock',
  })
  assert.deepEqual(parseLockResponse('DENY AUTH EXPIRED'), {
    kind: 'deny_auth_expired',
    remainingSeconds: 0,
    action: '',
    message: 'Authorization expired',
  })
})
```

- [ ] **Step 2: Run the test file and verify it fails before the page integration**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
```

Expected:

```text
FAIL if parseLockResponse does not yet cover both deny states
```

- [ ] **Step 3: Add auth state fields and timer lifecycle in the page**

In `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`, add page state fields:

```javascript
authPin: '',
authAuthorized: false,
authRemainingSeconds: 0,
authLockedSeconds: 0,
authStatusLabel: 'Authorization Required',
authStatusDetail: 'Enter PIN to operate the lock',
authTone: 'idle',
lastLockAction: '',
lockMode: true,
```

Add timer ownership in `onLoad` / `onUnload`:

```javascript
this.authCountdownTimer = null
```

Implement:

```javascript
startAuthCountdown(seconds) { ... }
stopAuthCountdown() { ... }
applyAuthState(nextState) { ... }
handlePinInput(event) { ... }
handleAuthenticateTap() { ... }
handleLockActionTap(event) { ... }
```

Minimal send flow:

```javascript
async handleAuthenticateTap() {
  const command = buildPinCommand(this.data.authPin)
  await this.writeCommand(command)
}

async handleLockActionTap(event) {
  const action = event.currentTarget.dataset.action
  const command = buildLockCommand(action)
  await this.writeCommand(command)
}
```

- [ ] **Step 4: Centralize BLE write and response handling**

Add a reusable write helper in `index.js`:

```javascript
async writeCommand(command) {
  if (!this.data.isConnected || !this.data.serviceId || !this.data.writeCharacteristicId) {
    this.appendLog('cannot send: device not ready')
    return false
  }

  await wxAsync(wx.writeBLECharacteristicValue, {
    deviceId: this.data.deviceId,
    serviceId: this.data.serviceId,
    characteristicId: this.data.writeCharacteristicId,
    value: stringToArrayBuffer(command),
  })

  this.appendLog(`send: ${command.trim()}`)
  return true
}
```

Update `handleBleValueChange(result)` to use:

```javascript
const response = parseLockResponse(text)
```

Then map response kinds to page state:

```javascript
auth_ok            -> authAuthorized=true, start countdown
auth_fail          -> authAuthorized=false, show incorrect PIN
auth_locked        -> authAuthorized=false, authLockedSeconds=response.remainingSeconds
deny_auth_required -> authAuthorized=false
deny_auth_expired  -> authAuthorized=false, authRemainingSeconds=0
action_ok          -> lastLockAction=response.action
```

- [ ] **Step 5: Recompute view state from auth state**

Update `updateDerivedView()` to call the new helper:

```javascript
const authView = buildAuthViewState({
  isConnected: this.data.isConnected,
  authAuthorized: this.data.authAuthorized,
  authRemainingSeconds: this.data.authRemainingSeconds,
  authLockedSeconds: this.data.authLockedSeconds,
})
```

Then set:

```javascript
authStatusLabel: authView.authStateLabel,
authStatusDetail: authView.authStateDetail,
authTone: authView.authTone,
canUnlock: authView.canUnlock,
```

Also disable the old raw servo send controls when `lockMode` is enabled:

```javascript
const canSendServo = connectionView.canSend && !this.data.lockMode
```

- [ ] **Step 6: Run page-level syntax and helper tests**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js'
```

Expected:

```text
All tests pass
No syntax errors in index.js or servo_helpers.js
```

- [ ] **Step 7: Checkpoint the page-logic change**

Record:

```text
Touched:
- miniprogram/pages/index/index.js
- miniprogram/utils/servo_helpers.js
- tests/servo_helpers.test.js

Verified:
- node --test tests/servo_helpers.test.js
- node --check miniprogram/pages/index/index.js
- node --check miniprogram/utils/servo_helpers.js
```

## Task 4: Build the Lock-Safe Mini Program UI

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxss`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`

- [ ] **Step 1: Add the auth and lock action markup**

Insert a dedicated auth panel in `index.wxml` above the existing connection list:

```xml
<view class="panel auth-panel auth-panel-{{authTone}}">
  <view class="panel-header">
    <view class="panel-title">Lock Security</view>
    <view class="status-pill {{authTone === 'ready' ? 'status-on' : 'status-off'}}">{{authStatusLabel}}</view>
  </view>

  <view class="status-row">
    <text class="status-label">Authorization</text>
    <text class="status-value">{{authStatusDetail}}</text>
  </view>

  <view class="pin-row">
    <input
      class="pin-input"
      type="number"
      maxlength="6"
      password
      value="{{authPin}}"
      bindinput="handlePinInput"
      placeholder="Enter 6-digit PIN"
    />
    <button class="action-button primary auth-button" bindtap="handleAuthenticateTap" disabled="{{!isConnected}}">
      Authenticate
    </button>
  </view>

  <view class="button-row lock-action-row">
    <button class="action-button secondary" data-action="LOCK" bindtap="handleLockActionTap" disabled="{{!canUnlock}}">
      Lock
    </button>
    <button class="action-button primary" data-action="UNLOCK" bindtap="handleLockActionTap" disabled="{{!canUnlock}}">
      Unlock
    </button>
  </view>
</view>
```

- [ ] **Step 2: Hide or de-emphasize raw servo controls in lock mode**

Wrap the existing slider and preset section in `index.wxml`:

```xml
<view wx:if="{{!lockMode}}">
  <!-- existing slider and preset controls -->
</view>
```

If the page should still show the last angle for maintenance visibility, keep the angle badge but not the action controls.

- [ ] **Step 3: Add auth-focused styles**

Add these styles in `index.wxss`:

```css
.auth-panel {
  border-width: 2rpx;
  border-color: #d7e4f8;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
}

.auth-panel-ready {
  border-color: #bfe7d5;
  background: linear-gradient(180deg, #f4fffa 0%, #ffffff 100%);
}

.pin-row {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.pin-input {
  flex: 1;
  min-height: 84rpx;
  padding: 0 24rpx;
  border-radius: 20rpx;
  border: 2rpx solid #d8e4f7;
  background: #f8fbff;
  font-size: 28rpx;
  color: #173f67;
}

.lock-action-row .action-button {
  flex: 1;
}
```

- [ ] **Step 4: Verify the page still parses**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js'
```

Expected:

```text
No syntax errors
```

- [ ] **Step 5: Visual smoke test in WeChat DevTools**

Verify visually:

```text
1. Page shows a Lock Security panel.
2. PIN input is visible only after connection area loads.
3. Unlock button is disabled before successful authentication.
4. After AUTH OK 30, status pill becomes Authorized and countdown is visible.
5. After countdown reaches 0, Unlock becomes disabled again.
```

- [ ] **Step 6: Checkpoint the UI change**

Record:

```text
Touched:
- miniprogram/pages/index/index.wxml
- miniprogram/pages/index/index.wxss
- miniprogram/pages/index/index.js

Verified:
- node --check miniprogram/pages/index/index.js
- WeChat DevTools visual smoke test
```

## Task 5: Run Cross-Device Lock Flow Verification

**Files:**
- Modify only if mismatch is discovered:
  - `Core/Src/servo_control.c`
  - `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`
  - `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
  - `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
  - `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxss`

- [ ] **Step 1: Verify the unauthenticated path is blocked**

Manual test:

```text
1. Power on the STM32 board.
2. Open the mini program and connect to HC-04BLE.
3. Without entering a PIN, tap Unlock.
4. Confirm the mini program shows "Authenticate before unlock".
5. Confirm USART1 shows DENY AUTH REQUIRED.
6. Confirm the servo does not move.
```

- [ ] **Step 2: Verify the successful auth window**

Manual test:

```text
1. Enter the correct PIN.
2. Confirm AUTH OK 30 appears in logs.
3. Confirm the countdown starts at 30.
4. Tap Unlock and confirm servo opens.
5. Tap Lock and confirm servo returns to the lock angle.
```

- [ ] **Step 3: Verify auth expiry behavior**

Manual test:

```text
1. Authenticate successfully.
2. Wait 30 seconds without reauthenticating.
3. Tap Unlock.
4. Confirm the app reports Authorization expired.
5. Confirm the servo does not move.
6. Confirm USART1 logs DBG auth expired.
```

- [ ] **Step 4: Verify brute-force lockout**

Manual test:

```text
1. Enter a wrong PIN five times.
2. Confirm the fifth response is AUTH LOCKED 60.
3. Confirm further PIN attempts during cooldown remain rejected.
4. Confirm the app shows a retry countdown or locked state detail.
```

- [ ] **Step 5: Run the full local verification command set**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js'
& 'D:\Program Files\nodejs\node.exe' --check 'C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js'
```

Expected:

```text
All helper tests pass
No syntax errors
Manual UART and BLE verification all match the spec
```

- [ ] **Step 6: Final checkpoint**

Record:

```text
Acceptance criteria satisfied:
- BLE connection alone cannot unlock
- Correct PIN enables 30-second authorization
- Expired auth blocks actions
- Wrong PIN lockout works
- Mini program clearly shows auth state
- USART1 still provides debug visibility
```

## Self-Review Notes

### Spec Coverage

- Command protocol: covered by Task 1 helpers and Task 2 firmware parser.
- Firmware state machine, timeout, and lockout: covered by Task 2.
- Mini program auth UI and countdown: covered by Task 3 and Task 4.
- Acceptance and manual validation: covered by Task 5.

### Placeholder Scan

- No `TODO` / `TBD` placeholders remain.
- No “similar to above” references remain.
- Every task includes exact file paths and verification commands.

### Type Consistency

- Response kinds used across tasks: `auth_ok`, `auth_fail`, `auth_locked`, `action_ok`, `deny_auth_required`, `deny_auth_expired`, `unknown`.
- Page state names used across tasks: `authAuthorized`, `authRemainingSeconds`, `authLockedSeconds`, `authStatusLabel`, `authStatusDetail`, `authTone`, `canUnlock`.
- Firmware command names used across tasks: `PIN`, `LOCK`, `UNLOCK`, `STATUS`, `A<angle>`.
