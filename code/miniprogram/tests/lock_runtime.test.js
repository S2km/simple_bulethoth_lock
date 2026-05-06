const test = require('node:test')
const assert = require('node:assert/strict')

const {
  computeSessionMac,
  createDefaultLockProfile,
  stringToArrayBuffer,
} = require('../miniprogram/utils/servo_helpers')
const { createLockRuntime } = require('../miniprogram/utils/lock_runtime')
const {
  normalizeRssiThresholdDraft,
  normalizeRssiThresholdValue,
} = require('../miniprogram/utils/settings_helpers')

function createFakeTimers() {
  const scheduled = []

  return {
    scheduled,
    setTimeout(fn, delay) {
      const handle = { kind: 'timeout', fn, delay, cleared: false }
      scheduled.push(handle)
      return handle
    },
    clearTimeout(handle) {
      if (handle) {
        handle.cleared = true
      }
    },
    setInterval(fn, delay) {
      const handle = { kind: 'interval', fn, delay, cleared: false }
      scheduled.push(handle)
      return handle
    },
    clearInterval(handle) {
      if (handle) {
        handle.cleared = true
      }
    },
  }
}

function createFakeWx() {
  const storage = new Map()

  return {
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : undefined
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    writeBLECharacteristicValue(options) {
      if (options && typeof options.success === 'function') {
        options.success({})
      }
    },
    closeBLEConnection(options) {
      if (options && typeof options.complete === 'function') {
        options.complete({})
      }
    },
    onBluetoothDeviceFound() {},
    onBLEConnectionStateChange() {},
    onBLECharacteristicValueChange() {},
    offBluetoothDeviceFound() {},
    offBLEConnectionStateChange() {},
    offBLECharacteristicValueChange() {},
    openBluetoothAdapter(options) {
      if (options && typeof options.success === 'function') {
        options.success({})
      }
    },
    closeBluetoothAdapter(options) {
      if (options && typeof options.complete === 'function') {
        options.complete({})
      }
    },
    stopBluetoothDevicesDiscovery(options) {
      if (options && typeof options.complete === 'function') {
        options.complete({})
      }
    },
    startBluetoothDevicesDiscovery(options) {
      if (options && typeof options.success === 'function') {
        options.success({})
      }
    },
    getBLEDeviceRSSI(options) {
      if (options && typeof options.success === 'function') {
        options.success({ RSSI: -55 })
      }
    },
    createBLEConnection(options) {
      if (options && typeof options.success === 'function') {
        options.success({})
      }
    },
    getBLEDeviceServices(options) {
      if (options && typeof options.success === 'function') {
        options.success({
          services: [
            {
              uuid: '0000FFE0-0000-1000-8000-00805F9B34FB',
              isPrimary: true,
            },
          ],
        })
      }
    },
    getBLEDeviceCharacteristics(options) {
      if (options && typeof options.success === 'function') {
        options.success({
          characteristics: [
            {
              uuid: '0000FFE1-0000-1000-8000-00805F9B34FB',
              properties: { write: true, notify: true, indicate: false, writeNoResponse: false },
            },
          ],
        })
      }
    },
    notifyBLECharacteristicValueChange(options) {
      if (options && typeof options.success === 'function') {
        options.success({})
      }
    },
  }
}

function createConfiguredRuntime() {
  const wx = createFakeWx()
  const timers = createFakeTimers()
  const runtime = createLockRuntime({ wx, timers, autoInit: false })

  runtime.state.isConnected = true
  runtime.state.deviceId = 'dev-1'
  runtime.state.deviceName = 'HC-04BLE'
  runtime.state.serviceId = 'service-1'
  runtime.state.writeCharacteristicId = 'write-1'
  runtime.state.lockProfile = createDefaultLockProfile('dev-1', 'HC-04BLE')
  runtime.state.selectedRelockSeconds = 5
  runtime.state.sessionChallenge = '89ABCDEF'
  runtime.updateDerivedView()

  return { runtime, wx, timers }
}

test('runtime exposes a shared page-shell API surface', () => {
  const { runtime } = createConfiguredRuntime()

  assert.equal(typeof runtime.init, 'function')
  assert.equal(typeof runtime.subscribe, 'function')
  assert.equal(typeof runtime.getSnapshot, 'function')
  assert.ok(runtime.actions)
  assert.equal(typeof runtime.actions.init, 'function')
  assert.equal(typeof runtime.actions.destroy, 'function')

  const snapshot = runtime.getSnapshot()
  assert.equal(snapshot.deviceId, 'dev-1')
  assert.equal(snapshot.selectedRelockSeconds, 5)
})

test('relock changes wait for OK responses and STATUS REL stays authoritative', async () => {
  const { runtime } = createConfiguredRuntime()

  runtime.pendingRelockSeconds = 8
  await runtime.handleConfigResult({
    kind: 'config_result',
    action: 'RELOCK',
    ok: false,
  })

  assert.equal(runtime.state.selectedRelockSeconds, 5)
  assert.equal(runtime.state.lockProfile.relockSeconds, 5)

  runtime.pendingRelockSeconds = 8
  await runtime.handleConfigResult({
    kind: 'config_result',
    action: 'RELOCK',
    ok: true,
  })

  assert.equal(runtime.state.selectedRelockSeconds, 8)
  assert.equal(runtime.state.lockProfile.relockSeconds, 8)

  runtime.applyStatusResponse({
    kind: 'status',
    lockState: 'UNLOCK',
    authActive: true,
    windowSeconds: 27,
    relockSeconds: 3,
  })

  assert.equal(runtime.state.selectedRelockSeconds, 3)
  assert.equal(runtime.state.lockProfile.relockSeconds, 3)
  assert.equal(runtime.autoRelockStatusTimer.delay, 4200)
})

test('bind and unbind mutations only change persisted profile state after OK responses', async () => {
  const { runtime } = createConfiguredRuntime()

  runtime.pendingBindRequest = {
    clientId: 'PHONE-A',
    clientKey: 'ABCDEF1234567890',
    nickname: 'Alice',
  }
  await runtime.handleConfigResult({
    kind: 'config_result',
    action: 'BIND',
    ok: false,
  })

  assert.equal(runtime.state.currentClientId, '')
  assert.equal(runtime.state.lockProfile.clientId, '')

  runtime.pendingBindRequest = {
    clientId: 'PHONE-A',
    clientKey: 'ABCDEF1234567890',
    nickname: 'Alice',
  }
  await runtime.handleConfigResult({
    kind: 'config_result',
    action: 'BIND',
    ok: true,
  })

  assert.equal(runtime.state.currentClientId, 'PHONE-A')
  assert.equal(runtime.state.lockProfile.clientId, 'PHONE-A')
  assert.equal(runtime.state.lockProfile.clientKey, 'ABCDEF1234567890')

  runtime.pendingUnbindClientId = 'PHONE-B'
  await runtime.handleConfigResult({
    kind: 'config_result',
    action: 'UNBIND',
    ok: true,
  })

  assert.equal(runtime.state.currentClientId, 'PHONE-A')
  assert.equal(runtime.state.lockProfile.clientId, 'PHONE-A')

  runtime.state.lockProfile.autoAuth = true
  runtime.state.lockProfile.proximityUnlock = true
  runtime.pendingUnbindClientId = 'PHONE-A'
  await runtime.handleConfigResult({
    kind: 'config_result',
    action: 'UNBIND',
    ok: true,
  })

  assert.equal(runtime.state.currentClientId, '')
  assert.equal(runtime.state.lockProfile.clientId, '')
  assert.equal(runtime.state.lockProfile.autoAuth, false)
  assert.equal(runtime.state.lockProfile.proximityUnlock, false)
})

test('writeCommand redacts PIN-family payloads before they enter logs', async () => {
  const { runtime } = createConfiguredRuntime()

  await runtime.writeCommand('PIN 123456\n')
  await runtime.writeCommand('TPIN PHONE-A 123456\n')
  await runtime.writeCommand('PINSET 123456 654321\n')

  const text = runtime.state.logs.map((entry) => entry.text).join('\n')

  assert.match(text, /send: PIN \[REDACTED\]/)
  assert.match(text, /send: TPIN \[REDACTED\]/)
  assert.match(text, /send: PINSET \[REDACTED\]/)
  assert.doesNotMatch(text, /123456/)
  assert.doesNotMatch(text, /654321/)
})

test('authenticate sends a session-proof PIN command', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }
  runtime.setState({
    authPin: '123456',
    authLockedSeconds: 0,
    requiresProvisioning: false,
  })

  const sent = await runtime.actions.authenticate()
  const mac = computeSessionMac('123456', '89ABCDEF', 'PIN', '123456')

  assert.equal(sent, true)
  assert.deepEqual(commands, [`PIN 123456 ${mac}\n`])
})

test('auth fail with zero failures refreshes challenge and retries once', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    if (String(command).trim() === 'STATUS') {
      runtime.setState({ sessionChallenge: '13572468' })
    }
    return true
  }
  runtime.setState({
    authPin: '123456',
    authPinDraft: '123456',
    authLockedSeconds: 0,
    requiresProvisioning: false,
  })

  await runtime.actions.authenticate()
  await runtime.handleBleValueChange({
    value: stringToArrayBuffer('AUTH FAIL 0\r\n'),
  })

  const firstMac = computeSessionMac('123456', '89ABCDEF', 'PIN', '123456')
  const retryMac = computeSessionMac('123456', '13572468', 'PIN', '123456')

  assert.deepEqual(commands, [
    `PIN 123456 ${firstMac}\n`,
    'STATUS\n',
    `PIN 123456 ${retryMac}\n`,
  ])
})

test('ensureSessionChallenge waits for async status challenge updates', async () => {
  const { runtime, timers } = createConfiguredRuntime()
  runtime.state.sessionChallenge = ''
  timers.setTimeout = (fn, delay) => {
    const handle = { kind: 'timeout', fn, delay, cleared: false }
    fn()
    return handle
  }

  runtime.writeCommand = async () => {
    timers.setTimeout(() => {
      runtime.setState({ sessionChallenge: '13572468' })
    }, 10)
    return true
  }

  const ready = await runtime.ensureSessionChallenge()
  assert.equal(ready, true)
  assert.equal(runtime.state.sessionChallenge, '13572468')
})

test('sendLockAction sends a session-proof lock command', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }
  runtime.state.authPin = '123456'
  runtime.state.canUnlock = true
  runtime.state.canSend = true

  const sent = await runtime.actions.sendLockAction('UNLOCK')
  const mac = computeSessionMac('123456', '89ABCDEF', 'UNLOCK')

  assert.equal(sent, true)
  assert.deepEqual(commands, [`UNLOCK ${mac}\n`])
})

test('manual auth session keeps using pin secret for follow-up unlock', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }
  runtime.state.authPin = '123456'
  runtime.state.authPinDraft = '123456'
  runtime.state.lockProfile.clientKey = 'AAAABBBBCCCCDDDD'
  runtime.state.sessionProofSource = 'pin'
  runtime.state.canUnlock = true
  runtime.state.canSend = true

  const sent = await runtime.actions.sendLockAction('UNLOCK')
  const mac = computeSessionMac('123456', '89ABCDEF', 'UNLOCK')

  assert.equal(sent, true)
  assert.deepEqual(commands, [`UNLOCK ${mac}\n`])
})

test('setRelockSeconds sends a session-proof relock command', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }
  runtime.state.authPin = '123456'
  runtime.state.profileSettingsEnabled = true

  const sent = await runtime.actions.setRelockSeconds(8)
  const mac = computeSessionMac('123456', '89ABCDEF', 'RELOCK', '8')

  assert.equal(sent, true)
  assert.deepEqual(commands, [`RELOCK 8 ${mac}\n`])
})

test('unbindPhone sends a session-proof unbind command', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }
  runtime.state.authPin = '123456'
  runtime.state.profileSettingsEnabled = true

  const sent = await runtime.actions.unbindPhone('PHONE-A')
  const mac = computeSessionMac('123456', '89ABCDEF', 'UNBIND', 'PHONE-A')

  assert.equal(sent, true)
  assert.deepEqual(commands, [`UNBIND PHONE-A ${mac}\n`])
})

test('status responses keep runtime provisioning state aligned with firmware', () => {
  const { runtime } = createConfiguredRuntime()

  runtime.setState({ requiresProvisioning: false })
  runtime.applyStatusResponse({
    kind: 'status',
    lockState: 'LOCK',
    authActive: false,
    angle: 0,
    relockSeconds: 5,
    provisioned: false,
  })
  assert.equal(runtime.state.requiresProvisioning, true)

  runtime.applyStatusResponse({
    kind: 'status',
    lockState: 'LOCK',
    authActive: false,
    angle: 0,
    relockSeconds: 5,
    provisioned: true,
  })
  assert.equal(runtime.state.requiresProvisioning, false)
})

test('changePin uses PINSET INIT when provisioning is required', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }

  runtime.setState({
    requiresProvisioning: true,
    newPin: '654321',
    newPinConfirm: '654321',
    authPin: '',
  })

  const sent = await runtime.actions.changePin()
  assert.equal(sent, true)
  const mac = computeSessionMac('', '89ABCDEF', 'PINSET', '', '654321')
  assert.deepEqual(commands, [`PINSET INIT 654321 ${mac}\n`])
  assert.deepEqual(runtime.pendingPinChange, {
    newPin: '654321',
    persistLocalPin: false,
  })
})

test('loadLockProfile preserves saved PIN when local persistence is enabled', () => {
  const wx = createFakeWx()
  const runtime = createLockRuntime({ wx, timers: createFakeTimers(), autoInit: false })

  wx.setStorageSync('ble-lock-profile-map', {
    'dev-1': {
      ...createDefaultLockProfile('dev-1', 'HC-04BLE'),
      savePinEnabled: true,
      savedPin: '123456',
      autoConnect: true,
    },
  })

  const profile = runtime.loadLockProfile('dev-1', 'HC-04BLE')
  assert.equal(profile.savePinEnabled, true)
  assert.equal(profile.savedPin, '123456')
})

test('save PIN toggle persists current PIN for the active lock profile', () => {
  const { runtime, wx } = createConfiguredRuntime()

  runtime.state.authPin = '123456'
  runtime.state.lockProfile.savedPin = ''
  runtime.state.lockProfile.savePinEnabled = false
  runtime.state.profileSettingsEnabled = true

  runtime.actions.handleSavePinToggle(true)

  const storedMap = wx.getStorageSync('ble-lock-profile-map')
  assert.equal(runtime.state.lockProfile.savePinEnabled, true)
  assert.equal(runtime.state.lockProfile.savedPin, '123456')
  assert.match(runtime.state.logs[0].text, /生产模式下不再在本地保存 PIN/)
})

test('connectDevice restores authPin from persisted profile data when save PIN is enabled', async () => {
  const wx = createFakeWx()
  wx.setStorageSync('ble-lock-profile-map', {
    'dev-1': {
      ...createDefaultLockProfile('dev-1', 'HC-04BLE'),
      savePinEnabled: true,
      savedPin: '123456',
    },
  })
  const runtime = createLockRuntime({ wx, timers: createFakeTimers(), autoInit: false })
  runtime.discoverServices = async () => ({
    serviceId: 'service-1',
    writeCharacteristicId: 'write-1',
    notifyCharacteristicId: 'notify-1',
  })
  runtime.enableNotifications = async () => {}
  runtime.writeCommand = async () => true
  runtime.stopScan = async () => {}

  await runtime.connectDevice('dev-1', 'HC-04BLE', false)

  assert.equal(runtime.state.authPin, '123456')
  assert.equal(runtime.state.authPinDraft, '123456')
  assert.equal(runtime.state.lockProfile.savedPin, '123456')
})

test('setAuthPin syncs the saved PIN when local persistence is enabled', () => {
  const { runtime, wx } = createConfiguredRuntime()

  runtime.state.profileSettingsEnabled = true
  runtime.state.lockProfile.savePinEnabled = true

  runtime.actions.setAuthPin('654321')

  const storedMap = wx.getStorageSync('ble-lock-profile-map')
  assert.equal(runtime.state.lockProfile.savedPin, '654321')
  assert.equal(storedMap['dev-1'].savedPin, '654321')
})

test('rssi threshold draft preserves partial negative input during editing', () => {
  assert.equal(normalizeRssiThresholdDraft('-'), '-')
  assert.equal(normalizeRssiThresholdDraft('-6'), '-6')
  assert.equal(normalizeRssiThresholdDraft('-60'), '-60')
})

test('rssi threshold value normalizes to supported range on commit', () => {
  assert.equal(normalizeRssiThresholdValue('-', -60), -60)
  assert.equal(normalizeRssiThresholdValue('-12', -60), -35)
  assert.equal(normalizeRssiThresholdValue('-99', -60), -95)
  assert.equal(normalizeRssiThresholdValue('-66', -60), -66)
})

test('auto auth toggle requires a current-session PIN credential', () => {
  const { runtime } = createConfiguredRuntime()
  runtime.state.profileSettingsEnabled = true
  runtime.state.lockProfile.clientKey = ''

  runtime.actions.handleAutoAuthToggle(true)

  assert.equal(runtime.state.lockProfile.autoAuth, false)
  assert.match(runtime.state.logs[0].text, /请先完成可信手机绑定/)
})

test('proximity auto auth uses the current-session PIN instead of saved storage', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []
  const originalNow = Date.now

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }
  runtime.state.lockProfile.clientId = 'PHONE-A'
  runtime.state.lockProfile.clientKey = 'AAAABBBBCCCCDDDD'
  runtime.state.lockProfile.autoAuth = true
  runtime.state.lockProfile.proximityUnlock = true
  runtime.state.currentRssi = -55

  try {
    Date.now = () => 0
    await runtime.handleRssiSample(-55)
    Date.now = () => 2200
    await runtime.handleRssiSample(-55)
  } finally {
    Date.now = originalNow
  }

  const mac = computeSessionMac('AAAABBBBCCCCDDDD', '89ABCDEF', 'TPIN', 'PHONE-A')
  assert.deepEqual(commands, [`TPIN PHONE-A ${mac}\n`])
  assert.equal(runtime.state.automationStateLabel, '距离已满足，正在自动认证')
})

test('sendLockAction prefers trusted-phone key as session proof secret when available', async () => {
  const { runtime } = createConfiguredRuntime()
  const commands = []

  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }
  runtime.state.authPin = '123456'
  runtime.state.lockProfile.clientKey = 'AAAABBBBCCCCDDDD'
  runtime.state.sessionProofSource = 'clientKey'
  runtime.state.canUnlock = true
  runtime.state.canSend = true

  const sent = await runtime.actions.sendLockAction('UNLOCK')
  const mac = computeSessionMac('AAAABBBBCCCCDDDD', '89ABCDEF', 'UNLOCK')

  assert.equal(sent, true)
  assert.deepEqual(commands, [`UNLOCK ${mac}\n`])
})

test('bindCurrentPhone reuses one stable persisted app client id', async () => {
  const { runtime, wx } = createConfiguredRuntime()
  const commands = []

  runtime.state.profileSettingsEnabled = true
  runtime.state.bindNickname = ''
  runtime.writeCommand = async (command) => {
    commands.push(command)
    return true
  }

  const first = await runtime.actions.bindCurrentPhone()
  const storedClientId = wx.getStorageSync('ble-lock-app-client-id')
  const storedClientKey = wx.getStorageSync('ble-lock-app-client-key')

  assert.equal(first, true)
  assert.match(storedClientId, /^PHONE-[0-9A-F]+-[0-9A-F]{8}$/)
  assert.match(storedClientKey, /^[0-9A-F]{16}$/)
  assert.equal(runtime.pendingBindRequest.clientId, storedClientId)
  assert.equal(runtime.pendingBindRequest.clientKey, storedClientKey)
  const firstMac = computeSessionMac('', '89ABCDEF', 'BIND', storedClientId, storedClientKey, 'MY_PHONE')
  assert.equal(commands[0], `BIND ${storedClientId} ${storedClientKey} MY_PHONE ${firstMac}\n`)

  runtime.pendingBindRequest = null
  commands.length = 0

  const second = await runtime.actions.bindCurrentPhone()
  assert.equal(second, true)
  assert.equal(runtime.pendingBindRequest.clientId, storedClientId)
  assert.equal(runtime.pendingBindRequest.clientKey, storedClientKey)
  const secondMac = computeSessionMac('', '89ABCDEF', 'BIND', storedClientId, storedClientKey, 'MY_PHONE')
  assert.equal(commands[0], `BIND ${storedClientId} ${storedClientKey} MY_PHONE ${secondMac}\n`)
})

test('trust list mismatch clears stale trusted-phone automation state', async () => {
  const { runtime } = createConfiguredRuntime()

  runtime.state.lockProfile.clientId = 'PHONE-A'
  runtime.state.lockProfile.clientKey = 'AAAABBBBCCCCDDDD'
  runtime.state.lockProfile.autoAuth = true
  runtime.state.lockProfile.proximityUnlock = true

  await runtime.handleBleValueChange({
    value: stringToArrayBuffer('TRUST LIST PHONE-A|1111222233334444|Alice|1\r\n'),
  })

  assert.equal(runtime.state.lockProfile.clientId, '')
  assert.equal(runtime.state.lockProfile.clientKey, '')
  assert.equal(runtime.state.lockProfile.autoAuth, false)
  assert.equal(runtime.state.lockProfile.proximityUnlock, false)
  assert.equal(typeof runtime.state.automationStateLabel, 'string')
})

test('AUTH UNPROVISIONED responses move runtime into initial setup mode', async () => {
  const { runtime } = createConfiguredRuntime()

  runtime.setState({
    requiresProvisioning: false,
    authAuthorized: true,
    authRemainingSeconds: 18,
    authLockedSeconds: 0,
  })

  await runtime.handleBleValueChange({
    value: stringToArrayBuffer('AUTH UNPROVISIONED\r\n'),
  })

  assert.equal(runtime.state.requiresProvisioning, true)
  assert.equal(runtime.state.authAuthorized, false)
  assert.equal(runtime.state.authRemainingSeconds, 0)
  assert.equal(runtime.state.authLockedSeconds, 0)
})
