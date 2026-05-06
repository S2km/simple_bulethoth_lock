# WeChat BLE Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the BLE servo homepage into a balanced cockpit UI with clearer status, stronger servo controls, and a semi-expanded log experience without breaking the existing HC-04 BLE control flow.

**Architecture:** Keep the work centered on the existing single-page `pages/index` implementation. Add a small set of UI-focused helper functions in `servo_helpers.js` for status labels, summary logs, and display state derivation, then update `index.js`, `index.wxml`, and `index.wxss` to render the new layout and interaction states while preserving the existing BLE connect/write pipeline.

**Tech Stack:** WeChat Mini Program (`wxml`, `wxss`, page `js`), Node test runner (`node --test`), existing helper module in `miniprogram/utils/servo_helpers.js`

---

## File Structure

### Files To Modify

- `miniprogram/miniprogram/pages/index/index.js`
  - Add derived UI state for top status card, summary logs, compact/expanded connection area, and log expand/collapse behavior.
- `miniprogram/miniprogram/pages/index/index.wxml`
  - Replace the current stacked debug layout with the cockpit structure: top status card, main control card, connection operations card, and semi-expanded log card.
- `miniprogram/miniprogram/pages/index/index.wxss`
  - Implement the brighter cockpit visual treatment, stronger main control emphasis, compact/expanded secondary regions, and selected-angle button states.
- `miniprogram/miniprogram/utils/servo_helpers.js`
  - Add small pure helpers for status mapping, recent-action summary, summary-log selection, and control availability derivation.
- `miniprogram/tests/servo_helpers.test.js`
  - Add focused tests for the new UI-state helper functions.

### Files To Verify But Not Modify Unless Needed

- `miniprogram/miniprogram/app.json`
  - Confirm the page path remains unchanged.
- `miniprogram/docs/superpowers/specs/2026-04-24-wechat-ble-interaction-polish-design.md`
  - Use as the acceptance reference during implementation review.

---

### Task 1: Add UI State Helpers With Tests

**Files:**
- Modify: `miniprogram/tests/servo_helpers.test.js`
- Modify: `miniprogram/miniprogram/utils/servo_helpers.js`

- [ ] **Step 1: Write the failing tests for cockpit status and log-summary helpers**

```javascript
test('buildConnectionViewState returns controllable state when BLE send path is ready', () => {
  const result = buildConnectionViewState({
    adapterReady: true,
    isScanning: false,
    isConnected: true,
    deviceName: 'HC-04BLE',
    serviceId: '0000FFE0-0000-1000-8000-00805F9B34FB',
    writeCharacteristicId: '0000FFE1-0000-1000-8000-00805F9B34FB',
  })

  assert.deepEqual(result, {
    tone: 'ready',
    label: 'Controllable',
    detail: 'HC-04BLE',
    canSend: true,
    compactConnectionPanel: true,
  })
})

test('buildConnectionViewState returns reconnecting state before scan fallback', () => {
  const result = buildConnectionViewState({
    adapterReady: true,
    isScanning: false,
    isConnected: false,
    reconnecting: true,
    deviceName: 'HC-04BLE',
    serviceId: '',
    writeCharacteristicId: '',
  })

  assert.equal(result.label, 'Reconnecting')
  assert.equal(result.canSend, false)
  assert.equal(result.compactConnectionPanel, false)
})

test('pickSummaryLogs keeps only connection send and error logs in newest-first order', () => {
  const logs = [
    makeLogEntry('chars: 0000FFE1(...)'),
    makeLogEntry('send: A90'),
    makeLogEntry('connected: HC-04BLE'),
    makeLogEntry('services found: 2'),
    makeLogEntry('write failed: timeout'),
  ]

  const result = pickSummaryLogs(logs, 3)

  assert.deepEqual(
    result.map((item) => item.text),
    [logs[4].text, logs[2].text, logs[1].text],
  )
})

test('buildRecentActionSummary prefers send result over passive logs', () => {
  const result = buildRecentActionSummary([
    makeLogEntry('services found: 2'),
    makeLogEntry('send: A135'),
  ])

  assert.equal(result, 'Recent send A135')
})
```

- [ ] **Step 2: Run the helper test file to verify the new tests fail**

Run: `D:\Program Files\nodejs\node.exe --test tests\servo_helpers.test.js`

Expected: FAIL with `buildConnectionViewState is not defined`, `pickSummaryLogs is not defined`, and `buildRecentActionSummary is not defined`

- [ ] **Step 3: Implement the minimal helper functions in `servo_helpers.js`**

```javascript
function buildConnectionViewState(input) {
  const adapterReady = !!input.adapterReady
  const isScanning = !!input.isScanning
  const isConnected = !!input.isConnected
  const reconnecting = !!input.reconnecting
  const deviceName = input.deviceName || 'No device'
  const canSend = !!(isConnected && input.serviceId && input.writeCharacteristicId)

  if (!adapterReady) {
    return {
      tone: 'danger',
      label: 'Bluetooth Off',
      detail: 'Adapter unavailable',
      canSend: false,
      compactConnectionPanel: false,
    }
  }

  if (canSend) {
    return {
      tone: 'ready',
      label: 'Controllable',
      detail: deviceName,
      canSend: true,
      compactConnectionPanel: true,
    }
  }

  if (reconnecting) {
    return {
      tone: 'pending',
      label: 'Reconnecting',
      detail: deviceName,
      canSend: false,
      compactConnectionPanel: false,
    }
  }

  if (isScanning) {
    return {
      tone: 'pending',
      label: 'Scanning',
      detail: 'Searching nearby devices',
      canSend: false,
      compactConnectionPanel: false,
    }
  }

  return {
    tone: 'idle',
    label: isConnected ? 'Connected' : 'Disconnected',
    detail: deviceName,
    canSend: false,
    compactConnectionPanel: false,
  }
}

function pickSummaryLogs(logs, limit = 2) {
  return (logs || [])
    .filter((item) => /connected:|disconnected|send:|failed|error/i.test(item.text))
    .slice(0, limit)
}

function buildRecentActionSummary(logs) {
  const summarySource = pickSummaryLogs(logs, 1)[0]

  if (!summarySource) {
    return 'Waiting for action'
  }

  if (/send:\s*/i.test(summarySource.text)) {
    return summarySource.text.replace(/^.*send:\s*/i, 'Recent send ')
  }

  if (/connected:/i.test(summarySource.text)) {
    return summarySource.text.replace(/^.*connected:\s*/i, 'Connected ')
  }

  return summarySource.text.replace(/^\[[^\]]+\]\s*/, '')
}
```

- [ ] **Step 4: Export the new helpers from `servo_helpers.js`**

```javascript
module.exports = {
  arrayBufferToAscii,
  buildAngleCommand,
  buildConnectionViewState,
  buildRecentActionSummary,
  clampAngle,
  getPreferredProfile,
  makeLogEntry,
  normalizeUuid,
  pickCharacteristicIds,
  pickSummaryLogs,
  stringToArrayBuffer,
  upsertDevice,
}
```

- [ ] **Step 5: Run the helper tests again to verify they pass**

Run: `D:\Program Files\nodejs\node.exe --test tests\servo_helpers.test.js`

Expected: PASS with all tests green and the new helper cases included

- [ ] **Step 6: Commit the helper-layer checkpoint**

```bash
git add miniprogram/utils/servo_helpers.js tests/servo_helpers.test.js
git commit -m "feat: add cockpit ui state helpers"
```

If the workspace is not a git repository, skip the commit and note that verification succeeded locally.

---

### Task 2: Derive Cockpit State In `index.js`

**Files:**
- Modify: `miniprogram/miniprogram/pages/index/index.js`
- Test: `miniprogram/tests/servo_helpers.test.js`

- [ ] **Step 1: Add a failing test for recent-action wording so timestamp noise is removed from summaries**

```javascript
test('buildRecentActionSummary strips timestamps from error summaries', () => {
  const result = buildRecentActionSummary([
    { id: '1', text: '[10:20:30] write failed: timeout' },
  ])

  assert.equal(result, 'write failed: timeout')
})
```

- [ ] **Step 2: Run the helper tests to verify the new wording test fails before the helper update**

Run: `D:\Program Files\nodejs\node.exe --test tests\servo_helpers.test.js`

Expected: FAIL because `buildRecentActionSummary()` still returns the full timestamped line instead of `write failed: timeout`

- [ ] **Step 3: Update page state to track reconnecting and log expansion**

```javascript
data: {
  adapterReady: false,
  isScanning: false,
  isConnected: false,
  reconnecting: false,
  autoReconnect: true,
  deviceList: [],
  deviceId: '',
  deviceName: 'Not connected',
  serviceId: '',
  writeCharacteristicId: '',
  notifyCharacteristicId: '',
  currentAngle: 90,
  realtimeMode: false,
  logs: [],
  logsExpanded: false,
}
```

- [ ] **Step 4: Import and use the helper functions to derive top-card and log-summary state**

```javascript
const {
  arrayBufferToAscii,
  buildAngleCommand,
  buildConnectionViewState,
  buildRecentActionSummary,
  clampAngle,
  getPreferredProfile,
  makeLogEntry,
  normalizeUuid,
  pickCharacteristicIds,
  pickSummaryLogs,
  stringToArrayBuffer,
  upsertDevice,
} = require('../../utils/servo_helpers')

updateDerivedView() {
  const connectionView = buildConnectionViewState({
    adapterReady: this.data.adapterReady,
    isScanning: this.data.isScanning,
    isConnected: this.data.isConnected,
    reconnecting: this.data.reconnecting,
    deviceName: this.data.deviceName,
    serviceId: this.data.serviceId,
    writeCharacteristicId: this.data.writeCharacteristicId,
  })

  this.setData({
    connectionTone: connectionView.tone,
    connectionLabel: connectionView.label,
    connectionDetail: connectionView.detail,
    canSend: connectionView.canSend,
    compactConnectionPanel: connectionView.compactConnectionPanel,
    summaryLogs: pickSummaryLogs(this.data.logs, 2),
    recentActionText: buildRecentActionSummary(this.data.logs),
  })
}
```

- [ ] **Step 5: Call `updateDerivedView()` from every state-changing branch**

```javascript
this.setData({ adapterReady: true })
this.updateDerivedView()

this.setData({ reconnecting: true })
this.updateDerivedView()

this.appendLog(`connected: ${deviceName}`)
this.updateDerivedView()

this.resetConnectionState()
this.updateDerivedView()
```

Apply this after:

- Bluetooth init success/failure
- reconnect start/end
- scan start/stop
- connect success/failure
- disconnect
- send success/failure
- log append

- [ ] **Step 6: Add handlers for log expansion and compact connection presentation**

```javascript
handleToggleLogs() {
  this.setData({ logsExpanded: !this.data.logsExpanded })
}
```

Also ensure `resetConnectionState()` resets:

```javascript
logsExpanded: false
```

This keeps the page returning to the compact semi-expanded log state after disconnect, which matches the approved balanced cockpit design.

- [ ] **Step 7: Run syntax checks for page logic and helper logic**

Run: `D:\Program Files\nodejs\node.exe --check miniprogram\pages\index\index.js`

Expected: no output, exit code `0`

Run: `D:\Program Files\nodejs\node.exe --check miniprogram\utils\servo_helpers.js`

Expected: no output, exit code `0`

- [ ] **Step 8: Re-run helper tests to verify the derived-state helpers still pass**

Run: `D:\Program Files\nodejs\node.exe --test tests\servo_helpers.test.js`

Expected: PASS

- [ ] **Step 9: Commit the page-state checkpoint**

```bash
git add miniprogram/pages/index/index.js miniprogram/utils/servo_helpers.js tests/servo_helpers.test.js
git commit -m "feat: derive cockpit view state on ble page"
```

If the workspace is not a git repository, skip the commit and record the local verification instead.

---

### Task 3: Rebuild The Page Layout In `index.wxml`

**Files:**
- Modify: `miniprogram/miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/miniprogram/pages/index/index.js`

- [ ] **Step 1: Replace the current top panel with a cockpit status card**

```xml
<view class="hero hero-{{connectionTone}}">
  <view class="hero-top">
    <view>
      <view class="hero-kicker">BLE Servo Cockpit</view>
      <view class="hero-title">{{connectionLabel}}</view>
      <view class="hero-detail">{{connectionDetail}}</view>
    </view>
    <view class="hero-angle">{{currentAngle}}°</view>
  </view>
  <view class="hero-summary">
    <view class="hero-summary-item">
      <text class="hero-summary-label">Recent</text>
      <text class="hero-summary-value">{{recentActionText}}</text>
    </view>
    <view class="hero-summary-item">
      <text class="hero-summary-label">Mode</text>
      <text class="hero-summary-value">{{realtimeMode ? 'Realtime' : 'Release Send'}}</text>
    </view>
  </view>
</view>
```

- [ ] **Step 2: Rebuild the control section so slider and presets both feel primary**

```xml
<view class="panel control-panel">
  <view class="panel-header">
    <view class="panel-title">Servo Control</view>
    <view class="angle-badge">{{currentAngle}} deg</view>
  </view>

  <view class="slider-shell">
    <slider
      min="0"
      max="180"
      step="1"
      value="{{currentAngle}}"
      activeColor="#0b72ff"
      backgroundColor="#cfdcf3"
      bindchanging="handleSliderChanging"
      bindchange="handleSliderChange"
      disabled="{{!canSend}}"
      show-value
    />
    <view class="slider-hint">{{realtimeMode ? 'Dragging sends throttled updates' : 'Sends when slider is released'}}</view>
  </view>

  <view class="preset-grid">
    <button class="preset-button {{currentAngle === 0 ? 'preset-active' : ''}}" data-angle="0" bindtap="handlePresetTap" disabled="{{!canSend}}">0 deg</button>
    <button class="preset-button {{currentAngle === 45 ? 'preset-active' : ''}}" data-angle="45" bindtap="handlePresetTap" disabled="{{!canSend}}">45 deg</button>
    <button class="preset-button {{currentAngle === 90 ? 'preset-active' : ''}}" data-angle="90" bindtap="handlePresetTap" disabled="{{!canSend}}">90 deg</button>
    <button class="preset-button {{currentAngle === 135 ? 'preset-active' : ''}}" data-angle="135" bindtap="handlePresetTap" disabled="{{!canSend}}">135 deg</button>
    <button class="preset-button {{currentAngle === 180 ? 'preset-active' : ''}}" data-angle="180" bindtap="handlePresetTap" disabled="{{!canSend}}">180 deg</button>
    <button class="send-button" bindtap="handleSendCurrentTap" disabled="{{!canSend}}">Send Current</button>
  </view>

  <view class="switch-row servo-row">
    <text class="switch-label">Realtime mode</text>
    <switch checked="{{realtimeMode}}" bindchange="handleRealtimeToggle" color="#0b72ff" />
  </view>
</view>
```

- [ ] **Step 3: Rebuild the connection panel with compact and expanded states**

```xml
<view class="panel connection-panel {{compactConnectionPanel ? 'connection-panel-compact' : ''}}">
  <view class="panel-header">
    <view class="panel-title">Connection</view>
    <view class="status-pill {{canSend ? 'status-on' : 'status-off'}}">{{connectionLabel}}</view>
  </view>

  <view class="button-row">
    <button class="action-button primary" bindtap="handleScanTap" disabled="{{!adapterReady}}">Scan Devices</button>
    <button class="action-button secondary" bindtap="disconnectDevice" disabled="{{!isConnected}}">Disconnect</button>
  </view>

  <view class="switch-row">
    <text class="switch-label">Auto reconnect</text>
    <switch checked="{{autoReconnect}}" bindchange="handleAutoReconnectToggle" color="#0b72ff" />
  </view>

  <view class="device-section" wx:if="{{!compactConnectionPanel || !isConnected}}">
    <view class="device-title">Device List</view>
    <!-- reuse current wx:for device list block here -->
  </view>
</view>
```

- [ ] **Step 4: Replace the current full-height logs panel with the semi-expanded summary card**

```xml
<view class="panel panel-last">
  <view class="panel-header">
    <view class="panel-title">Activity</view>
    <button class="text-button" bindtap="handleToggleLogs">{{logsExpanded ? 'Collapse' : 'Expand Logs'}}</button>
  </view>

  <view class="summary-stack">
    <view class="summary-row">
      <text class="summary-label">Status</text>
      <text class="summary-value">{{connectionLabel}}</text>
    </view>
    <view class="summary-row">
      <text class="summary-label">Recent</text>
      <text class="summary-value">{{recentActionText}}</text>
    </view>
  </view>

  <block wx:if="{{summaryLogs.length}}">
    <view wx:for="{{summaryLogs}}" wx:key="id" class="log-item summary-log">{{item.text}}</view>
  </block>

  <block wx:if="{{logsExpanded}}">
    <view wx:for="{{logs}}" wx:key="id" class="log-item">{{item.text}}</view>
  </block>
</view>
```

- [ ] **Step 5: Run a syntax check after the template changes**

Run: `D:\Program Files\nodejs\node.exe --check miniprogram\pages\index\index.js`

Expected: no output, exit code `0`

- [ ] **Step 6: Commit the layout checkpoint**

```bash
git add miniprogram/pages/index/index.wxml miniprogram/pages/index/index.js
git commit -m "feat: rebuild ble page layout as cockpit"
```

If the workspace is not a git repository, skip the commit and keep the verification notes.

---

### Task 4: Apply The Cockpit Visual System In `index.wxss`

**Files:**
- Modify: `miniprogram/miniprogram/pages/index/index.wxss`
- Modify: `miniprogram/miniprogram/pages/index/index.wxml`

- [ ] **Step 1: Replace the generic page colors with a brighter cockpit palette**

```css
page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(120, 178, 255, 0.22), transparent 34%),
    linear-gradient(180deg, #edf4ff 0%, #f7f9fd 48%, #eef3fa 100%);
  color: #17324d;
}

.page {
  height: 100vh;
  box-sizing: border-box;
}
```

- [ ] **Step 2: Style the new top hero card and summary rows**

```css
.hero {
  margin: 24rpx 24rpx 0;
  padding: 30rpx;
  border-radius: 32rpx;
  color: #ffffff;
  background: linear-gradient(135deg, #0b72ff, #16a1ff 68%, #56d1d8);
  box-shadow: 0 18rpx 40rpx rgba(12, 91, 190, 0.18);
}

.hero-ready { opacity: 1; }
.hero-pending { filter: saturate(0.92); }
.hero-danger {
  background: linear-gradient(135deg, #c85757, #ef7a5a);
}

.hero-top,
.hero-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.hero-angle {
  min-width: 128rpx;
  padding: 18rpx 20rpx;
  border-radius: 24rpx;
  text-align: center;
  font-size: 42rpx;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.16);
}
```

- [ ] **Step 3: Increase the control panel emphasis and selected-angle feedback**

```css
.control-panel {
  padding: 32rpx 28rpx;
}

.slider-shell {
  padding: 18rpx 18rpx 12rpx;
  border-radius: 24rpx;
  background: linear-gradient(180deg, #f6faff, #edf4fe);
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  margin-top: 24rpx;
}

.preset-button {
  margin: 0;
  min-height: 88rpx;
  border-radius: 24rpx;
  color: #1c3550;
  background: #edf3fb;
}

.preset-active {
  color: #ffffff;
  background: linear-gradient(135deg, #0b72ff, #198dff);
  box-shadow: 0 12rpx 24rpx rgba(11, 114, 255, 0.22);
}

.send-button {
  margin: 0;
  min-height: 88rpx;
  border-radius: 24rpx;
  color: #ffffff;
  background: #17324d;
}
```

- [ ] **Step 4: Style compact connection and semi-expanded logs so they stay secondary but readable**

```css
.connection-panel-compact .device-section {
  opacity: 0.88;
}

.summary-stack {
  display: grid;
  gap: 12rpx;
  margin-bottom: 16rpx;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
  padding: 14rpx 18rpx;
  border-radius: 18rpx;
  background: #f4f7fc;
}

.summary-log {
  color: #25435f;
}

.text-button {
  margin: 0;
  padding: 0;
  background: transparent;
  color: #0b72ff;
  font-size: 24rpx;
}

.text-button::after {
  border: none;
}
```

- [ ] **Step 5: Run syntax and regression-oriented checks after the style pass**

Run: `D:\Program Files\nodejs\node.exe --check miniprogram\pages\index\index.js`

Expected: no output, exit code `0`

Run: `D:\Program Files\nodejs\node.exe --check miniprogram\utils\servo_helpers.js`

Expected: no output, exit code `0`

Run: `D:\Program Files\nodejs\node.exe --test tests\servo_helpers.test.js`

Expected: PASS

- [ ] **Step 6: Commit the styling checkpoint**

```bash
git add miniprogram/pages/index/index.wxss miniprogram/pages/index/index.wxml miniprogram/pages/index/index.js
git commit -m "feat: polish ble servo cockpit styling"
```

If the workspace is not a git repository, skip the commit and preserve the verification results.

---

### Task 5: End-To-End Verification Against The Spec

**Files:**
- Verify: `miniprogram/docs/superpowers/specs/2026-04-24-wechat-ble-interaction-polish-design.md`
- Verify: `miniprogram/miniprogram/pages/index/index.js`
- Verify: `miniprogram/miniprogram/pages/index/index.wxml`
- Verify: `miniprogram/miniprogram/pages/index/index.wxss`
- Verify: `miniprogram/miniprogram/utils/servo_helpers.js`
- Verify: `miniprogram/tests/servo_helpers.test.js`

- [ ] **Step 1: Run the full local code verification commands**

Run: `D:\Program Files\nodejs\node.exe --test tests\servo_helpers.test.js`

Expected: PASS

Run: `D:\Program Files\nodejs\node.exe --check miniprogram\pages\index\index.js`

Expected: no output, exit code `0`

Run: `D:\Program Files\nodejs\node.exe --check miniprogram\utils\servo_helpers.js`

Expected: no output, exit code `0`

- [ ] **Step 2: Manually verify the page against the approved design**

Check in WeChat DevTools:

- top hero card shows control availability, device, current angle, and recent action
- slider and preset buttons both feel primary
- connection region compresses when controllable and becomes more prominent when disconnected
- summary area shows only latest meaningful items
- full log list expands and collapses correctly
- send buttons disable when BLE is not controllable

- [ ] **Step 3: Manually verify BLE regressions with the HC-04 module**

Check on device:

- auto reconnect still works
- manual scan and connect still works
- preset buttons still send `A<angle>\n`
- slider release still sends a single command in default mode
- realtime mode still sends throttled updates
- previously fixed HC-04 UUID selection still logs the correct service/characteristic choice

- [ ] **Step 4: Record any gaps against the design spec before declaring completion**

Use this checklist:

- [ ] top status card implements immediate status layer
- [ ] full logs still contain debug detail layer
- [ ] summary logs are newest-first
- [ ] selected or recent angle is visible without opening logs
- [ ] success feedback is non-interruptive
- [ ] connection failure state clearly surfaces the connection area

- [ ] **Step 5: Commit the final verified state**

```bash
git add miniprogram/pages/index/index.js miniprogram/pages/index/index.wxml miniprogram/pages/index/index.wxss miniprogram/utils/servo_helpers.js tests/servo_helpers.test.js
git commit -m "feat: polish wechat ble servo interaction"
```

If the workspace is not a git repository, skip the commit and report the exact verification commands and manual checks that passed.
