const {
  arrayBufferToAscii,
  buildAuthViewState,
  buildAngleCommand,
  buildBindCommand,
  buildBindCommandWithKey,
  buildConnectionViewState,
  computeSessionMac,
  buildDeviceListView,
  buildLockCommand,
  buildPinCommand,
  buildPinSetCommand,
  buildPinSetInitCommand,
  buildRecentActionSummary,
  buildRelockCommand,
  buildSessionProofCommand,
  buildServoControlAccessState,
  buildTrustedPhoneListView,
  buildTrustedPinCommand,
  buildUnbindCommand,
  clampAngle,
  createDefaultLockProfile,
  findPreferredDeviceName,
  getPreferredProfile,
  makeLogEntry,
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
} = require('./servo_helpers')
const { createProximityState, reduceProximityState } = require('./proximity_helpers')
const { normalizeRssiThresholdValue } = require('./settings_helpers')

const LAST_DEVICE_KEY = 'ble-servo-last-device'
const LOCK_PROFILE_MAP_KEY = 'ble-lock-profile-map'
const APP_CLIENT_ID_KEY = 'ble-lock-app-client-id'
const APP_CLIENT_KEY_KEY = 'ble-lock-app-client-key'
const REALTIME_INTERVAL_MS = 120
const RSSI_POLL_INTERVAL_MS = 500
const RSSI_FAILURE_LOG_COOLDOWN_MS = 5000
const AUTO_UNLOCK_GUARD_MS = 4000
const AUTO_RELOCK_STATUS_GRACE_MS = 1200
const LOCK_PIN_PATTERN = /^\d{6,11}$/
const ALLOWED_RELOCK_SECONDS = [3, 5, 8, 10]
function createDefaultTimers() {
  return {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
}

function wxAsync(wxApi, methodName, options = {}) {
  return new Promise((resolve, reject) => {
    const method = wxApi && wxApi[methodName]
    if (typeof method !== 'function') {
      reject(new Error(`${methodName} unavailable`))
      return
    }

    method.call(wxApi, {
      ...options,
      success: resolve,
      fail: reject,
    })
  })
}

function normalizeDevice(device) {
  return {
    deviceId: device.deviceId,
    name: device.name || device.localName || '未知设备',
    localName: device.localName || '',
    RSSI: typeof device.RSSI === 'number' ? device.RSSI : 0,
  }
}

function isValidLockPin(value) {
  return LOCK_PIN_PATTERN.test(String(value || '').trim())
}

function normalizeRelockSeconds(value) {
  const numeric = Number(value)
  return ALLOWED_RELOCK_SECONDS.includes(numeric) ? numeric : 5
}

function createInitialState() {
  return {
    adapterReady: false,
    isScanning: false,
    isConnected: false,
    reconnecting: false,
    logsExpanded: false,
    devicesExpanded: false,
    autoReconnect: true,
    deviceList: [],
    visibleDeviceList: [],
    showDeviceToggle: false,
    deviceToggleText: '展开更多',
    deviceId: '',
    deviceName: '未连接设备',
    serviceId: '',
    writeCharacteristicId: '',
    notifyCharacteristicId: '',
    currentAngle: 90,
    realtimeMode: false,
    authPin: '',
    authPinDraft: '',
    lockProfile: null,
    trustedPhones: [],
    trustedPhoneView: [],
    currentClientId: '',
    sessionChallenge: '',
    sessionProofSource: '',
    bindNickname: '',
    newPin: '',
    newPinDraft: '',
    newPinConfirm: '',
    newPinConfirmDraft: '',
    selectedRelockSeconds: 5,
    currentRssi: null,
    automationStateLabel: '自动化待命',
    profileSettingsEnabled: false,
    canAdministerLock: false,
    canChangePin: false,
    authAuthorized: false,
    authRemainingSeconds: 0,
    authLockedSeconds: 0,
    authStatusLabel: '需要认证',
    authStatusDetail: '请输入 PIN 后再操作门锁',
    authTone: 'idle',
    lastLockAction: '',
    lockMode: true,
    canAuthenticate: false,
    canUnlock: false,
    showServoControls: false,
    logs: [],
    connectionTone: 'danger',
    connectionLabel: 'Bluetooth Off',
    connectionDetail: 'Adapter unavailable',
    canSend: false,
    compactConnectionPanel: false,
    summaryLogs: [],
    recentActionText: '等待操作',
    sliderHintText: '松开滑块后发送',
    logsToggleText: '展开日志',
    connectionPanelClass: '',
    connectionPillClass: 'status-off',
    requiresProvisioning: false,
  }
}

function createLockRuntime(options = {}) {
  const wxApi = options.wx || wx
  const timers = options.timers || createDefaultTimers()
  const subscribers = new Set()

  const runtime = {
    wx: wxApi,
    timers,
    subscribers,
    state: createInitialState(),
    initialized: false,
    realtimeTimer: null,
    realtimePendingAngle: null,
    realtimeLastSentAt: 0,
    authCountdownTimer: null,
    lockoutCountdownTimer: null,
    proximityState: createProximityState(),
    rssiPollTimer: null,
    rssiPollRunId: 0,
    lastRssiReadFailureLoggedAt: 0,
    autoUnlockInFlight: false,
    autoUnlockRequestedAt: 0,
    autoUnlockGuardTimer: null,
    autoRelockStatusTimer: null,
    pendingBindRequest: null,
    pendingUnbindClientId: '',
    pendingRelockSeconds: null,
    pendingPinChange: null,
    pendingAuthRetryPin: '',
    authRetryInFlight: false,
    deviceFoundHandler: null,
    connectionStateHandler: null,
    valueChangeHandler: null,
    actions: null,
  }

  runtime.emit = () => {
    runtime.updateDerivedView()
    const snapshot = runtime.getSnapshot()
    runtime.subscribers.forEach((listener) => {
      listener(snapshot)
    })
  }

  runtime.getSnapshot = () => JSON.parse(JSON.stringify(runtime.state))

  runtime.setState = (patch) => {
    runtime.state = {
      ...runtime.state,
      ...(patch || {}),
    }
    runtime.emit()
    return runtime.state
  }

  runtime.loadLockProfile = (deviceId, deviceName) => {
    const map = runtime.wx.getStorageSync(LOCK_PROFILE_MAP_KEY) || {}
    const merged = mergeLockProfile(createDefaultLockProfile(deviceId, deviceName), map[deviceId] || {})

    if (!merged.savePinEnabled && merged.savedPin) {
      merged.savedPin = ''
      map[deviceId] = {
        ...merged,
        savedPin: '',
      }
      runtime.wx.setStorageSync(LOCK_PROFILE_MAP_KEY, map)
    }

    return merged
  }

  runtime.saveLockProfile = (patch) => {
    const current =
      runtime.state.lockProfile || createDefaultLockProfile(runtime.state.deviceId, runtime.state.deviceName)
    const next = mergeLockProfile(current, patch)
    if (!next.savePinEnabled) {
      next.savedPin = ''
    }
    if (!next.deviceId) {
      runtime.setState({ lockProfile: next })
      return next
    }
    const map = runtime.wx.getStorageSync(LOCK_PROFILE_MAP_KEY) || {}
    map[next.deviceId] = next
    runtime.wx.setStorageSync(LOCK_PROFILE_MAP_KEY, map)
    runtime.setState({ lockProfile: next })
    return next
  }

  runtime.clearPendingDeviceMutations = () => {
    runtime.pendingBindRequest = null
    runtime.pendingUnbindClientId = ''
    runtime.pendingRelockSeconds = null
    runtime.pendingPinChange = null
    runtime.pendingAuthRetryPin = ''
    runtime.authRetryInFlight = false
  }

  runtime.clearRealtimeTimer = () => {
    if (runtime.realtimeTimer) {
      runtime.timers.clearTimeout(runtime.realtimeTimer)
      runtime.realtimeTimer = null
    }
  }

  runtime.clearStatusSyncTimer = () => {
    if (runtime.autoRelockStatusTimer) {
      runtime.timers.clearTimeout(runtime.autoRelockStatusTimer)
      runtime.autoRelockStatusTimer = null
    }
  }

  runtime.scheduleStatusSync = (delayMs = 0) => {
    runtime.clearStatusSyncTimer()

    const nextDelay = Math.max(0, Number(delayMs) || 0)
    runtime.autoRelockStatusTimer = runtime.timers.setTimeout(async () => {
      runtime.autoRelockStatusTimer = null
      if (!runtime.state.isConnected) {
        return
      }

      try {
        await runtime.writeCommand('STATUS\n')
      } catch (error) {
        runtime.appendLog(`status sync failed: ${runtime.getErrorText(error)}`)
      }
    }, nextDelay)
  }

  runtime.getEffectiveRelockSeconds = () =>
    normalizeRelockSeconds(
      runtime.state.selectedRelockSeconds ||
        (runtime.state.lockProfile && runtime.state.lockProfile.relockSeconds),
    )

  runtime.getSessionPinCredential = () => {
    const currentPin = String(runtime.state.authPinDraft || runtime.state.authPin || '').trim()
    return isValidLockPin(currentPin) ? currentPin : ''
  }

  runtime.persistSavedPinIfNeeded = (pin) => {
    const profile = runtime.state.lockProfile
    if (!profile || !profile.deviceId) {
      return
    }

    const normalizedPin = String(pin || '').trim()
    if (profile.savePinEnabled && isValidLockPin(normalizedPin)) {
      runtime.saveLockProfile({ savedPin: normalizedPin })
      return
    }

    if (!profile.savePinEnabled && profile.savedPin) {
      runtime.saveLockProfile({ savedPin: '' })
    }
  }

  runtime.hasSessionPinCredential = () => !!runtime.getSessionPinCredential()

  runtime.getSessionChallenge = () => {
    const challenge = String(runtime.state.sessionChallenge || '').trim().toUpperCase()
    return /^[0-9A-F]{8}$/.test(challenge) ? challenge : ''
  }

  runtime.buildProofMac = (secret, commandName, payloadA = '', payloadB = '', payloadC = '') => {
    const challenge = runtime.getSessionChallenge()
    if (!challenge) {
      return ''
    }
    return computeSessionMac(secret, challenge, commandName, payloadA, payloadB, payloadC)
  }

  runtime.ensureSessionChallenge = async () => {
    if (runtime.getSessionChallenge()) {
      return true
    }

    if (!runtime.state.isConnected) {
      return false
    }

    try {
      const sent = await runtime.writeCommand('STATUS\n')
      if (!sent) {
        return false
      }
      if (runtime.getSessionChallenge()) {
        return true
      }

      await new Promise((resolve) => {
        runtime.timers.setTimeout(resolve, 80)
      })
      return !!runtime.getSessionChallenge()
    } catch (error) {
      runtime.appendLog(`会话挑战刷新失败: ${runtime.getErrorText(error)}`)
      return false
    }
  }

  runtime.getSessionProofSecret = () => {
    const profile = runtime.getCurrentLockProfile()
    const clientKey = String(profile.clientKey || '').trim().toUpperCase()
    if (runtime.state.sessionProofSource === 'clientKey') {
      return clientKey
    }
    return runtime.getSessionPinCredential()
  }

  runtime.buildAutomationIdleLabel = () =>
    runtime.hasSessionPinCredential() ? '自动化待命' : '自动化待命，需先输入 PIN'

  runtime.sendAuthenticateWithCurrentPin = async () => {
    const pin = runtime.getSessionPinCredential()
    if (!pin) {
      runtime.appendLog('认证已跳过: PIN 格式无效')
      return false
    }

    const hasChallenge = await runtime.ensureSessionChallenge()
    if (!hasChallenge) {
      runtime.appendLog('认证已跳过: 会话挑战尚未就绪')
      return false
    }

    const mac = runtime.buildProofMac(pin, 'PIN', pin)
    if (!mac) {
      runtime.appendLog('认证已跳过: 会话挑战计算失败')
      return false
    }

    runtime.pendingAuthRetryPin = pin
    runtime.authRetryInFlight = false
    return runtime.writeCommand(buildSessionProofCommand('PIN', pin, '', mac))
  }

  runtime.getOrCreateClientId = () => {
    const stored = normalizeClientId(runtime.wx.getStorageSync(APP_CLIENT_ID_KEY))
    if (stored) {
      return stored
    }

    const randomBlock = Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, '0')
    const timestampBlock = Date.now().toString(16).toUpperCase()
    const nextId = normalizeClientId(`PHONE-${timestampBlock}-${randomBlock}`)
    runtime.wx.setStorageSync(APP_CLIENT_ID_KEY, nextId)
    return nextId
  }

  runtime.getOrCreateClientKey = () => {
    const stored = String(runtime.wx.getStorageSync(APP_CLIENT_KEY_KEY) || '').trim().toUpperCase()
    if (/^[0-9A-F]{16,32}$/.test(stored)) {
      return stored
    }

    const key = `${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`
      .toUpperCase()
      .slice(0, 16)
      .padEnd(16, '0')
    runtime.wx.setStorageSync(APP_CLIENT_KEY_KEY, key)
    return key
  }

  runtime.scheduleStatusSyncFromStatus = (statusResponse) => {
    const lockState = String(statusResponse && statusResponse.lockState || '').toUpperCase()
    const relockSeconds = Number(statusResponse && statusResponse.relockSeconds)

    if (lockState !== 'UNLOCK' || !ALLOWED_RELOCK_SECONDS.includes(relockSeconds)) {
      return
    }

    runtime.scheduleStatusSync((relockSeconds * 1000) + AUTO_RELOCK_STATUS_GRACE_MS)
  }

  runtime.updateDerivedView = () => {
    const connectionView = buildConnectionViewState(runtime.state)
    const authView = buildAuthViewState({
      isConnected: runtime.state.isConnected,
      authAuthorized: runtime.state.authAuthorized,
      authRemainingSeconds: runtime.state.authRemainingSeconds,
      authLockedSeconds: runtime.state.authLockedSeconds,
      requiresProvisioning: runtime.state.requiresProvisioning,
    })
    const servoControlView = buildServoControlAccessState({
      lockMode: runtime.state.lockMode,
      canUnlock: authView.canUnlock,
      connectionCanSend: connectionView.canSend,
    })
    const deviceListView = buildDeviceListView(runtime.state.deviceList, runtime.state.devicesExpanded, 5)
    const summaryLimit = runtime.state.logsExpanded ? 8 : 2
    const sliderHintText = runtime.state.realtimeMode
      ? '拖动时会节流发送'
      : '松开滑块后发送'
    const authPinValue = String(runtime.state.authPinDraft || runtime.state.authPin || '').trim()
    const newPinValue = String(runtime.state.newPinDraft || runtime.state.newPin || '').trim()
    const newPinConfirmValue = String(runtime.state.newPinConfirmDraft || runtime.state.newPinConfirm || '').trim()
    const hasValidPin = isValidLockPin(authPinValue)
    const hasValidNewPin = isValidLockPin(newPinValue)
    const hasMatchingNewPin = hasValidNewPin && newPinValue === newPinConfirmValue
    const profileSettingsEnabled = !!(
      runtime.state.isConnected &&
      runtime.state.lockProfile &&
      runtime.state.lockProfile.deviceId &&
      runtime.state.lockProfile.deviceId === runtime.state.deviceId
    )
    const canAdministerLock = profileSettingsEnabled && !!runtime.state.authAuthorized
    const canAuthenticate = runtime.state.isConnected &&
      hasValidPin &&
      Number(runtime.state.authLockedSeconds || 0) <= 0
    const canChangePin =
      canAdministerLock &&
      hasValidNewPin &&
      Number(runtime.state.authLockedSeconds || 0) <= 0 &&
      (
        runtime.state.requiresProvisioning
          ? newPinValue === newPinConfirmValue
          : hasValidPin && hasMatchingNewPin
      )
    const preferredDeviceName = findPreferredDeviceName(runtime.state.deviceList)
    const connectionDetail =
      !connectionView.canSend && preferredDeviceName && runtime.state.adapterReady
        ? preferredDeviceName
        : connectionView.detail

    runtime.state = {
      ...runtime.state,
      connectionTone: connectionView.tone,
      connectionLabel: connectionView.label,
      connectionDetail,
      canSend: servoControlView.canSendServo,
      compactConnectionPanel: connectionView.compactConnectionPanel,
      authStatusLabel: authView.authStateLabel,
      authStatusDetail: authView.authStateDetail,
      authTone: authView.authTone,
      canAuthenticate,
      canUnlock: authView.canUnlock,
      showServoControls: servoControlView.showServoControls,
      visibleDeviceList: deviceListView.visibleDevices,
      showDeviceToggle: deviceListView.showToggle,
      deviceToggleText: deviceListView.toggleText,
      summaryLogs: pickSummaryLogs(runtime.state.logs, summaryLimit),
      recentActionText: buildRecentActionSummary(runtime.state.logs),
      sliderHintText,
      logsToggleText: runtime.state.logsExpanded ? '收起日志' : '展开日志',
      connectionPanelClass: connectionView.compactConnectionPanel ? 'connection-panel-compact' : '',
      connectionPillClass: connectionView.canSend ? 'status-on' : 'status-off',
      profileSettingsEnabled,
      canAdministerLock,
      canChangePin,
    }
  }

  runtime.appendLog = (text) => {
    runtime.state.logs = [makeLogEntry(text), ...runtime.state.logs].slice(0, 40)
    runtime.emit()
  }

  runtime.applyAuthState = (nextState) => {
    if (!nextState || typeof nextState !== 'object') {
      return
    }

    const patch = {}

    if (Object.prototype.hasOwnProperty.call(nextState, 'authAuthorized')) {
      patch.authAuthorized = !!nextState.authAuthorized
    }

    if (Object.prototype.hasOwnProperty.call(nextState, 'authRemainingSeconds')) {
      const remainingSeconds = Number(nextState.authRemainingSeconds)
      patch.authRemainingSeconds = Number.isFinite(remainingSeconds) ? Math.max(0, remainingSeconds) : 0
    }

    if (Object.prototype.hasOwnProperty.call(nextState, 'authLockedSeconds')) {
      const lockedSeconds = Number(nextState.authLockedSeconds)
      patch.authLockedSeconds = Number.isFinite(lockedSeconds) ? Math.max(0, lockedSeconds) : 0
    }

    if (Object.prototype.hasOwnProperty.call(nextState, 'lastLockAction')) {
      patch.lastLockAction = String(nextState.lastLockAction || '')
    }

    if (!Object.keys(patch).length) {
      return
    }

    runtime.state = {
      ...runtime.state,
      ...patch,
    }
    runtime.emit()
  }

  runtime.stopAuthCountdown = () => {
    if (runtime.authCountdownTimer) {
      runtime.timers.clearInterval(runtime.authCountdownTimer)
      runtime.authCountdownTimer = null
    }
  }

  runtime.stopLockoutCountdown = () => {
    if (runtime.lockoutCountdownTimer) {
      runtime.timers.clearInterval(runtime.lockoutCountdownTimer)
      runtime.lockoutCountdownTimer = null
    }
  }

  runtime.startAuthCountdown = (seconds) => {
    runtime.stopAuthCountdown()
    runtime.stopLockoutCountdown()

    const numericSeconds = Number(seconds)
    const nextSeconds = Number.isFinite(numericSeconds) ? Math.max(0, Math.floor(numericSeconds)) : 0
    runtime.applyAuthState({
      authAuthorized: nextSeconds > 0,
      authRemainingSeconds: nextSeconds,
      authLockedSeconds: 0,
    })

    if (nextSeconds <= 0) {
      return
    }

    runtime.authCountdownTimer = runtime.timers.setInterval(() => {
      const remainingSeconds = Math.max(Number(runtime.state.authRemainingSeconds || 0) - 1, 0)

      if (remainingSeconds <= 0) {
        runtime.stopAuthCountdown()
        runtime.applyAuthState({
          authAuthorized: false,
          authRemainingSeconds: 0,
        })
        return
      }

      runtime.applyAuthState({
        authAuthorized: true,
        authRemainingSeconds: remainingSeconds,
      })
    }, 1000)
  }

  runtime.startLockoutCountdown = (seconds) => {
    runtime.stopLockoutCountdown()
    runtime.stopAuthCountdown()

    const numericSeconds = Number(seconds)
    const nextSeconds = Number.isFinite(numericSeconds) ? Math.max(0, Math.floor(numericSeconds)) : 0
    runtime.applyAuthState({
      authAuthorized: false,
      authRemainingSeconds: 0,
      authLockedSeconds: nextSeconds,
    })

    if (nextSeconds <= 0) {
      return
    }

    runtime.lockoutCountdownTimer = runtime.timers.setInterval(() => {
      const remainingSeconds = Math.max(Number(runtime.state.authLockedSeconds || 0) - 1, 0)

      if (remainingSeconds <= 0) {
        runtime.stopLockoutCountdown()
        runtime.applyAuthState({ authLockedSeconds: 0 })
        return
      }

      runtime.applyAuthState({ authLockedSeconds: remainingSeconds })
    }, 1000)
  }

  runtime.getCurrentLockProfile = () =>
    runtime.state.lockProfile || createDefaultLockProfile(runtime.state.deviceId, runtime.state.deviceName)

  runtime.buildProximityReducerInput = (profile, overrides = {}) => ({
    nowMs: Date.now(),
    isConnected: runtime.state.isConnected,
    isTrusted: !!profile.clientId,
    autoAuthEnabled: !!profile.autoAuth,
    proximityUnlockEnabled: !!profile.proximityUnlock,
    hasPinCredential: !!String(profile.clientKey || '').trim(),
    lockState: runtime.state.lastLockAction || 'LOCK',
    rssi: Number(runtime.state.currentRssi),
    threshold: Number(profile.rssiThreshold),
    authSucceeded: false,
    authFailed: false,
    disconnected: false,
    ...overrides,
  })

  runtime.logRssiReadFailure = (error) => {
    const nowMs = Date.now()
    if ((nowMs - runtime.lastRssiReadFailureLoggedAt) < RSSI_FAILURE_LOG_COOLDOWN_MS) {
      return
    }

    runtime.lastRssiReadFailureLoggedAt = nowMs
    runtime.appendLog(`rssi read failed: ${runtime.getErrorText(error)}`)
  }

  runtime.beginAutoUnlockGuard = () => {
    const nowMs = Date.now()
    if (runtime.autoUnlockInFlight && (nowMs - runtime.autoUnlockRequestedAt) < AUTO_UNLOCK_GUARD_MS) {
      return false
    }

    runtime.clearAutoUnlockGuard()
    runtime.autoUnlockInFlight = true
    runtime.autoUnlockRequestedAt = nowMs
    runtime.autoUnlockGuardTimer = runtime.timers.setTimeout(() => {
      runtime.clearAutoUnlockGuard()
    }, AUTO_UNLOCK_GUARD_MS)
    return true
  }

  runtime.clearAutoUnlockGuard = () => {
    runtime.autoUnlockInFlight = false
    runtime.autoUnlockRequestedAt = 0
    if (runtime.autoUnlockGuardTimer) {
      runtime.timers.clearTimeout(runtime.autoUnlockGuardTimer)
      runtime.autoUnlockGuardTimer = null
    }
  }

  runtime.handleActionOkResponse = (response) => {
    runtime.clearAutoUnlockGuard()

    if (response.action === 'LOCK' || response.action === 'UNLOCK') {
      runtime.applyAuthState({ lastLockAction: response.action })
    }

    if (response.action === 'ANGLE') {
      const nextAction = runtime.state.currentAngle === 180 ? 'UNLOCK' : 'LOCK'
      runtime.applyAuthState({ lastLockAction: nextAction })
    }

    if (response.action === 'LOCK') {
      runtime.clearStatusSyncTimer()
      return
    }

    if (response.action === 'UNLOCK') {
      runtime.scheduleStatusSync(
        (runtime.getEffectiveRelockSeconds() * 1000) + AUTO_RELOCK_STATUS_GRACE_MS,
      )
      return
    }

    if (response.action === 'ANGLE') {
      runtime.scheduleStatusSync(250)
    }
  }

  runtime.handleConfigResult = async (response) => {
    if (!response || response.kind !== 'config_result') {
      return
    }

    if (response.action === 'PINSET') {
      const pendingPinChange = runtime.pendingPinChange
      runtime.pendingPinChange = null
      if (!response.ok || !pendingPinChange) {
        return
      }

      if (pendingPinChange.persistLocalPin) {
        runtime.saveLockProfile({ savedPin: pendingPinChange.newPin })
      }
      runtime.setState({
        authPin: pendingPinChange.newPin,
        authPinDraft: pendingPinChange.newPin,
        newPin: '',
        newPinDraft: '',
        newPinConfirm: '',
        newPinConfirmDraft: '',
        requiresProvisioning: false,
      })
      return
    }

    if (response.action === 'BIND') {
      const pendingBindRequest = runtime.pendingBindRequest
      runtime.pendingBindRequest = null
      if (response.ok && pendingBindRequest) {
        const next = runtime.saveLockProfile({
          clientId: pendingBindRequest.clientId,
          clientKey: pendingBindRequest.clientKey,
          nickname: pendingBindRequest.nickname,
        })
        runtime.setState({
          currentClientId: next.clientId,
          bindNickname: next.nickname,
        })
      }

      if (response.ok) {
        try {
          await runtime.writeCommand('TRUST LIST\n')
        } catch (error) {
          runtime.appendLog(`trusted list refresh failed after bind: ${runtime.getErrorText(error)}`)
        }
      }
      return
    }

    if (response.action === 'UNBIND') {
      const pendingUnbindClientId = runtime.pendingUnbindClientId
      runtime.pendingUnbindClientId = ''
      if (response.ok) {
        const currentClientId = normalizeClientId(runtime.state.lockProfile && runtime.state.lockProfile.clientId)
        if (pendingUnbindClientId && pendingUnbindClientId === currentClientId) {
          runtime.saveLockProfile({
            clientId: '',
            clientKey: '',
            autoAuth: false,
            proximityUnlock: false,
          })
          runtime.proximityState = createProximityState()
          runtime.setState({
            currentClientId: '',
            automationStateLabel: runtime.buildAutomationIdleLabel(),
          })
        }

        try {
          await runtime.writeCommand('TRUST LIST\n')
        } catch (error) {
          runtime.appendLog(`trusted list refresh failed after unbind: ${runtime.getErrorText(error)}`)
        }
      }
      return
    }

    if (response.action === 'RELOCK') {
      const pendingRelockSeconds = runtime.pendingRelockSeconds
      runtime.pendingRelockSeconds = null

      if (response.ok && ALLOWED_RELOCK_SECONDS.includes(Number(pendingRelockSeconds))) {
        const relockSeconds = Number(pendingRelockSeconds)
        runtime.setState({ selectedRelockSeconds: relockSeconds })
        if (
          runtime.state.lockProfile &&
          Number(runtime.state.lockProfile.relockSeconds) !== relockSeconds
        ) {
          runtime.saveLockProfile({ relockSeconds })
        }
      }

      if (response.ok) {
        runtime.scheduleStatusSync(150)
      }
    }
  }

  runtime.applyStatusResponse = (statusResponse) => {
    if (!statusResponse || statusResponse.kind !== 'status') {
      return
    }

    const patch = {}
    if (Object.prototype.hasOwnProperty.call(statusResponse, 'angle')) {
      const angle = Number(statusResponse.angle)
      if (Number.isFinite(angle)) {
        patch.currentAngle = clampAngle(angle)
      }
    }

    if (Object.prototype.hasOwnProperty.call(statusResponse, 'provisioned')) {
      patch.requiresProvisioning = statusResponse.provisioned === false
    }

    if (Object.keys(patch).length) {
      runtime.setState(patch)
    }

    if (statusResponse.lockState) {
      runtime.applyAuthState({ lastLockAction: statusResponse.lockState })
      if (statusResponse.lockState === 'LOCK') {
        runtime.clearStatusSyncTimer()
      }
    }

    const relockSeconds = Number(statusResponse.relockSeconds)
    if (ALLOWED_RELOCK_SECONDS.includes(relockSeconds)) {
      if (Number(runtime.state.selectedRelockSeconds) !== relockSeconds) {
        runtime.setState({ selectedRelockSeconds: relockSeconds })
      }
      if (
        runtime.state.lockProfile &&
        Number(runtime.state.lockProfile.relockSeconds) !== relockSeconds
      ) {
        runtime.saveLockProfile({ relockSeconds })
      }
    }

    runtime.scheduleStatusSyncFromStatus(statusResponse)

    const lockoutSeconds = Number(statusResponse.lockoutSeconds)
    const hasLockoutSeconds = Number.isFinite(lockoutSeconds)
    const windowSeconds = Number(statusResponse.windowSeconds)
    const hasWindowSeconds = Number.isFinite(windowSeconds)

    if (hasLockoutSeconds && lockoutSeconds > 0) {
      runtime.startLockoutCountdown(lockoutSeconds)
      return
    }

    if (hasLockoutSeconds) {
      runtime.stopLockoutCountdown()
      runtime.applyAuthState({ authLockedSeconds: 0 })
    }

    if (hasWindowSeconds) {
      if (windowSeconds > 0) {
        runtime.startAuthCountdown(windowSeconds)
      } else {
        runtime.stopAuthCountdown()
        runtime.applyAuthState({
          authAuthorized: false,
          authRemainingSeconds: 0,
        })
      }
      return
    }

    if (statusResponse.authActive === false) {
      runtime.stopAuthCountdown()
      runtime.applyAuthState({
        authAuthorized: false,
        authRemainingSeconds: 0,
      })
    }
  }

  runtime.handleBleValueChange = async (result) => {
    const text = arrayBufferToAscii(result.value).trim()

    if (!text) {
      return
    }

    runtime.appendLog(`recv: ${text}`)
    const response = parseLockResponse(text)

    switch (response.kind) {
      case 'auth_ok':
        runtime.pendingAuthRetryPin = ''
        runtime.authRetryInFlight = false
        runtime.startAuthCountdown(response.remainingSeconds)
        runtime.setState({
          requiresProvisioning: false,
          sessionChallenge: response.challenge || runtime.state.sessionChallenge,
          sessionProofSource: 'pin',
        })
        break
      case 'auth_unprovisioned':
        runtime.stopAuthCountdown()
        runtime.stopLockoutCountdown()
        runtime.clearAutoUnlockGuard()
        runtime.setState({ requiresProvisioning: true, sessionProofSource: '' })
        runtime.applyAuthState({
          authAuthorized: false,
          authRemainingSeconds: 0,
          authLockedSeconds: 0,
        })
        break
      case 'pinset_init_required':
        runtime.setState({ requiresProvisioning: true, sessionProofSource: '' })
        break
      case 'trusted_auth_ok':
        runtime.startAuthCountdown(response.remainingSeconds)
      runtime.setState({
        automationStateLabel: '可信手机认证成功',
        sessionChallenge: response.challenge || runtime.state.sessionChallenge,
        sessionProofSource: 'clientKey',
      })
        {
          const profile = runtime.getCurrentLockProfile()
          const reduced = reduceProximityState(runtime.proximityState, {
            ...runtime.buildProximityReducerInput(profile),
            authSucceeded: true,
            authFailed: false,
          })
          runtime.proximityState = reduced.state
          if (reduced.action === 'request_unlock') {
            await runtime.requestAutomatedUnlock()
          }
        }
        break
      case 'trusted_auth_deny':
        runtime.setState({ automationStateLabel: response.message })
        runtime.clearAutoUnlockGuard()
        runtime.proximityState = reduceProximityState(runtime.proximityState, {
          ...runtime.buildProximityReducerInput(runtime.getCurrentLockProfile()),
          authSucceeded: false,
          authFailed: true,
        }).state
        break
      case 'trust_list':
        {
        const localClientId = normalizeClientId(runtime.state.lockProfile && runtime.state.lockProfile.clientId)
        const localClientKey = String(runtime.state.lockProfile && runtime.state.lockProfile.clientKey || '').trim().toUpperCase()
        const localRecord = response.phones.find((item) => item.clientId === localClientId)

        if (localClientId && (!localRecord || localRecord.clientKey !== localClientKey)) {
            runtime.saveLockProfile({
              clientId: '',
              clientKey: '',
              autoAuth: false,
              proximityUnlock: false,
            })
            runtime.proximityState = createProximityState()
            runtime.setState({
              currentClientId: '',
              automationStateLabel: '可信手机已失效，请重新绑定',
              sessionProofSource: '',
            })
          }

        runtime.setState({
          trustedPhones: response.phones,
          trustedPhoneView: buildTrustedPhoneListView(
            response.phones,
            runtime.state.lockProfile && runtime.state.lockProfile.clientId,
          ),
        })
        }
        break
      case 'auth_fail':
        runtime.stopAuthCountdown()
        runtime.stopLockoutCountdown()
        runtime.clearAutoUnlockGuard()
        runtime.applyAuthState({
          authAuthorized: false,
          authRemainingSeconds: 0,
          authLockedSeconds: 0,
        })
        if ((response.failures === 0) && runtime.pendingAuthRetryPin && !runtime.authRetryInFlight) {
          runtime.authRetryInFlight = true
          runtime.setState({ sessionChallenge: '' })
          runtime.appendLog('认证挑战已更新，正在自动重试')
          try {
            const refreshed = await runtime.ensureSessionChallenge()
            if (!refreshed) {
              runtime.appendLog('认证自动重试失败: 无法刷新会话挑战')
              runtime.authRetryInFlight = false
              runtime.pendingAuthRetryPin = ''
              break
            }
            runtime.setState({ authPin: runtime.pendingAuthRetryPin, authPinDraft: runtime.pendingAuthRetryPin })
            await runtime.sendAuthenticateWithCurrentPin()
            runtime.authRetryInFlight = false
            break
          } catch (error) {
            runtime.appendLog(`认证自动重试失败: ${runtime.getErrorText(error)}`)
            runtime.authRetryInFlight = false
            runtime.pendingAuthRetryPin = ''
            break
          }
        }
        runtime.pendingAuthRetryPin = ''
        runtime.authRetryInFlight = false
        runtime.appendLog(response.message)
        break
      case 'auth_locked':
        runtime.pendingAuthRetryPin = ''
        runtime.authRetryInFlight = false
        runtime.setState({ sessionProofSource: '' })
        runtime.clearAutoUnlockGuard()
        runtime.startLockoutCountdown(response.remainingSeconds)
        break
      case 'deny_auth_required':
      case 'deny_auth_expired':
        runtime.stopAuthCountdown()
        runtime.stopLockoutCountdown()
        runtime.clearAutoUnlockGuard()
        runtime.setState({ sessionProofSource: '' })
        runtime.applyAuthState({
          authAuthorized: false,
          authRemainingSeconds: 0,
          authLockedSeconds: 0,
        })
        break
      case 'action_ok':
        if (response.challenge) {
          runtime.setState({ sessionChallenge: response.challenge })
        }
        runtime.handleActionOkResponse(response)
        break
      case 'config_result':
        if (response.challenge) {
          runtime.setState({ sessionChallenge: response.challenge })
        }
        await runtime.handleConfigResult(response)
        break
      case 'status':
        runtime.applyStatusResponse(response)
        if (response.challenge) {
          runtime.setState({ sessionChallenge: response.challenge })
        }
        break
      default:
        break
    }
  }

  runtime.getErrorText = (error) => (error && (error.errMsg || error.message)) || 'unknown error'

  runtime.unregisterBluetoothListeners = () => {
    if (runtime.wx.offBluetoothDeviceFound && runtime.deviceFoundHandler) {
      runtime.wx.offBluetoothDeviceFound(runtime.deviceFoundHandler)
    }
    if (runtime.wx.offBLEConnectionStateChange && runtime.connectionStateHandler) {
      runtime.wx.offBLEConnectionStateChange(runtime.connectionStateHandler)
    }
    if (runtime.wx.offBLECharacteristicValueChange && runtime.valueChangeHandler) {
      runtime.wx.offBLECharacteristicValueChange(runtime.valueChangeHandler)
    }

    runtime.deviceFoundHandler = null
    runtime.connectionStateHandler = null
    runtime.valueChangeHandler = null
  }

  runtime.registerBluetoothListeners = () => {
    runtime.unregisterBluetoothListeners()

    runtime.deviceFoundHandler = (result) => {
      const devices = result.devices || (result.device ? [result.device] : [])
      devices.forEach((item) => runtime.handleDeviceFound(item))
    }

    runtime.connectionStateHandler = (result) => {
      if (result.connected) {
        return
      }

      if (result.deviceId === runtime.state.deviceId) {
        runtime.appendLog('设备已断开')
        runtime.resetConnectionState()
      }
    }

    runtime.valueChangeHandler = (result) => {
      runtime.handleBleValueChange(result).catch((error) => {
        runtime.appendLog(`recv handler failed: ${runtime.getErrorText(error)}`)
      })
    }

    runtime.wx.onBluetoothDeviceFound(runtime.deviceFoundHandler)
    runtime.wx.onBLEConnectionStateChange(runtime.connectionStateHandler)
    runtime.wx.onBLECharacteristicValueChange(runtime.valueChangeHandler)
  }

  runtime.handleDeviceFound = (device) => {
    if (!device || !device.deviceId) {
      return
    }

    const normalized = normalizeDevice(device)
    const nextDevices = sortDeviceList(upsertDevice(runtime.state.deviceList, normalized))
    runtime.setState({ deviceList: nextDevices })
  }

  runtime.stopScan = () => {
    if (!runtime.state.isScanning) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      runtime.wx.stopBluetoothDevicesDiscovery({
        complete: () => {
          runtime.setState({ isScanning: false })
          resolve()
        },
      })
    })
  }

  runtime.startScan = async () => {
    if (!runtime.state.adapterReady || runtime.state.isScanning) {
      return
    }

    runtime.setState({
      isScanning: true,
      devicesExpanded: false,
      deviceList: [],
    })
    runtime.appendLog('开始扫描设备')

    try {
      await wxAsync(runtime.wx, 'startBluetoothDevicesDiscovery', {
        allowDuplicatesKey: false,
      })
    } catch (error) {
      runtime.setState({ isScanning: false })
      runtime.appendLog(`扫描失败: ${runtime.getErrorText(error)}`)
    }
  }

  runtime.discoverServices = async (deviceId) => {
    const servicesResult = await wxAsync(runtime.wx, 'getBLEDeviceServices', { deviceId })
    const services = servicesResult.services || []
    const normalizedPreferredServiceIds = [
      '0000FFE0-0000-1000-8000-00805F9B34FB',
      '49535343-FE7D-4AE5-8FA9-9FAFD205E455',
    ]

      runtime.appendLog(`发现服务数量: ${services.length}`)

    const prioritizedServices = services
      .slice()
      .sort((left, right) => {
        const leftIndex = normalizedPreferredServiceIds.indexOf(normalizeUuid(left.uuid))
        const rightIndex = normalizedPreferredServiceIds.indexOf(normalizeUuid(right.uuid))
        const safeLeftIndex = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex
        const safeRightIndex = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex
        return safeLeftIndex - safeRightIndex
      })

    for (let index = 0; index < prioritizedServices.length; index += 1) {
      const serviceId = prioritizedServices[index].uuid
      const preferredProfile = getPreferredProfile(serviceId)

      runtime.appendLog(`检查服务: ${serviceId}`)
      const charsResult = await wxAsync(runtime.wx, 'getBLEDeviceCharacteristics', {
        deviceId,
        serviceId,
      })
      const characteristics = charsResult.characteristics || []
      const characteristicIds = pickCharacteristicIds(characteristics, preferredProfile)
      const characteristicSummary = characteristics
        .map((item) => {
          const properties = item.properties || {}
          const propertyNames = Object.keys(properties).filter((key) => properties[key])
          return `${item.uuid}${propertyNames.length ? `(${propertyNames.join('/')})` : ''}`
        })
        .join(', ')

      runtime.appendLog(`特征值: ${characteristicSummary || '无'}`)

      if (characteristicIds.writeCharacteristicId) {
        runtime.appendLog(
          `selected service=${serviceId} write=${characteristicIds.writeCharacteristicId} notify=${characteristicIds.notifyCharacteristicId || 'none'}`,
        )
        return {
          serviceId,
          writeCharacteristicId: characteristicIds.writeCharacteristicId,
          notifyCharacteristicId: characteristicIds.notifyCharacteristicId,
        }
      }
    }

    return {
      serviceId: '',
      writeCharacteristicId: '',
      notifyCharacteristicId: '',
    }
  }

  runtime.enableNotifications = async () => {
    await wxAsync(runtime.wx, 'notifyBLECharacteristicValueChange', {
      deviceId: runtime.state.deviceId,
      serviceId: runtime.state.serviceId,
      characteristicId: runtime.state.notifyCharacteristicId,
      state: true,
    })

      runtime.appendLog(`已开启通知: ${runtime.state.notifyCharacteristicId}`)
  }

  runtime.connectDevice = async (deviceId, deviceName, skipSave) => {
    await runtime.stopScan()

    runtime.appendLog(`正在连接: ${deviceName}`)

    try {
      await wxAsync(runtime.wx, 'createBLEConnection', {
        deviceId,
        timeout: 10000,
      })

      const discovery = await runtime.discoverServices(deviceId)

      if (!discovery.writeCharacteristicId) {
        throw new Error('no writable characteristic found')
      }

      runtime.stopAuthCountdown()
      runtime.stopLockoutCountdown()
      runtime.clearAutoUnlockGuard()
      runtime.lastRssiReadFailureLoggedAt = 0
      const lockProfile = runtime.loadLockProfile(deviceId, deviceName)
      const persistedPin = lockProfile.savePinEnabled && isValidLockPin(lockProfile.savedPin)
        ? String(lockProfile.savedPin).trim()
        : ''
      runtime.setState({
        isConnected: true,
        deviceId,
        deviceName,
        serviceId: discovery.serviceId,
        writeCharacteristicId: discovery.writeCharacteristicId,
        notifyCharacteristicId: discovery.notifyCharacteristicId,
        authAuthorized: false,
        authRemainingSeconds: 0,
        authLockedSeconds: 0,
        lastLockAction: '',
        logsExpanded: false,
        devicesExpanded: false,
        lockProfile,
        currentClientId: lockProfile.clientId || '',
        sessionChallenge: '',
        sessionProofSource: '',
        bindNickname: lockProfile.nickname || '',
        authPin: persistedPin,
        authPinDraft: persistedPin || runtime.state.authPinDraft || '',
        newPinDraft: '',
        newPinConfirmDraft: '',
        selectedRelockSeconds: ALLOWED_RELOCK_SECONDS.includes(Number(lockProfile.relockSeconds))
          ? Number(lockProfile.relockSeconds)
          : 5,
        automationStateLabel: runtime.buildAutomationIdleLabel(),
        trustedPhones: [],
        trustedPhoneView: [],
        requiresProvisioning: false,
      })

      if (discovery.notifyCharacteristicId) {
        await runtime.enableNotifications()
      } else {
        runtime.appendLog('连接成功，但未发现通知特征值')
      }

      if (!skipSave) {
        runtime.wx.setStorageSync(LAST_DEVICE_KEY, {
          deviceId,
          deviceName,
        })
      }

      runtime.startRssiPolling()
      await runtime.writeCommand('STATUS\n')
      await runtime.writeCommand('TRUST LIST\n')

      runtime.appendLog(`已连接: ${deviceName}`)
    } catch (error) {
      runtime.resetConnectionState()
      throw error
    }
  }

  runtime.tryReconnect = async () => {
    if (!runtime.state.autoReconnect) {
      return false
    }

    const savedDevice = runtime.wx.getStorageSync(LAST_DEVICE_KEY)
    if (!savedDevice || !savedDevice.deviceId) {
      return false
    }

    const reconnectProfile = runtime.loadLockProfile(
      savedDevice.deviceId,
      savedDevice.deviceName || '上次连接设备',
    )
    if (reconnectProfile.autoConnect === false) {
      runtime.appendLog('已跳过自动连接: 当前设备档案关闭了自动连接')
      return false
    }

    runtime.setState({ reconnecting: true })
        runtime.appendLog(`正在尝试重连: ${savedDevice.deviceName || savedDevice.deviceId}`)

    try {
      await runtime.connectDevice(savedDevice.deviceId, savedDevice.deviceName || '上次连接设备', true)
      return true
    } catch (error) {
      runtime.appendLog(`自动重连失败: ${runtime.getErrorText(error)}`)
      return false
    } finally {
      runtime.setState({ reconnecting: false })
    }
  }

  runtime.initBluetooth = async () => {
    try {
      await wxAsync(runtime.wx, 'openBluetoothAdapter')
      runtime.setState({ adapterReady: true })
      runtime.appendLog('蓝牙适配器已就绪')

      const reconnected = await runtime.tryReconnect()
      if (!reconnected) {
        await runtime.startScan()
      }
    } catch (error) {
      runtime.setState({ adapterReady: false })
      runtime.appendLog(`蓝牙不可用: ${runtime.getErrorText(error)}`)
    }
  }

  runtime.stopRssiPolling = () => {
    runtime.rssiPollRunId += 1
    if (runtime.rssiPollTimer) {
      runtime.timers.clearTimeout(runtime.rssiPollTimer)
      runtime.rssiPollTimer = null
    }
  }

  runtime.handleRssiSample = async (rssi) => {
    const profile = runtime.getCurrentLockProfile()
    runtime.setState({ currentRssi: Number(rssi) })

    const result = reduceProximityState(
      runtime.proximityState,
      runtime.buildProximityReducerInput(profile, {
        rssi: Number(rssi),
      }),
    )

    runtime.proximityState = result.state
    if (result.action === 'request_trusted_auth') {
      const clientKey = String(profile.clientKey || '').trim().toUpperCase()
      if (!clientKey) {
        runtime.proximityState = createProximityState()
        runtime.setState({ automationStateLabel: '自动认证需要可信手机密钥，请重新绑定' })
        return
      }

      const hasChallenge = await runtime.ensureSessionChallenge()
      if (!hasChallenge) {
        runtime.setState({ automationStateLabel: '等待会话挑战，请稍后重试自动认证' })
        return
      }

      const mac = runtime.buildProofMac(clientKey, 'TPIN', normalizeClientId(profile.clientId))
      if (!mac) {
        runtime.setState({ automationStateLabel: '会话挑战计算失败，请稍后重试自动认证' })
        return
      }

      runtime.setState({ automationStateLabel: '距离已满足，正在自动认证' })
      await runtime.writeCommand(buildSessionProofCommand('TPIN', normalizeClientId(profile.clientId), '', mac))
    }

    if (result.action === 'request_unlock') {
      await runtime.requestAutomatedUnlock()
    }
  }

  runtime.startRssiPolling = () => {
    runtime.stopRssiPolling()
    runtime.rssiPollRunId += 1
    const runId = runtime.rssiPollRunId
    const scheduleNext = () => {
      if (runtime.rssiPollRunId !== runId) {
        return
      }

      runtime.rssiPollTimer = runtime.timers.setTimeout(async () => {
        runtime.rssiPollTimer = null

        if (runtime.rssiPollRunId !== runId) {
          return
        }

        if (runtime.state.isConnected && runtime.state.deviceId) {
          try {
            const result = await wxAsync(runtime.wx, 'getBLEDeviceRSSI', { deviceId: runtime.state.deviceId })
            if (runtime.rssiPollRunId === runId && runtime.state.isConnected && runtime.state.deviceId) {
              await runtime.handleRssiSample(result.RSSI)
            }
          } catch (error) {
            if (runtime.rssiPollRunId === runId) {
              runtime.logRssiReadFailure(error)
            }
          }
        }

        scheduleNext()
      }, RSSI_POLL_INTERVAL_MS)
    }

    scheduleNext()
  }

  runtime.requestAutomatedUnlock = async () => {
    if (!runtime.beginAutoUnlockGuard()) {
      return false
    }

    runtime.setState({ automationStateLabel: '可信手机正在开锁' })
    try {
      const hasChallenge = await runtime.ensureSessionChallenge()
      if (!hasChallenge) {
        runtime.appendLog('自动开锁已跳过: 会话挑战尚未就绪')
        runtime.clearAutoUnlockGuard()
        return false
      }
      const secret = runtime.getSessionProofSecret()
      const mac = runtime.buildProofMac(secret, 'UNLOCK')
      if (!mac) {
        runtime.appendLog('自动开锁已跳过: 会话挑战计算失败')
        runtime.clearAutoUnlockGuard()
        return false
      }
      const sent = await runtime.writeCommand(buildSessionProofCommand('UNLOCK', '', '', mac))
      if (!sent) {
        runtime.clearAutoUnlockGuard()
      }
      return sent
    } catch (error) {
      runtime.clearAutoUnlockGuard()
      throw error
    }
  }

  runtime.writeCommand = async (command) => {
    if (!runtime.state.isConnected || !runtime.state.serviceId || !runtime.state.writeCharacteristicId) {
      runtime.appendLog('无法发送: 设备尚未就绪')
      return false
    }

    await wxAsync(runtime.wx, 'writeBLECharacteristicValue', {
      deviceId: runtime.state.deviceId,
      serviceId: runtime.state.serviceId,
      characteristicId: runtime.state.writeCharacteristicId,
      value: stringToArrayBuffer(command),
    })

    const normalizedCommand = String(command || '').trim()
    const upperCommand = normalizedCommand.toUpperCase()
    let logCommand = normalizedCommand
    if (upperCommand.startsWith('PINSET ')) {
      logCommand = 'PINSET [REDACTED]'
    } else if (upperCommand.startsWith('TPIN ')) {
      logCommand = 'TPIN [REDACTED]'
    } else if (upperCommand.startsWith('PIN ')) {
      logCommand = 'PIN [REDACTED]'
    }

    runtime.appendLog(`send: ${logCommand}`)
    return true
  }

  runtime.sendAngle = async (angle) => {
    if (!runtime.state.canSend) {
      return
    }

    const targetAngle = clampAngle(angle)
    const hasChallenge = await runtime.ensureSessionChallenge()
    if (!hasChallenge) {
      runtime.appendLog('角度控制已跳过: 会话挑战尚未就绪')
      return
    }
    const secret = runtime.getSessionProofSecret()
    const commandName = `A${targetAngle}`
    const mac = runtime.buildProofMac(secret, commandName)

    if (!mac) {
      runtime.appendLog('角度控制已跳过: 会话挑战计算失败')
      return
    }

    try {
      const sent = await runtime.writeCommand(buildSessionProofCommand(commandName, '', '', mac))
      if (sent) {
        runtime.setState({ currentAngle: targetAngle })
      }
    } catch (error) {
      runtime.appendLog(`send failed: ${runtime.getErrorText(error)}`)
    }
  }

  runtime.resetConnectionState = () => {
    runtime.stopRssiPolling()
    runtime.clearAutoUnlockGuard()
    runtime.clearStatusSyncTimer()
    runtime.clearPendingDeviceMutations()
    runtime.lastRssiReadFailureLoggedAt = 0
    runtime.stopAuthCountdown()
    runtime.stopLockoutCountdown()
    runtime.proximityState = createProximityState()
    runtime.setState({
      isConnected: false,
      reconnecting: false,
      logsExpanded: false,
      devicesExpanded: false,
      deviceId: '',
      deviceName: '未连接设备',
      serviceId: '',
      writeCharacteristicId: '',
      notifyCharacteristicId: '',
      authAuthorized: false,
      authRemainingSeconds: 0,
      authLockedSeconds: 0,
      lastLockAction: '',
      lockProfile: null,
      trustedPhones: [],
      trustedPhoneView: [],
      currentClientId: '',
      sessionChallenge: '',
      sessionProofSource: '',
      bindNickname: '',
      authPin: '',
      authPinDraft: '',
      newPin: '',
      newPinDraft: '',
      newPinConfirm: '',
      newPinConfirmDraft: '',
      selectedRelockSeconds: 5,
      currentRssi: null,
      automationStateLabel: runtime.buildAutomationIdleLabel(),
      requiresProvisioning: false,
    })
  }

  runtime.queueRealtimeSend = (angle) => {
    if (!runtime.state.canSend) {
      runtime.clearRealtimeTimer()
      runtime.realtimePendingAngle = null
      return
    }

    const elapsed = Date.now() - runtime.realtimeLastSentAt
    runtime.realtimePendingAngle = angle

    if (elapsed >= REALTIME_INTERVAL_MS && !runtime.realtimeTimer) {
      runtime.realtimeLastSentAt = Date.now()
      runtime.sendAngle(angle)
      return
    }

    runtime.clearRealtimeTimer()
    runtime.realtimeTimer = runtime.timers.setTimeout(() => {
      runtime.realtimeTimer = null
      runtime.realtimeLastSentAt = Date.now()
      runtime.sendAngle(runtime.realtimePendingAngle)
    }, Math.max(REALTIME_INTERVAL_MS - elapsed, 0))
  }

  runtime.actions = {
    init: () => runtime.init(),
    destroy: () => runtime.destroy(),
    subscribe: (listener) => runtime.subscribe(listener),
    getSnapshot: () => runtime.getSnapshot(),
    initBluetooth: () => runtime.initBluetooth(),
    startScan: () => runtime.startScan(),
    stopScan: () => runtime.stopScan(),
    connectDevice: (deviceId, deviceName, skipSave = false) => runtime.connectDevice(deviceId, deviceName, skipSave),
    disconnectDevice: async () => {
      if (!runtime.state.deviceId) {
        return
      }

      const disconnectedId = runtime.state.deviceId
      await new Promise((resolve) => {
        runtime.wx.closeBLEConnection({
          deviceId: disconnectedId,
          complete: () => resolve(),
        })
      })

      runtime.appendLog('已手动断开设备')
      runtime.resetConnectionState()
    },
    setAuthPin: (authPin) => {
      const normalizedPin = String(authPin || '')
      runtime.setState({
        authPinDraft: normalizedPin,
        authPin: normalizedPin,
      })
      runtime.persistSavedPinIfNeeded(normalizedPin)
    },
    setBindNickname: (bindNickname) => runtime.setState({ bindNickname: String(bindNickname || '') }),
    setNewPin: (newPin) => runtime.setState({
      newPinDraft: String(newPin || ''),
      newPin: String(newPin || '').trim(),
    }),
    setNewPinConfirm: (newPinConfirm) => runtime.setState({
      newPinConfirmDraft: String(newPinConfirm || ''),
      newPinConfirm: String(newPinConfirm || '').trim(),
    }),
    setAutoReconnect: (autoReconnect) => {
      runtime.setState({ autoReconnect: !!autoReconnect })
      runtime.appendLog(`全局自动重连已${autoReconnect ? '开启' : '关闭'}`)
    },
    setRealtimeMode: (realtimeMode) => {
      runtime.setState({ realtimeMode: !!realtimeMode })
      runtime.appendLog(`实时模式已${realtimeMode ? '开启' : '关闭'}`)
    },
    toggleLogsExpanded: () => runtime.setState({ logsExpanded: !runtime.state.logsExpanded }),
    toggleDevicesExpanded: () => runtime.setState({ devicesExpanded: !runtime.state.devicesExpanded }),
    authenticate: async () => {
      if (!runtime.state.canAuthenticate) {
        return false
      }
      return runtime.sendAuthenticateWithCurrentPin()
    },
    sendLockAction: async (action) => {
      if (!action) {
        runtime.appendLog('门锁指令已跳过: 缺少动作参数')
        return false
      }
      const hasChallenge = await runtime.ensureSessionChallenge()
      if (!hasChallenge) {
        runtime.appendLog('门锁指令已跳过: 会话挑战尚未就绪')
        return false
      }
      const secret = runtime.getSessionProofSecret()
      const mac = runtime.buildProofMac(secret, action)
      if (!mac) {
        runtime.appendLog('门锁指令已跳过: 会话挑战计算失败')
        return false
      }
      return runtime.writeCommand(buildSessionProofCommand(action, '', '', mac))
    },
    handleAutoConnectProfileToggle: (enabled) => {
      if (!runtime.state.profileSettingsEnabled) {
        return
      }
      runtime.saveLockProfile({ autoConnect: !!enabled })
    },
    handleSavePinToggle: (enabled) => {
      if (!runtime.state.profileSettingsEnabled) {
        return
      }
      const pin = String(runtime.state.authPinDraft || runtime.state.authPin || '').trim()
      runtime.saveLockProfile({
        savePinEnabled: !!enabled,
        savedPin: enabled && isValidLockPin(pin) ? pin : '',
      })
      if (enabled) {
        runtime.appendLog('出于安全考虑，生产模式下不再在本地保存 PIN')
      }
    },
    handleAutoAuthToggle: (enabled) => {
      if (!runtime.state.profileSettingsEnabled) {
        return
      }
      if (enabled && !String(runtime.state.lockProfile && runtime.state.lockProfile.clientKey || '').trim()) {
        runtime.appendLog('开启自动认证前，请先完成可信手机绑定')
        return
      }
      runtime.saveLockProfile({ autoAuth: !!enabled })
      if (!enabled) {
        runtime.proximityState = createProximityState()
        runtime.setState({ automationStateLabel: runtime.buildAutomationIdleLabel() })
      }
    },
    handleProximityUnlockToggle: (enabled) => {
      if (!runtime.state.profileSettingsEnabled) {
        return
      }
      if (enabled && !String(runtime.state.lockProfile && runtime.state.lockProfile.clientKey || '').trim()) {
        runtime.appendLog('开启靠近自动开锁前，请先完成可信手机绑定')
        return
      }
      runtime.saveLockProfile({ proximityUnlock: !!enabled })
      if (!enabled) {
        runtime.proximityState = createProximityState()
        runtime.setState({ automationStateLabel: runtime.buildAutomationIdleLabel() })
      }
    },
    handleRssiThresholdChange: (threshold) => {
      if (!runtime.state.profileSettingsEnabled) {
        return
      }
      const normalized = normalizeRssiThresholdValue(
        threshold,
        runtime.state.lockProfile && runtime.state.lockProfile.rssiThreshold,
      )
      runtime.saveLockProfile({ rssiThreshold: normalized })
    },
    bindCurrentPhone: async () => {
      if (!runtime.state.profileSettingsEnabled) {
        runtime.appendLog('绑定已跳过: 当前没有可用设备档案')
        return false
      }
      try {
        const profile = runtime.state.lockProfile || {}
        const clientId = profile.clientId || runtime.getOrCreateClientId()
        const clientKey = profile.clientKey || runtime.getOrCreateClientKey()
        const nickname = runtime.state.bindNickname || 'MY_PHONE'
        const hasChallenge = await runtime.ensureSessionChallenge()
        if (!hasChallenge) {
          runtime.appendLog('绑定已跳过: 会话挑战尚未就绪')
          return false
        }
        const sessionPin = runtime.getSessionPinCredential()
        const mac = runtime.buildProofMac(sessionPin, 'BIND', clientId, clientKey, nickname)
        if (!mac) {
          runtime.appendLog('绑定已跳过: 会话挑战计算失败')
          return false
        }
        runtime.pendingBindRequest = {
          clientId: normalizeClientId(clientId),
          clientKey: String(clientKey || '').trim().toUpperCase(),
          nickname: normalizeNickname(nickname),
        }
        const sent = await runtime.writeCommand(
          `${buildBindCommandWithKey(clientId, clientKey, nickname).trim()} ${mac}\n`,
        )
        if (!sent) {
          runtime.pendingBindRequest = null
        }
        return sent
      } catch (error) {
        runtime.pendingBindRequest = null
        runtime.appendLog(`绑定指令发送失败: ${runtime.getErrorText(error)}`)
        return false
      }
    },
    changePin: async () => {
      if (!runtime.state.profileSettingsEnabled) {
        runtime.appendLog('PIN 修改已跳过: 当前没有可用设备档案')
        return false
      }

      const nextPin = String(runtime.state.newPinDraft || runtime.state.newPin || '').trim()
      const nextPinConfirm = String(runtime.state.newPinConfirmDraft || runtime.state.newPinConfirm || '').trim()
      const currentPinDraft = String(runtime.state.authPinDraft || runtime.state.authPin || '').trim()

      if (!isValidLockPin(nextPin)) {
        runtime.appendLog('PIN 修改已跳过: 新 PIN 需为 6 到 11 位数字')
        return false
      }
      if (nextPin !== nextPinConfirm) {
        runtime.appendLog('PIN 修改已跳过: 两次输入的新 PIN 不一致')
        return false
      }

      const command = runtime.state.requiresProvisioning
        ? buildPinSetInitCommand(nextPin)
        : buildPinSetCommand(currentPinDraft, nextPin)

      if (!runtime.state.requiresProvisioning) {
        const currentPin = currentPinDraft
        if (!isValidLockPin(currentPin)) {
          runtime.appendLog('PIN 修改已跳过: 当前 PIN 需为 6 到 11 位数字')
          return false
        }
      }

      try {
        const currentPin = currentPinDraft
        const hasChallenge = await runtime.ensureSessionChallenge()
        if (!hasChallenge) {
          runtime.appendLog('PIN 修改已跳过: 会话挑战尚未就绪')
          return false
        }
        const mac = runtime.buildProofMac(currentPin, 'PINSET', currentPin, nextPin)
        if (!mac) {
          runtime.appendLog('PIN 修改已跳过: 会话挑战计算失败')
          return false
        }
        runtime.pendingPinChange = {
          newPin: nextPin,
          persistLocalPin: !!(runtime.state.lockProfile && runtime.state.lockProfile.savePinEnabled),
        }
        const sent = await runtime.writeCommand(`${command.trim()} ${mac}\n`)
        if (!sent) {
          runtime.pendingPinChange = null
        }
        return sent
      } catch (error) {
        runtime.pendingPinChange = null
        runtime.appendLog(`PIN 修改指令发送失败: ${runtime.getErrorText(error)}`)
        return false
      }
    },
    setRelockSeconds: async (seconds) => {
      if (!runtime.state.profileSettingsEnabled) {
        runtime.appendLog('自动重锁设置已跳过: 当前没有可用设备档案')
        return false
      }
      try {
        runtime.pendingRelockSeconds = normalizeRelockSeconds(seconds)
        const hasChallenge = await runtime.ensureSessionChallenge()
        if (!hasChallenge) {
          runtime.appendLog('自动重锁设置已跳过: 会话挑战尚未就绪')
          return false
        }
        const secret = runtime.getSessionProofSecret()
        const selected = normalizeRelockSeconds(seconds)
        const mac = runtime.buildProofMac(secret, 'RELOCK', String(selected))
        if (!mac) {
          runtime.appendLog('自动重锁设置已跳过: 会话挑战计算失败')
          return false
        }
        const sent = await runtime.writeCommand(buildSessionProofCommand('RELOCK', String(selected), '', mac))
        if (!sent) {
          runtime.pendingRelockSeconds = null
        }
        return sent
      } catch (error) {
        runtime.pendingRelockSeconds = null
        runtime.appendLog(`自动重锁指令发送失败: ${runtime.getErrorText(error)}`)
        return false
      }
    },
    unbindPhone: async (clientId) => {
      if (!runtime.state.profileSettingsEnabled) {
        runtime.appendLog('解绑已跳过: 当前没有可用设备档案')
        return false
      }
      try {
        runtime.pendingUnbindClientId = normalizeClientId(clientId)
        const hasChallenge = await runtime.ensureSessionChallenge()
        if (!hasChallenge) {
          runtime.appendLog('解绑已跳过: 会话挑战尚未就绪')
          return false
        }
        const secret = runtime.getSessionProofSecret()
        const normalizedClientId = normalizeClientId(clientId)
        const mac = runtime.buildProofMac(secret, 'UNBIND', normalizedClientId)
        if (!mac) {
          runtime.appendLog('解绑已跳过: 会话挑战计算失败')
          return false
        }
        const sent = await runtime.writeCommand(buildSessionProofCommand('UNBIND', normalizedClientId, '', mac))
        if (!sent) {
          runtime.pendingUnbindClientId = ''
        }
        return sent
      } catch (error) {
        runtime.pendingUnbindClientId = ''
        runtime.appendLog(`解绑指令发送失败: ${runtime.getErrorText(error)}`)
        return false
      }
    },
    setCurrentAngle: (angle) => runtime.setState({ currentAngle: clampAngle(angle) }),
    sendCurrentAngle: () => runtime.sendAngle(runtime.state.currentAngle),
    queueRealtimeSend: (angle) => runtime.queueRealtimeSend(angle),
    sendAngle: (angle) => runtime.sendAngle(angle),
  }

  runtime.subscribe = (listener) => {
    if (typeof listener !== 'function') {
      return () => {}
    }

    runtime.subscribers.add(listener)
    listener(runtime.getSnapshot())
    return () => {
      runtime.subscribers.delete(listener)
    }
  }

  runtime.init = async () => {
    if (runtime.initialized) {
      runtime.emit()
      return runtime.getSnapshot()
    }

    runtime.initialized = true
    runtime.updateDerivedView()
    runtime.registerBluetoothListeners()
    runtime.appendLog('运行时已就绪')
    await runtime.initBluetooth()
    return runtime.getSnapshot()
  }

  runtime.dispose = async () => {
    runtime.clearRealtimeTimer()
    runtime.stopRssiPolling()
    runtime.proximityState = createProximityState()
    runtime.clearAutoUnlockGuard()
    runtime.clearStatusSyncTimer()
    runtime.clearPendingDeviceMutations()
    runtime.stopAuthCountdown()
    runtime.stopLockoutCountdown()
    runtime.unregisterBluetoothListeners()
    await runtime.stopScan()
    if (typeof runtime.wx.closeBluetoothAdapter === 'function') {
      await new Promise((resolve) => {
        runtime.wx.closeBluetoothAdapter({
          complete: () => resolve(),
        })
      })
    }
    runtime.initialized = false
  }

  runtime.destroy = () => runtime.dispose()

  runtime.updateDerivedView()

  if (options.autoInit) {
    runtime.init().catch((error) => {
      runtime.appendLog(`运行时初始化失败: ${runtime.getErrorText(error)}`)
    })
  }

  return runtime
}

let runtimeSingleton = null

function getRuntimeSingleton() {
  if (!runtimeSingleton) {
    runtimeSingleton = createLockRuntime()
  }
  return runtimeSingleton
}

function initLockRuntime() {
  return getRuntimeSingleton().init()
}

function subscribeLockRuntime(listener) {
  return getRuntimeSingleton().subscribe(listener)
}

function getLockRuntimeSnapshot() {
  return getRuntimeSingleton().getSnapshot()
}

module.exports = {
  ALLOWED_RELOCK_SECONDS,
  createLockRuntime,
  createInitialState,
  initLockRuntime,
  subscribeLockRuntime,
  getLockRuntimeSnapshot,
  getLockRuntime: getRuntimeSingleton,
  normalizeRelockSeconds,
}
