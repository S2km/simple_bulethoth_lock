function clampAngle(value) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return 0
  }

  const rounded = Math.round(numeric)

  if (rounded < 0) {
    return 0
  }

  if (rounded > 180) {
    return 180
  }

  return rounded
}

const HC04_GENERAL_SERVICE_UUID = '0000FFE0-0000-1000-8000-00805F9B34FB'
const HC04_GENERAL_CHARACTERISTIC_UUID = '0000FFE1-0000-1000-8000-00805F9B34FB'
const HC04_HC02_SERVICE_UUID = '49535343-FE7D-4AE5-8FA9-9FAFD205E455'
const HC04_HC02_WRITE_UUID = '49535343-8841-43F4-A8D4-ECBE34729BB3'
const HC04_HC02_NOTIFY_UUID = '49535343-1E4D-4BD9-BA61-23C647249616'
const HC04_DEVICE_NAME = 'HC-04BLE'
const ALLOWED_RELOCK_SECONDS = [3, 5, 8, 10]

function normalizeTrimmedText(value) {
  return String(value || '').trim()
}

function normalizeUpperTrimmedText(value) {
  return normalizeTrimmedText(value).toUpperCase()
}

function normalizeOptionalCommandPart(value) {
  if (value === undefined || value === null) {
    return ''
  }

  return normalizeTrimmedText(value)
}

function normalizeFiniteInt(value, fallback = 0, min = 0) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.max(min, Math.floor(numeric))
}

function pickAllowedNumber(value, allowed, fallback) {
  const numeric = Number(value)
  return allowed.includes(numeric) ? numeric : fallback
}

function buildAngleCommand(angle) {
  return `A${clampAngle(angle)}\n`
}

function buildPinCommand(pin) {
  const normalizedPin = normalizeTrimmedText(pin)
  return `PIN ${normalizedPin}\n`
}

function buildLockCommand(action) {
  const normalizedAction = normalizeUpperTrimmedText(action)
  return `${normalizedAction}\n`
}

function normalizeClientId(value) {
  return normalizeUpperTrimmedText(value)
}

function normalizeNickname(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)

  return normalized || 'PHONE'
}

function buildTrustedPinCommand(clientId, pin) {
  return `TPIN ${normalizeClientId(clientId)} ${normalizeTrimmedText(pin)}\n`
}

function buildSessionProofCommand(commandName, payloadA, payloadB, mac) {
  const parts = [normalizeUpperTrimmedText(commandName)]
  const normalizedPayloadA = normalizeOptionalCommandPart(payloadA)
  const normalizedPayloadB = normalizeOptionalCommandPart(payloadB)

  if (normalizedPayloadA !== '') {
    parts.push(normalizedPayloadA)
  }

  if (normalizedPayloadB !== '') {
    parts.push(normalizedPayloadB)
  }

  parts.push(normalizeUpperTrimmedText(mac))
  return `${parts.join(' ')}\n`
}

function hashTextFNV1a(text) {
  const value = String(text || '')
  let hash = 2166136261 >>> 0

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index) & 0xff
    hash = Math.imul(hash, 16777619) >>> 0
  }

  return hash >>> 0
}

function hashWordFNV1a(hash, word) {
  let next = hash >>> 0
  let numeric = Number(word) >>> 0

  for (let index = 0; index < 4; index += 1) {
    next ^= numeric & 0xff
    next = Math.imul(next, 16777619) >>> 0
    numeric >>>= 8
  }

  return next >>> 0
}

function hashStringFNV1a(hash, text) {
  let next = hash >>> 0
  const value = String(text || '')

  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index) & 0xff
    next = Math.imul(next, 16777619) >>> 0
  }

  next ^= 0
  next = Math.imul(next, 16777619) >>> 0
  return next >>> 0
}

function computeSessionMac(secret, challenge, commandName, payloadA = '', payloadB = '', payloadC = '') {
  const normalizedChallenge = normalizeUpperTrimmedText(challenge)
  const challengeValue = /^[0-9A-F]{8}$/.test(normalizedChallenge)
    ? Number.parseInt(normalizedChallenge, 16) >>> 0
    : 0
  let hash = 2166136261 >>> 0

  hash = hashWordFNV1a(hash, hashTextFNV1a(secret))
  hash = hashWordFNV1a(hash, challengeValue)
  hash = hashStringFNV1a(hash, normalizeUpperTrimmedText(commandName))
  hash = hashStringFNV1a(hash, payloadA)
  hash = hashStringFNV1a(hash, payloadB)
  hash = hashStringFNV1a(hash, payloadC)

  return hash.toString(16).toUpperCase().padStart(8, '0')
}

function buildPinSetCommand(oldPin, newPin) {
  return `PINSET ${normalizeTrimmedText(oldPin)} ${normalizeTrimmedText(newPin)}\n`
}

function buildPinSetInitCommand(newPin) {
  return `PINSET INIT ${normalizeTrimmedText(newPin)}\n`
}

function buildBindCommand(clientId, nickname) {
  return `BIND ${normalizeClientId(clientId)} ${normalizeNickname(nickname)}\n`
}

function buildBindCommandWithKey(clientId, clientKey, nickname) {
  return `BIND ${normalizeClientId(clientId)} ${normalizeUpperTrimmedText(clientKey)} ${normalizeNickname(nickname)}\n`
}

function buildUnbindCommand(clientId) {
  return `UNBIND ${normalizeClientId(clientId)}\n`
}

function buildRelockCommand(seconds) {
  const selected = pickAllowedNumber(seconds, ALLOWED_RELOCK_SECONDS, 5)
  return `RELOCK ${selected}\n`
}

function createDefaultLockProfile(deviceId, deviceName) {
  return {
    deviceId: String(deviceId || ''),
    deviceName: String(deviceName || ''),
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
    statusText: item.enabled ? '门锁端已启用' : '门锁端已停用',
  }))
}

function stringToArrayBuffer(text) {
  const buffer = new ArrayBuffer(text.length)
  const view = new Uint8Array(buffer)

  for (let i = 0; i < text.length; i += 1) {
    view[i] = text.charCodeAt(i)
  }

  return buffer
}

function arrayBufferToAscii(buffer) {
  if (!buffer) {
    return ''
  }

  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let output = ''

  for (let i = 0; i < view.length; i += 1) {
    output += String.fromCharCode(view[i])
  }

  return output
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

function normalizeUuid(uuid) {
  return String(uuid || '').trim().toUpperCase()
}

function getPreferredProfile(serviceId) {
  const normalizedServiceId = normalizeUuid(serviceId)

  if (normalizedServiceId === HC04_GENERAL_SERVICE_UUID) {
    return {
      serviceId: HC04_GENERAL_SERVICE_UUID,
      writeCharacteristicId: HC04_GENERAL_CHARACTERISTIC_UUID,
      notifyCharacteristicId: HC04_GENERAL_CHARACTERISTIC_UUID,
    }
  }

  if (normalizedServiceId === HC04_HC02_SERVICE_UUID) {
    return {
      serviceId: HC04_HC02_SERVICE_UUID,
      writeCharacteristicId: HC04_HC02_WRITE_UUID,
      notifyCharacteristicId: HC04_HC02_NOTIFY_UUID,
    }
  }

  return null
}

function pickCharacteristicIds(characteristics, preferredProfile) {
  let writeCharacteristicId = ''
  let notifyCharacteristicId = ''
  let exactWriteCharacteristicId = ''
  let exactNotifyCharacteristicId = ''

  const normalizedPreferredWriteId = normalizeUuid(
    preferredProfile && preferredProfile.writeCharacteristicId,
  )
  const normalizedPreferredNotifyId = normalizeUuid(
    preferredProfile && preferredProfile.notifyCharacteristicId,
  )

  ;(characteristics || []).forEach((item) => {
    const properties = item.properties || {}
    const normalizedUuid = normalizeUuid(item.uuid)

    if (!exactWriteCharacteristicId && normalizedPreferredWriteId && normalizedUuid === normalizedPreferredWriteId) {
      exactWriteCharacteristicId = item.uuid
    }

    if (!exactNotifyCharacteristicId && normalizedPreferredNotifyId && normalizedUuid === normalizedPreferredNotifyId) {
      exactNotifyCharacteristicId = item.uuid
    }

    if (!writeCharacteristicId && (properties.write || properties.writeNoResponse)) {
      writeCharacteristicId = item.uuid
    }

    if (!notifyCharacteristicId && (properties.notify || properties.indicate)) {
      notifyCharacteristicId = item.uuid
    }
  })

  return {
    writeCharacteristicId: exactWriteCharacteristicId || writeCharacteristicId,
    notifyCharacteristicId: exactNotifyCharacteristicId || notifyCharacteristicId,
  }
}

function buildConnectionViewState(input) {
  const state = input || {}
  const adapterReady = !!state.adapterReady
  const isScanning = !!state.isScanning
  const isConnected = !!state.isConnected
  const reconnecting = !!state.reconnecting
  const deviceName = state.deviceName || '暂无设备'
  const canSend = !!(isConnected && state.serviceId && state.writeCharacteristicId)

  if (!adapterReady) {
    return {
      tone: 'danger',
      label: '蓝牙不可用',
      detail: '适配器不可用',
      canSend: false,
      compactConnectionPanel: false,
    }
  }

  if (canSend) {
    return {
      tone: 'ready',
      label: '可控制',
      detail: deviceName,
      canSend: true,
      compactConnectionPanel: true,
    }
  }

  if (reconnecting) {
    return {
      tone: 'pending',
      label: '重连中',
      detail: deviceName,
      canSend: false,
      compactConnectionPanel: false,
    }
  }

  if (isScanning) {
    return {
      tone: 'pending',
      label: '扫描中',
      detail: '正在搜索附近设备',
      canSend: false,
      compactConnectionPanel: false,
    }
  }

  return {
    tone: 'idle',
    label: isConnected ? '已连接' : '未连接',
    detail: deviceName,
    canSend: false,
    compactConnectionPanel: false,
  }
}

function parseLockResponse(text) {
  const normalized = String(text || '').trim()
  const authOkMatch = normalized.match(/^AUTH OK (\d+)(?:\s+CHAL=([0-9A-F]{8}))?$/)
  const authLockedMatch = normalized.match(/^AUTH LOCKED (\d+)$/)
  const authFailMatch = normalized.match(/^AUTH FAIL (\d+)$/)
  const configResultMatch = normalized.match(/^(PINSET|BIND|UNBIND|RELOCK) (OK|FAIL)(?:\s+CHAL=([0-9A-F]{8}))?$/)
  const actionOkMatch = normalized.match(/^ACTION OK (LOCK|UNLOCK|STATUS|ANGLE)(?:\s+CHAL=([0-9A-F]{8}))?$/)
  const statusMatch = normalized.match(/^STATUS\s+([A-Z]+)(?:\s+(.*))?$/)
  const trustedAuthOkMatch = normalized.match(/^TPIN OK (\d+)(?:\s+CHAL=([0-9A-F]{8}))?$/)
  const trustedAuthDenyMatch = normalized.match(/^TPIN DENY ([A-Z_]+)$/)
  const trustListMatch = normalized.match(/^TRUST LIST(?:\s+(.*))?$/)

  if (authOkMatch) {
    const remainingSeconds = Number(authOkMatch[1])
    return {
      kind: 'auth_ok',
      remainingSeconds,
      action: '',
      message: `认证已通过，剩余 ${remainingSeconds} 秒`,
      challenge: authOkMatch[2] || '',
    }
  }

  if (authLockedMatch) {
    const remainingSeconds = Number(authLockedMatch[1])
    return {
      kind: 'auth_locked',
      remainingSeconds,
      action: '',
      message: `失败次数过多，请在 ${remainingSeconds} 秒后重试`,
    }
  }

  if (authFailMatch) {
    const failures = Number(authFailMatch[1])
    return {
      kind: 'auth_fail',
      remainingSeconds: 0,
      failures,
      action: '',
      message: `PIN 错误（${failures}/5）`,
    }
  }

  if (normalized === 'AUTH UNPROVISIONED') {
    return {
      kind: 'auth_unprovisioned',
      remainingSeconds: 0,
      action: '',
      message: '门锁尚未初始化，请先设置首个 PIN',
    }
  }

  if (normalized === 'PINSET INIT REQUIRED') {
    return {
      kind: 'pinset_init_required',
      remainingSeconds: 0,
      action: 'PINSET',
      message: '请先完成初始 PIN 设置，再进行常规修改',
    }
  }

  if (configResultMatch) {
    const action = configResultMatch[1]
    const ok = configResultMatch[2] === 'OK'
    const resultMessages = {
      PINSET: ok ? 'PIN 更新成功' : 'PIN 更新失败',
      BIND: ok ? '可信手机绑定成功' : '可信手机绑定失败',
      UNBIND: ok ? '可信手机已移除' : '可信手机移除失败',
      RELOCK: ok ? '自动重锁设置已更新' : '自动重锁设置更新失败',
    }
    return {
      kind: 'config_result',
      remainingSeconds: 0,
      action,
      ok,
      message: resultMessages[action] || normalized,
      rawMessage: normalized,
      challenge: configResultMatch[3] || '',
    }
  }

  if (trustedAuthOkMatch) {
    const remainingSeconds = Number(trustedAuthOkMatch[1])
    return {
      kind: 'trusted_auth_ok',
      remainingSeconds,
      action: '',
      message: `可信手机认证成功，剩余 ${remainingSeconds} 秒`,
      challenge: trustedAuthOkMatch[2] || '',
    }
  }

  if (trustedAuthDenyMatch) {
    const reason = trustedAuthDenyMatch[1]
    return {
      kind: 'trusted_auth_deny',
      remainingSeconds: 0,
      action: '',
      reason,
      message:
        reason === 'UNKNOWN_CLIENT'
          ? '当前手机尚未绑定到此门锁'
          : '可信手机认证失败',
    }
  }

  if (trustListMatch) {
    const payload = String(trustListMatch[1] || '').trim()
    const phones = payload
      ? payload.split(';').filter(Boolean).reduce((result, row) => {
          const fields = row.split('|')

          if (fields.length !== 4) {
            return result
          }

          const [clientId, clientKey, nickname, enabled] = fields
          const normalizedClientId = normalizeClientId(clientId)

          if (!normalizedClientId || (enabled !== '0' && enabled !== '1')) {
            return result
          }

          result.push({
            clientId: normalizedClientId,
            clientKey: String(clientKey || '').toUpperCase(),
            nickname: String(nickname || ''),
            enabled: enabled === '1',
          })

          return result
        }, [])
      : []
    return {
      kind: 'trust_list',
      remainingSeconds: 0,
      action: '',
      message: '已收到可信手机列表',
      phones,
    }
  }

  if (actionOkMatch) {
    const action = actionOkMatch[1]
    const actionMessages = {
      LOCK: '上锁成功',
      UNLOCK: '开锁成功',
      STATUS: '状态已确认',
      ANGLE: '角度命令已确认',
    }
    return {
      kind: 'action_ok',
      remainingSeconds: 0,
      action,
      message: actionMessages[action] || 'Action succeeded',
      challenge: actionOkMatch[2] || '',
    }
  }

  if (statusMatch) {
    const lockState = statusMatch[1]
    const fields = {}
    const rest = String(statusMatch[2] || '').trim()

    if (rest) {
      rest.split(/\s+/).forEach((token) => {
        const parts = token.split('=')

        if (parts.length !== 2) {
          return
        }

        fields[String(parts[0] || '').toUpperCase()] = parts[1]
      })
    }

    const authRaw = fields.AUTH
    const authActive = authRaw === '1' ? true : authRaw === '0' ? false : undefined
    const lockoutNumeric = Number(fields.LOCKOUT)
    const windowNumeric = Number(fields.WINDOW)
    const angleNumeric = Number(fields.ANGLE)
    const relockNumeric = Number(fields.REL)
    const provisioned = fields.PROV === '1' ? true : fields.PROV === '0' ? false : undefined
    const challenge = normalizeUpperTrimmedText(fields.CHAL)

    const result = {
      kind: 'status',
      remainingSeconds: 0,
      action: lockState,
      message: `状态 ${lockState}`,
      lockState,
      authActive,
      lockoutSeconds: Number.isFinite(lockoutNumeric) ? Math.max(0, lockoutNumeric) : undefined,
      windowSeconds: Number.isFinite(windowNumeric) ? Math.max(0, windowNumeric) : undefined,
      angle: Number.isFinite(angleNumeric) ? clampAngle(angleNumeric) : undefined,
      relockSeconds: Number.isFinite(relockNumeric) ? Math.max(0, relockNumeric) : undefined,
    }

    if (typeof provisioned === 'boolean') {
      result.provisioned = provisioned
    }

    if (/^[0-9A-F]{8}$/.test(challenge)) {
      result.challenge = challenge
    }

    return result
  }

  if (normalized === 'DENY AUTH REQUIRED') {
    return {
      kind: 'deny_auth_required',
      remainingSeconds: 0,
      action: '',
      message: '请先认证再开锁',
    }
  }

  if (normalized === 'DENY AUTH EXPIRED') {
    return {
      kind: 'deny_auth_expired',
      remainingSeconds: 0,
      action: '',
      message: '认证已过期',
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
      authStateLabel: '未连接',
      authStateDetail: '请先连接 HC-04BLE',
      authActionEnabled: false,
      authTone: 'danger',
      canUnlock: false,
    }
  }

  if (state.requiresProvisioning) {
    return {
      authStateLabel: '未初始化',
      authStateDetail: '可直接输入 PIN 尝试认证；如需设置或修改 PIN，请前往设置页',
      authActionEnabled: true,
      authTone: 'idle',
      canUnlock: false,
    }
  }

  if (lockedSeconds > 0) {
    return {
      authStateLabel: '已锁定',
      authStateDetail: `${lockedSeconds} 秒后可重试`,
      authActionEnabled: false,
      authTone: 'danger',
      canUnlock: false,
    }
  }

  if (remainingSeconds > 0) {
    return {
      authStateLabel: '已认证',
      authStateDetail: `剩余 ${remainingSeconds} 秒`,
      authActionEnabled: true,
      authTone: 'ready',
      canUnlock: true,
    }
  }

  return {
    authStateLabel: '需要认证',
    authStateDetail: '请输入 PIN 后再操作门锁',
    authActionEnabled: true,
    authTone: 'idle',
    canUnlock: false,
  }
}

function buildServoControlAccessState(input) {
  const state = input || {}
  const lockMode = !!state.lockMode
  const canUnlock = !!state.canUnlock
  const connectionCanSend = !!state.connectionCanSend
  const showServoControls = !lockMode || canUnlock

  return {
    showServoControls,
    canSendServo: connectionCanSend && showServoControls,
  }
}

function pickSummaryLogs(logs, limit = 2) {
  // Expects logs in newest-first order; keeps only summary-relevant connection/send/error lines.
  const summaryLimit = normalizeFiniteInt(limit, 0, 0)
  return (Array.isArray(logs) ? logs : [])
    .filter((item) => /(connected:|已连接:|disconnected|已断开|send:|failed|失败|error|错误)/i.test(item && item.text))
    .slice(0, summaryLimit)
}

function stripLogTimestamp(text) {
  return String(text || '').replace(/^\[[^\]]+\]\s*/, '').trim()
}

function buildRecentActionSummary(logs) {
  // Expects newest-first logs and prefers the most recent send event over passive status logs.
  const summaryLogs = pickSummaryLogs(logs, Array.isArray(logs) ? logs.length : 0)
  const preferredLog =
    summaryLogs.find((item) => /send:\s*/i.test(item && item.text)) || summaryLogs[0]

  if (!preferredLog) {
    return '等待操作'
  }

  const plainText = stripLogTimestamp(preferredLog.text)

  if (/send:\s*/i.test(plainText)) {
    return plainText.replace(/^.*send:\s*/i, '最近发送 ').trim()
  }

  if (/connected:\s*/i.test(plainText)) {
    return plainText.replace(/^.*connected:\s*/i, '已连接 ').trim()
  }

  if (/已连接[:：]\s*/.test(plainText)) {
    return plainText.replace(/^.*已连接[:：]\s*/i, '已连接 ').trim()
  }

  return plainText
}

function isPreferredDeviceName(name) {
  return String(name || '').trim().toUpperCase() === HC04_DEVICE_NAME
}

function decorateDevice(device) {
  const normalizedDevice = device || {}
  const isPreferred = isPreferredDeviceName(normalizedDevice.name)

  return {
    ...normalizedDevice,
    isPreferred,
    preferredTagText: isPreferred ? '优先目标设备' : '',
  }
}

function sortDeviceList(devices) {
  return (Array.isArray(devices) ? devices.slice() : []).sort((left, right) => {
    const leftPreferred = isPreferredDeviceName(left && left.name) ? 1 : 0
    const rightPreferred = isPreferredDeviceName(right && right.name) ? 1 : 0

    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred
    }

    const leftRssi = Number(left && left.RSSI)
    const rightRssi = Number(right && right.RSSI)

    if (leftRssi !== rightRssi) {
      return rightRssi - leftRssi
    }

    return String(left && left.name || '').localeCompare(String(right && right.name || ''))
  })
}

function findPreferredDeviceName(devices) {
  const sortedDevices = sortDeviceList(devices)
  return sortedDevices.length ? sortedDevices[0].name : ''
}

function buildDeviceListView(devices, expanded, limit = 5) {
  const sortedDevices = sortDeviceList(devices)
  const visibleLimit = normalizeFiniteInt(limit, 0, 0)
  const showToggle = sortedDevices.length > visibleLimit
  const visibleDevices = (expanded ? sortedDevices : sortedDevices.slice(0, visibleLimit)).map(decorateDevice)

  return {
    visibleDevices,
    showToggle,
    toggleText: expanded ? '收起列表' : '展开更多',
    preferredDeviceName: findPreferredDeviceName(sortedDevices),
  }
}

module.exports = {
  arrayBufferToAscii,
  buildAuthViewState,
  buildBindCommand,
  buildBindCommandWithKey,
  computeSessionMac,
  buildSessionProofCommand,
  clampAngle,
  buildAngleCommand,
  buildTrustedPhoneListView,
  buildLockCommand,
  buildPinSetCommand,
  buildPinSetInitCommand,
  buildPinCommand,
  buildDeviceListView,
  buildConnectionViewState,
  buildRelockCommand,
  buildRecentActionSummary,
  buildServoControlAccessState,
  buildTrustedPinCommand,
  buildUnbindCommand,
  createDefaultLockProfile,
  findPreferredDeviceName,
  getPreferredProfile,
  mergeLockProfile,
  normalizeClientId,
  normalizeNickname,
  normalizeUuid,
  parseLockResponse,
  pickCharacteristicIds,
  pickSummaryLogs,
  sortDeviceList,
  stringToArrayBuffer,
  upsertDevice,
  makeLogEntry,
}
