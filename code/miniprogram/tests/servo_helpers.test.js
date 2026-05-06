const test = require('node:test')
const assert = require('node:assert/strict')

const {
  arrayBufferToAscii,
  buildBindCommand,
  buildDeviceListView,
  buildAuthViewState,
  buildTrustedPhoneListView,
  buildConnectionViewState,
  buildLockCommand,
  buildBindCommandWithKey,
  buildSessionProofCommand,
  buildPinSetCommand,
  buildPinSetInitCommand,
  buildRecentActionSummary,
  buildRelockCommand,
  buildServoControlAccessState,
  buildPinCommand,
  buildTrustedPinCommand,
  buildUnbindCommand,
  clampAngle,
  computeSessionMac,
  buildAngleCommand,
  createDefaultLockProfile,
  findPreferredDeviceName,
  getPreferredProfile,
  mergeLockProfile,
  normalizeClientId,
  normalizeNickname,
  parseLockResponse,
  pickCharacteristicIds,
  pickSummaryLogs,
  normalizeUuid,
  sortDeviceList,
  stringToArrayBuffer,
  upsertDevice,
  makeLogEntry,
} = require('../miniprogram/utils/servo_helpers')

test('clampAngle limits values to 0..180 integers', () => {
  assert.equal(clampAngle(-4), 0)
  assert.equal(clampAngle(45.8), 46)
  assert.equal(clampAngle(999), 180)
})

test('buildAngleCommand formats prefixed servo command', () => {
  assert.equal(buildAngleCommand(90), 'A90\n')
})

test('stringToArrayBuffer and arrayBufferToAscii round-trip ASCII BLE payloads', () => {
  const buffer = stringToArrayBuffer('A135\n')
  assert.equal(arrayBufferToAscii(buffer), 'A135\n')
})

test('upsertDevice inserts and updates discovered BLE devices', () => {
  const devices = []
  const first = upsertDevice(devices, { deviceId: '1', name: 'HC-04BLE', RSSI: -60 })
  assert.equal(first.length, 1)
  const second = upsertDevice(first, { deviceId: '1', name: 'HC-04BLE', RSSI: -40 })
  assert.equal(second.length, 1)
  assert.equal(second[0].RSSI, -40)
})

test('pickCharacteristicIds finds writable and notifiable characteristic ids', () => {
  const result = pickCharacteristicIds([
    {
      uuid: 'write-char',
      properties: { write: true, notify: false, indicate: false, writeNoResponse: false },
    },
    {
      uuid: 'notify-char',
      properties: { write: false, notify: true, indicate: false, writeNoResponse: false },
    },
  ])

  assert.equal(result.writeCharacteristicId, 'write-char')
  assert.equal(result.notifyCharacteristicId, 'notify-char')
})

test('pickCharacteristicIds prefers known HC-04 characteristic uuids', () => {
  const profile = getPreferredProfile('49535343-FE7D-4AE5-8FA9-9FAFD205E455')
  const result = pickCharacteristicIds(
    [
      {
        uuid: 'random-write-char',
        properties: { write: true, notify: false, indicate: false, writeNoResponse: false },
      },
      {
        uuid: '49535343-1e4d-4bd9-ba61-23c647249616',
        properties: { write: false, notify: true, indicate: false, writeNoResponse: false },
      },
      {
        uuid: '49535343-8841-43f4-a8d4-ecbe34729bb3',
        properties: { write: true, notify: false, indicate: false, writeNoResponse: false },
      },
    ],
    profile,
  )

  assert.equal(result.writeCharacteristicId, '49535343-8841-43f4-a8d4-ecbe34729bb3')
  assert.equal(result.notifyCharacteristicId, '49535343-1e4d-4bd9-ba61-23c647249616')
})

test('normalizeUuid uppercases and trims UUID text', () => {
  assert.equal(
    normalizeUuid(' 49535343-8841-43f4-a8d4-ecbe34729bb3 '),
    '49535343-8841-43F4-A8D4-ECBE34729BB3',
  )
})

test('makeLogEntry keeps readable timestamped log text', () => {
  const entry = makeLogEntry('connected')
  assert.match(entry.id, /^log-/)
  assert.match(entry.text, /connected/)
})

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
    label: '可控制',
    detail: 'HC-04BLE',
    canSend: true,
    compactConnectionPanel: true,
  })
})

test('buildConnectionViewState returns reconnecting state before scan fallback', () => {
  const result = buildConnectionViewState({
    adapterReady: true,
    isScanning: true,
    isConnected: false,
    reconnecting: true,
    deviceName: 'HC-04BLE',
    serviceId: '',
    writeCharacteristicId: '',
  })

  assert.equal(result.label, '重连中')
  assert.equal(result.canSend, false)
  assert.equal(result.compactConnectionPanel, false)
})

test('buildConnectionViewState returns bluetooth-off state when adapter is unavailable', () => {
  const result = buildConnectionViewState({
    adapterReady: false,
    isScanning: true,
    isConnected: true,
    reconnecting: true,
    deviceName: 'HC-04BLE',
    serviceId: '0000FFE0-0000-1000-8000-00805F9B34FB',
    writeCharacteristicId: '0000FFE1-0000-1000-8000-00805F9B34FB',
  })

  assert.deepEqual(result, {
    tone: 'danger',
    label: '蓝牙不可用',
    detail: '适配器不可用',
    canSend: false,
    compactConnectionPanel: false,
  })
})

test('buildConnectionViewState returns scanning state when scanning and not reconnecting', () => {
  const result = buildConnectionViewState({
    adapterReady: true,
    isScanning: true,
    isConnected: false,
    reconnecting: false,
    deviceName: 'HC-04BLE',
    serviceId: '',
    writeCharacteristicId: '',
  })

  assert.equal(result.label, '扫描中')
  assert.equal(result.detail, '正在搜索附近设备')
  assert.equal(result.compactConnectionPanel, false)
})

test('buildConnectionViewState returns disconnected fallback when idle and not connected', () => {
  const result = buildConnectionViewState({
    adapterReady: true,
    isScanning: false,
    isConnected: false,
    reconnecting: false,
    deviceName: 'HC-04BLE',
    serviceId: '',
    writeCharacteristicId: '',
  })

  assert.deepEqual(result, {
    tone: 'idle',
    label: '未连接',
    detail: 'HC-04BLE',
    canSend: false,
    compactConnectionPanel: false,
  })
})

test('pickSummaryLogs keeps only connection send and error logs in newest-first order', () => {
  const logs = [
    makeLogEntry('write failed: timeout'),
    makeLogEntry('services found: 2'),
    makeLogEntry('connected: HC-04BLE'),
    makeLogEntry('send: A90'),
    makeLogEntry('chars: 0000FFE1(...)'),
  ]

  const result = pickSummaryLogs(logs, 3)

  assert.deepEqual(
    result.map((item) => item.text),
    [logs[0].text, logs[2].text, logs[3].text],
  )
})

test('pickSummaryLogs coerces numeric-string limit values', () => {
  const logs = [
    makeLogEntry('send: A135'),
    makeLogEntry('connected: HC-04BLE'),
    makeLogEntry('write failed: timeout'),
  ]

  const result = pickSummaryLogs(logs, '2')
  assert.equal(result.length, 2)
  assert.equal(result[0].text, logs[0].text)
  assert.equal(result[1].text, logs[1].text)
})

test('buildRecentActionSummary prefers send result over passive logs', () => {
  const result = buildRecentActionSummary([
    makeLogEntry('services found: 2'),
    makeLogEntry('send: A135'),
  ])

  assert.equal(result, '最近发送 A135')
})

test('buildRecentActionSummary returns waiting text when no summary logs exist', () => {
  assert.equal(buildRecentActionSummary([]), '等待操作')
})

test('buildRecentActionSummary transforms connected logs into friendly text', () => {
  const result = buildRecentActionSummary([
    makeLogEntry('connected: HC-04BLE'),
  ])

  assert.equal(result, '已连接 HC-04BLE')
})

test('sortDeviceList keeps HC-04BLE ahead of stronger RSSI devices', () => {
  const result = sortDeviceList([
    { deviceId: '2', name: 'Other Device', RSSI: -20 },
    { deviceId: '1', name: 'HC-04BLE', RSSI: -80 },
    { deviceId: '3', name: 'Sensor', RSSI: -40 },
  ])

  assert.equal(result[0].name, 'HC-04BLE')
  assert.equal(result[1].name, 'Other Device')
  assert.equal(result[2].name, 'Sensor')
})

test('buildDeviceListView collapses to five devices and exposes show more state', () => {
  const result = buildDeviceListView(
    [
      { deviceId: '1', name: 'HC-04BLE', RSSI: -60 },
      { deviceId: '2', name: 'Device 2', RSSI: -50 },
      { deviceId: '3', name: 'Device 3', RSSI: -51 },
      { deviceId: '4', name: 'Device 4', RSSI: -52 },
      { deviceId: '5', name: 'Device 5', RSSI: -53 },
      { deviceId: '6', name: 'Device 6', RSSI: -54 },
    ],
    false,
    5,
  )

  assert.equal(result.visibleDevices.length, 5)
  assert.equal(result.showToggle, true)
  assert.equal(result.toggleText, '展开更多')
  assert.equal(result.preferredDeviceName, 'HC-04BLE')
  assert.equal(result.visibleDevices[0].isPreferred, true)
  assert.equal(result.visibleDevices[0].preferredTagText, '优先目标设备')
  assert.equal(result.visibleDevices[1].isPreferred, false)
})

test('buildDeviceListView returns all devices and show less state when expanded', () => {
  const result = buildDeviceListView(
    [
      { deviceId: '1', name: 'HC-04BLE', RSSI: -60 },
      { deviceId: '2', name: 'Device 2', RSSI: -50 },
      { deviceId: '3', name: 'Device 3', RSSI: -51 },
      { deviceId: '4', name: 'Device 4', RSSI: -52 },
      { deviceId: '5', name: 'Device 5', RSSI: -53 },
      { deviceId: '6', name: 'Device 6', RSSI: -54 },
    ],
    true,
    5,
  )

  assert.equal(result.visibleDevices.length, 6)
  assert.equal(result.showToggle, true)
  assert.equal(result.toggleText, '收起列表')
})

test('findPreferredDeviceName returns HC-04BLE when present in discovered devices', () => {
  const result = findPreferredDeviceName([
    { deviceId: '2', name: 'Other Device', RSSI: -20 },
    { deviceId: '1', name: 'HC-04BLE', RSSI: -80 },
  ])

  assert.equal(result, 'HC-04BLE')
})

test('buildPinCommand formats PIN command with newline', () => {
  assert.equal(buildPinCommand('123456'), 'PIN 123456\n')
})

test('normalizeClientId uppercases and strips surrounding whitespace', () => {
  assert.equal(normalizeClientId(' phone-a '), 'PHONE-A')
})

test('normalizeNickname converts internal spaces to underscores for protocol safety', () => {
  assert.equal(normalizeNickname('Alice One'), 'Alice_One')
  assert.equal(normalizeNickname('本机 手机'), 'PHONE')
})

test('buildTrustedPinCommand formats trusted-phone auth command', () => {
  assert.equal(buildTrustedPinCommand('phone-a', '123456'), 'TPIN PHONE-A 123456\n')
})

test('buildSessionProofCommand formats session-proof commands', () => {
  assert.equal(buildSessionProofCommand('LOCK', '', '', 'ABCD1234'), 'LOCK ABCD1234\n')
  assert.equal(buildSessionProofCommand('PIN', '123456', '', '89ABCDEF'), 'PIN 123456 89ABCDEF\n')
})

test('computeSessionMac produces stable 8-hex proofs', () => {
  const mac = computeSessionMac('123456', '89ABCDEF', 'PIN', '123456')
  assert.match(mac, /^[0-9A-F]{8}$/)
  assert.equal(mac, computeSessionMac('123456', '89ABCDEF', 'PIN', '123456'))
  assert.notEqual(mac, computeSessionMac('123456', '89ABCDE0', 'PIN', '123456'))
})

test('buildPinSetCommand formats pin change command', () => {
  assert.equal(buildPinSetCommand('123456', '654321'), 'PINSET 123456 654321\n')
})

test('buildPinSetInitCommand formats initial provisioning command', () => {
  assert.equal(buildPinSetInitCommand('654321'), 'PINSET INIT 654321\n')
})

test('buildBindCommand formats trusted-phone bind command', () => {
  assert.equal(buildBindCommand('phone-a', 'Alice One'), 'BIND PHONE-A Alice_One\n')
})

test('buildBindCommandWithKey formats trusted-phone bind command with client key', () => {
  assert.equal(buildBindCommandWithKey('phone-a', 'abcd1234ef567890', 'Alice One'), 'BIND PHONE-A ABCD1234EF567890 Alice_One\n')
})

test('buildUnbindCommand formats trusted-phone unbind command', () => {
  assert.equal(buildUnbindCommand('phone-a'), 'UNBIND PHONE-A\n')
})

test('buildRelockCommand limits relock values to approved options', () => {
  assert.equal(buildRelockCommand(8), 'RELOCK 8\n')
})

test('buildLockCommand formats lock action commands', () => {
  assert.equal(buildLockCommand('LOCK'), 'LOCK\n')
  assert.equal(buildLockCommand('UNLOCK'), 'UNLOCK\n')
  assert.equal(buildLockCommand('STATUS'), 'STATUS\n')
})

test('parseLockResponse reads auth success and remaining seconds', () => {
  assert.deepEqual(parseLockResponse('AUTH OK 30 CHAL=1234ABCD'), {
    kind: 'auth_ok',
    remainingSeconds: 30,
    action: '',
    message: '认证已通过，剩余 30 秒',
    challenge: '1234ABCD',
  })
})

test('parseLockResponse reads auth lockout and remaining seconds', () => {
  assert.deepEqual(parseLockResponse('AUTH LOCKED 60'), {
    kind: 'auth_locked',
    remainingSeconds: 60,
    action: '',
    message: '失败次数过多，请在 60 秒后重试',
  })
})

test('parseLockResponse reads action ok responses', () => {
  assert.deepEqual(parseLockResponse('ACTION OK UNLOCK CHAL=89ABCDEF'), {
    kind: 'action_ok',
    remainingSeconds: 0,
    action: 'UNLOCK',
    message: '开锁成功',
    challenge: '89ABCDEF',
  })
})

test('parseLockResponse reads action ok status responses', () => {
  assert.deepEqual(parseLockResponse('ACTION OK STATUS'), {
    kind: 'action_ok',
    remainingSeconds: 0,
    action: 'STATUS',
    message: '状态已确认',
    challenge: '',
  })
})

test('parseLockResponse reads action ok angle responses', () => {
  assert.deepEqual(parseLockResponse('ACTION OK ANGLE'), {
    kind: 'action_ok',
    remainingSeconds: 0,
    action: 'ANGLE',
    message: '角度命令已确认',
    challenge: '',
  })
})

test('parseLockResponse reads lock status payload with lockout fields', () => {
  assert.deepEqual(parseLockResponse('STATUS LOCK AUTH=0 LOCKOUT=60 ANGLE=90 REL=8'), {
    kind: 'status',
    remainingSeconds: 0,
    action: 'LOCK',
    message: '状态 LOCK',
    lockState: 'LOCK',
    authActive: false,
    lockoutSeconds: 60,
    windowSeconds: undefined,
    angle: 90,
    relockSeconds: 8,
  })
})

test('parseLockResponse reads unlock status payload with auth window fields', () => {
  assert.deepEqual(parseLockResponse('STATUS UNLOCK AUTH=1 WINDOW=29 ANGLE=90 REL=5'), {
    kind: 'status',
    remainingSeconds: 0,
    action: 'UNLOCK',
    message: '状态 UNLOCK',
    lockState: 'UNLOCK',
    authActive: true,
    lockoutSeconds: undefined,
    windowSeconds: 29,
    angle: 90,
    relockSeconds: 5,
  })
})

test('parseLockResponse reads provisioning state from status payloads', () => {
  assert.deepEqual(parseLockResponse('STATUS LOCK AUTH=0 ANGLE=0 REL=5 PROV=0 CHAL=12AB34CD'), {
    kind: 'status',
    remainingSeconds: 0,
    action: 'LOCK',
    message: '状态 LOCK',
    lockState: 'LOCK',
    authActive: false,
    lockoutSeconds: undefined,
    windowSeconds: undefined,
    angle: 0,
    relockSeconds: 5,
    provisioned: false,
    challenge: '12AB34CD',
  })

  assert.deepEqual(parseLockResponse('STATUS UNLOCK AUTH=1 WINDOW=29 ANGLE=180 REL=8 PROV=1 CHAL=89ABCDEF'), {
    kind: 'status',
    remainingSeconds: 0,
    action: 'UNLOCK',
    message: '状态 UNLOCK',
    lockState: 'UNLOCK',
    authActive: true,
    lockoutSeconds: undefined,
    windowSeconds: 29,
    angle: 180,
    relockSeconds: 8,
    provisioned: true,
    challenge: '89ABCDEF',
  })
})

test('parseLockResponse reads config mutation acknowledgements', () => {
  assert.deepEqual(parseLockResponse('RELOCK OK CHAL=13572468'), {
    kind: 'config_result',
    remainingSeconds: 0,
    action: 'RELOCK',
    ok: true,
    message: '自动重锁设置已更新',
    rawMessage: 'RELOCK OK CHAL=13572468',
    challenge: '13572468',
  })
})

test('parseLockResponse reads failed config mutation acknowledgements', () => {
  assert.deepEqual(parseLockResponse('BIND FAIL'), {
    kind: 'config_result',
    remainingSeconds: 0,
    action: 'BIND',
    ok: false,
    message: '可信手机绑定失败',
    rawMessage: 'BIND FAIL',
    challenge: '',
  })
})

test('parseLockResponse reads auth fail responses', () => {
  assert.deepEqual(parseLockResponse('AUTH FAIL 3'), {
    kind: 'auth_fail',
    remainingSeconds: 0,
    failures: 3,
    action: '',
    message: 'PIN 错误（3/5）',
  })
})

test('parseLockResponse reads unprovisioned auth responses', () => {
  assert.deepEqual(parseLockResponse('AUTH UNPROVISIONED'), {
    kind: 'auth_unprovisioned',
    remainingSeconds: 0,
    action: '',
    message: '门锁尚未初始化，请先设置首个 PIN',
  })
})

test('parseLockResponse reads initial PIN setup required responses', () => {
  assert.deepEqual(parseLockResponse('PINSET INIT REQUIRED'), {
    kind: 'pinset_init_required',
    remainingSeconds: 0,
    action: 'PINSET',
    message: '请先完成初始 PIN 设置，再进行常规修改',
  })
})

test('parseLockResponse reads trusted-phone auth success', () => {
  assert.deepEqual(parseLockResponse('TPIN OK 30 CHAL=2468ACE0'), {
    kind: 'trusted_auth_ok',
    remainingSeconds: 30,
    action: '',
    message: '可信手机认证成功，剩余 30 秒',
    challenge: '2468ACE0',
  })
})

test('parseLockResponse reads trusted-phone denial for unknown client', () => {
  assert.deepEqual(parseLockResponse('TPIN DENY UNKNOWN_CLIENT'), {
    kind: 'trusted_auth_deny',
    remainingSeconds: 0,
    action: '',
    reason: 'UNKNOWN_CLIENT',
    message: '当前手机尚未绑定到此门锁',
  })
})

test('parseLockResponse uses generic trusted-phone denial message for other reasons', () => {
  assert.deepEqual(parseLockResponse('TPIN DENY RATE_LIMIT'), {
    kind: 'trusted_auth_deny',
    remainingSeconds: 0,
    action: '',
    reason: 'RATE_LIMIT',
    message: '可信手机认证失败',
  })
})

test('parseLockResponse reads empty trusted-phone list payloads', () => {
  assert.deepEqual(parseLockResponse('TRUST LIST'), {
    kind: 'trust_list',
    remainingSeconds: 0,
    action: '',
    message: '已收到可信手机列表',
    phones: [],
  })
})

test('parseLockResponse reads trusted-phone list payloads', () => {
  assert.deepEqual(parseLockResponse('TRUST LIST PHONEA|A1B2C3D4E5F60708|Alice|1;PHONEB|B1C2D3E4F5060708|Bob|0'), {
    kind: 'trust_list',
    remainingSeconds: 0,
    action: '',
    message: '已收到可信手机列表',
    phones: [
      { clientId: 'PHONEA', clientKey: 'A1B2C3D4E5F60708', nickname: 'Alice', enabled: true },
      { clientId: 'PHONEB', clientKey: 'B1C2D3E4F5060708', nickname: 'Bob', enabled: false },
    ],
  })
})

test('parseLockResponse skips malformed trusted-phone list rows', () => {
  assert.deepEqual(
    parseLockResponse(
      'TRUST LIST PHONEA|A1B2C3D4E5F60708|Alice|1;BROKEN;|Nick|1;PHONEB|B1C2D3E4F5060708|Bob|2;PHONEC|Carol|0|EXTRA; |Dana|1;PHONED|D1E2F3A4B5C60708|Dana|0',
    ),
    {
      kind: 'trust_list',
      remainingSeconds: 0,
      action: '',
      message: '已收到可信手机列表',
      phones: [
        { clientId: 'PHONEA', clientKey: 'A1B2C3D4E5F60708', nickname: 'Alice', enabled: true },
        { clientId: 'PHONED', clientKey: 'D1E2F3A4B5C60708', nickname: 'Dana', enabled: false },
      ],
    },
  )
})

test('parseLockResponse does not treat TRUST LISTX as a trusted-phone list response', () => {
  assert.deepEqual(parseLockResponse('TRUST LISTX'), {
    kind: 'unknown',
    remainingSeconds: 0,
    action: '',
    message: 'TRUST LISTX',
  })
})

test('parseLockResponse reads auth denial states', () => {
  assert.deepEqual(parseLockResponse('DENY AUTH REQUIRED'), {
    kind: 'deny_auth_required',
    remainingSeconds: 0,
    action: '',
    message: '请先认证再开锁',
  })
  assert.deepEqual(parseLockResponse('DENY AUTH EXPIRED'), {
    kind: 'deny_auth_expired',
    remainingSeconds: 0,
    action: '',
    message: '认证已过期',
  })
})

test('parseLockResponse falls back to unknown responses', () => {
  assert.deepEqual(parseLockResponse('WHATEVER ELSE'), {
    kind: 'unknown',
    remainingSeconds: 0,
    action: '',
    message: 'WHATEVER ELSE',
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
      authStateLabel: '已认证',
      authStateDetail: '剩余 18 秒',
      authActionEnabled: true,
      authTone: 'ready',
      canUnlock: true,
    },
  )
})

test('buildAuthViewState returns disconnected presentation', () => {
  assert.deepEqual(
    buildAuthViewState({
      isConnected: false,
      authAuthorized: false,
      authRemainingSeconds: 0,
      authLockedSeconds: 0,
    }),
    {
      authStateLabel: '未连接',
      authStateDetail: '请先连接 HC-04BLE',
      authActionEnabled: false,
      authTone: 'danger',
      canUnlock: false,
    },
  )
})

test('buildAuthViewState returns locked out presentation', () => {
  assert.deepEqual(
    buildAuthViewState({
      isConnected: true,
      authAuthorized: false,
      authRemainingSeconds: 0,
      authLockedSeconds: 60,
    }),
    {
      authStateLabel: '已锁定',
      authStateDetail: '60 秒后可重试',
      authActionEnabled: false,
      authTone: 'danger',
      canUnlock: false,
    },
  )
})

test('buildAuthViewState returns setup-required presentation when lock is unprovisioned', () => {
  assert.deepEqual(
    buildAuthViewState({
      isConnected: true,
      authAuthorized: false,
      authRemainingSeconds: 0,
      authLockedSeconds: 0,
      requiresProvisioning: true,
    }),
    {
      authStateLabel: '未初始化',
      authStateDetail: '可直接输入 PIN 尝试认证；如需设置或修改 PIN，请前往设置页',
      authActionEnabled: true,
      authTone: 'idle',
      canUnlock: false,
    },
  )
})

test('buildAuthViewState returns auth required default presentation', () => {
  assert.deepEqual(
    buildAuthViewState({
      isConnected: true,
      authAuthorized: false,
      authRemainingSeconds: 0,
      authLockedSeconds: 0,
    }),
    {
      authStateLabel: '需要认证',
      authStateDetail: '请输入 PIN 后再操作门锁',
      authActionEnabled: true,
      authTone: 'idle',
      canUnlock: false,
    },
  )
})

test('buildAuthViewState prioritizes remaining auth time for authorized presentation', () => {
  assert.deepEqual(
    buildAuthViewState({
      isConnected: true,
      authAuthorized: false,
      authRemainingSeconds: 18,
      authLockedSeconds: 0,
    }),
    {
      authStateLabel: '已认证',
      authStateDetail: '剩余 18 秒',
      authActionEnabled: true,
      authTone: 'ready',
      canUnlock: true,
    },
  )
})

test('buildServoControlAccessState hides servo controls in lock mode before auth', () => {
  assert.deepEqual(
    buildServoControlAccessState({
      lockMode: true,
      canUnlock: false,
      connectionCanSend: true,
    }),
    {
      showServoControls: false,
      canSendServo: false,
    },
  )
})

test('buildServoControlAccessState enables servo controls after auth in lock mode', () => {
  assert.deepEqual(
    buildServoControlAccessState({
      lockMode: true,
      canUnlock: true,
      connectionCanSend: true,
    }),
    {
      showServoControls: true,
      canSendServo: true,
    },
  )
})

test('createDefaultLockProfile returns safe local defaults', () => {
  assert.deepEqual(createDefaultLockProfile('dev-1', 'HC-04BLE'), {
    deviceId: 'dev-1',
    deviceName: 'HC-04BLE',
    clientId: '',
    clientKey: '',
    nickname: '',
    savePinEnabled: false,
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
      { clientId: 'PHONEA', clientKey: 'A1', nickname: 'Alice', enabled: true },
      { clientId: 'PHONEB', clientKey: 'B1', nickname: 'Bob', enabled: false },
    ],
    'PHONEB',
  )

  assert.deepEqual(result[1], {
    clientId: 'PHONEB',
    clientKey: 'B1',
    nickname: 'Bob',
    enabled: false,
    isCurrentPhone: true,
    statusText: '门锁端已停用',
  })
})
