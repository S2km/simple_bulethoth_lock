# WeChat BLE Servo Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default WeChat starter page with a single-page BLE servo debug console that can reconnect to `HC-04BLE`, send `A<angle>\n` commands, and show connection and send logs.

**Architecture:** Keep the page UI in `pages/index` and move testable pure logic into a small helper module. Use WeChat native BLE APIs directly in the page, with local storage for last successful `deviceId`, and use Node's built-in test runner for pure helper functions.

**Tech Stack:** WeChat Mini Program native APIs, CommonJS modules, Node.js built-in test runner, plain WXML/WXSS

---

## File Structure

- `miniprogram/pages/index/index.js`
  Responsibility: page state, BLE adapter lifecycle, scanning, connection, discovery, sending commands, logging.
- `miniprogram/pages/index/index.wxml`
  Responsibility: Bluetooth panel, servo control panel, log panel.
- `miniprogram/pages/index/index.wxss`
  Responsibility: single-page debug console styling.
- `miniprogram/pages/index/index.json`
  Responsibility: page-level configuration such as navigation title.
- `miniprogram/utils/servo_helpers.js`
  Responsibility: pure helper functions for angle clamping, command formatting, device merging, and log formatting helpers.
- `tests/servo_helpers.test.js`
  Responsibility: automated tests for the pure helper functions.

### Task 1: Add testable servo helper module with TDD

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`

- [ ] **Step 1: Write the failing test file**

Create `tests/servo_helpers.test.js` with these initial checks:

```js
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  clampAngle,
  buildAngleCommand,
  upsertDevice,
  makeLogEntry,
} = require('../miniprogram/utils/servo_helpers')

test('clampAngle limits values to 0..180 integers', () => {
  assert.equal(clampAngle(-4), 0)
  assert.equal(clampAngle(45.8), 46)
  assert.equal(clampAngle(999), 180)
})

test('buildAngleCommand formats prefixed servo command', () => {
  assert.equal(buildAngleCommand(90), 'A90\\n')
})

test('upsertDevice inserts and updates discovered BLE devices', () => {
  const devices = []
  const first = upsertDevice(devices, { deviceId: '1', name: 'HC-04BLE', RSSI: -60 })
  assert.equal(first.length, 1)
  const second = upsertDevice(first, { deviceId: '1', name: 'HC-04BLE', RSSI: -40 })
  assert.equal(second.length, 1)
  assert.equal(second[0].RSSI, -40)
})

test('makeLogEntry keeps readable timestamped log text', () => {
  const entry = makeLogEntry('connected')
  assert.match(entry.id, /^log-/)
  assert.match(entry.text, /connected/)
})
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test tests\servo_helpers.test.js
```

Expected:

- the run fails because `../miniprogram/utils/servo_helpers` does not exist yet

- [ ] **Step 3: Implement the minimal helper module**

Create `miniprogram/utils/servo_helpers.js` with:

```js
function clampAngle(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  const rounded = Math.round(numeric)
  if (rounded < 0) return 0
  if (rounded > 180) return 180
  return rounded
}

function buildAngleCommand(angle) {
  return `A${clampAngle(angle)}\n`
}

function upsertDevice(devices, incoming) {
  const next = Array.isArray(devices) ? devices.slice() : []
  const index = next.findIndex((item) => item.deviceId === incoming.deviceId)
  if (index >= 0) {
    next[index] = { ...next[index], ...incoming }
  } else {
    next.push(incoming)
  }
  return next
}

function makeLogEntry(text) {
  const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false })
  return {
    id: `log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text: `[${timestamp}] ${text}`,
  }
}

module.exports = {
  clampAngle,
  buildAngleCommand,
  upsertDevice,
  makeLogEntry,
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test tests\servo_helpers.test.js
```

Expected:

- all tests pass

### Task 2: Replace the default page logic with BLE servo control

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`

- [ ] **Step 1: Replace starter profile code with servo page state**

Use data fields similar to:

```js
data: {
  adapterReady: false,
  isScanning: false,
  isConnected: false,
  autoReconnect: true,
  deviceList: [],
  deviceId: '',
  deviceName: 'not connected',
  serviceId: '',
  writeCharacteristicId: '',
  notifyCharacteristicId: '',
  currentAngle: 90,
  realtimeMode: false,
  logs: [],
}
```

- [ ] **Step 2: Add BLE lifecycle and reconnect flow**

Implement methods for:

```js
onLoad()
onUnload()
initBluetooth()
tryReconnect()
startScan()
stopScan()
handleDeviceFound(device)
connectDevice(deviceId, deviceName)
disconnectDevice()
```

Expected behavior:

- `initBluetooth()` opens the adapter and registers listeners
- `tryReconnect()` reads last device id from storage and attempts reconnect
- failed reconnect falls back to `startScan()`

- [ ] **Step 3: Add service discovery, characteristic discovery, and notifications**

Implement methods for:

```js
discoverServices(deviceId)
discoverCharacteristics(deviceId, serviceId)
enableNotifications()
handleBleValueChange(result)
```

Expected behavior:

- writable characteristic id is stored
- notifiable characteristic id is stored if present
- incoming BLE values are decoded to text and appended to logs

- [ ] **Step 4: Add angle send methods**

Implement methods for:

```js
sendAngle(angle)
sendCurrentAngle()
handlePresetTap(event)
handleSliderChanging(event)
handleSliderChange(event)
handleRealtimeToggle(event)
```

Expected behavior:

- presets send immediately
- slider release sends once
- realtime mode uses throttled sends during drag
- all outgoing writes use `buildAngleCommand(angle)`

- [ ] **Step 5: Add logging helpers and connection-state updates**

Implement methods for:

```js
appendLog(text)
resetConnectionState()
```

Expected behavior:

- important BLE actions add readable logs
- disconnects restore the page to a recoverable state

### Task 3: Replace starter markup with the servo debug console layout

**Files:**
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxml`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.wxss`
- Modify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.json`

- [ ] **Step 1: Set the page title**

Update `index.json`:

```json
{
  "navigationBarTitleText": "BLE Servo"
}
```

- [ ] **Step 2: Build the WXML structure**

Create three visual sections:

```xml
<scroll-view class="page" scroll-y>
  <view class="panel">
    <view class="panel-title">Bluetooth</view>
  </view>
  <view class="panel">
    <view class="panel-title">Servo</view>
  </view>
  <view class="panel">
    <view class="panel-title">Logs</view>
  </view>
</scroll-view>
```

And inside them include:

- adapter and connection status text
- scan and disconnect buttons
- auto reconnect switch
- device list with tap-to-connect rows
- current angle text
- slider
- preset buttons
- realtime mode switch
- send current angle button
- log list

- [ ] **Step 3: Apply compact, readable debug-console styling**

In `index.wxss`, add a clean mobile debug style using classes like:

```css
.page { height: 100vh; background: #f3f6fb; }
.panel { margin: 24rpx; padding: 24rpx; background: #ffffff; border-radius: 24rpx; }
.panel-title { font-size: 32rpx; font-weight: 700; }
.status-pill { display: inline-block; padding: 8rpx 16rpx; border-radius: 999rpx; }
.preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16rpx; }
.log-list { max-height: 420rpx; overflow: hidden; }
```

The look should stay practical and easy to scan rather than product-marketing styled.

### Task 4: Verify helper tests and page syntax

**Files:**
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\servo_helpers.js`
- Verify: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\index\index.js`

- [ ] **Step 1: Run helper tests**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --test tests\servo_helpers.test.js
```

Expected:

- all tests pass

- [ ] **Step 2: Check page JavaScript syntax**

Run:

```powershell
& 'D:\Program Files\nodejs\node.exe' --check miniprogram\pages\index\index.js
& 'D:\Program Files\nodejs\node.exe' --check miniprogram\utils\servo_helpers.js
```

Expected:

- both commands exit successfully with no syntax error

- [ ] **Step 3: Manual Mini Program verification**

Open the project in WeChat DevTools and verify:

- page loads as a single debug console
- scan button lists `HC-04BLE`
- tapping a preset like `90 deg` writes `A90\n`
- slider release sends one command
- realtime mode changes send behavior during drag
- connection and send logs visibly update on screen

## Self-Review

- Spec coverage: the plan covers auto reconnect, fallback scanning, preset commands, slider send behavior, realtime mode, logs, and BLE discovery requirements.
- Placeholder scan: no `TODO`, `TBD`, or vague implementation steps remain.
- Type consistency: helper names and page data field names are consistent across the plan.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-wechat-ble-servo-control.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

For this workspace, continue with inline execution unless the user explicitly asks to split the work across subagents.
