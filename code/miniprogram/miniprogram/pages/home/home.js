const FALLBACK_STATE = {
  runtimeReady: false,
  connectionTone: 'idle',
  connectionLabel: '运行时待就绪',
  connectionDetail: '等待共享门锁运行时接入',
  isConnected: false,
  adapterReady: false,
  reconnecting: false,
  autoReconnect: true,
  visibleDeviceList: [],
  showDeviceToggle: false,
  deviceToggleText: '展开更多',
  currentAngle: 90,
  currentRssi: null,
  authPin: '',
  authPinInput: '',
  canAuthenticate: false,
  canUnlock: false,
  authStatusLabel: '运行时待就绪',
  authStatusDetail: '共享运行时接入后，首页控制会自动启用',
  authTone: 'idle',
  automationStateLabel: '运行时待命',
  summaryLogs: [],
  logs: [],
  logsExpanded: false,
  logsToggleText: '展开日志',
  recentActionText: '等待运行时',
  compactConnectionPanel: false,
  connectionPanelClass: '',
  connectionPillClass: 'status-off',
  sliderHintText: '松开滑块后发送',
}

function resolveRuntimeApi() {
  const app = typeof getApp === 'function' ? getApp() : null

  if (app && app.lockRuntimeApi) {
    return app.lockRuntimeApi
  }

  if (app && app.globalData && app.globalData.lockRuntimeApi) {
    return app.globalData.lockRuntimeApi
  }

  if (typeof globalThis !== 'undefined' && globalThis.__lockRuntimeApi) {
    return globalThis.__lockRuntimeApi
  }

  return null
}

function getRuntimeBridge() {
  // Integration point for the shared runtime worker:
  // expose the `utils/lock_runtime.js` exports on `app.lockRuntimeApi`,
  // `app.globalData.lockRuntimeApi`, or `globalThis.__lockRuntimeApi`.
  const api = resolveRuntimeApi() || {}
  const hasApi =
    typeof api.initLockRuntime === 'function' &&
    typeof api.subscribeLockRuntime === 'function' &&
    typeof api.getLockRuntimeSnapshot === 'function'

  const actions = api.actions || {}

  return {
    available: hasApi,
    init() {
      if (hasApi) {
        api.initLockRuntime()
      }
    },
    subscribe(listener) {
      if (hasApi) {
        return api.subscribeLockRuntime(listener)
      }
      return () => {}
    },
    getSnapshot() {
      if (hasApi) {
        return api.getLockRuntimeSnapshot()
      }
      return { ...FALLBACK_STATE }
    },
    actions,
  }
}

function buildHomeState(snapshot) {
  return {
    ...FALLBACK_STATE,
    ...(snapshot || {}),
  }
}

function valueFromEvent(event) {
  return event && event.detail ? event.detail.value : ''
}

function datasetFromEvent(event, key) {
  return event && event.currentTarget && event.currentTarget.dataset
    ? event.currentTarget.dataset[key]
    : undefined
}

function normalizePinText(value) {
  return String(value || '').replace(/\D+/g, '').slice(0, 11)
}

function computeCanAuthenticate(snapshot, authPinInput) {
  return !!(
    snapshot &&
    snapshot.isConnected &&
    Number(snapshot.authLockedSeconds || 0) <= 0 &&
    /^\d{6,11}$/.test(String(authPinInput || '').trim())
  )
}

Page({
  data: buildHomeState(null),

  onLoad() {
    this.pinEditing = false
    this.localAuthPin = ''
    this.runtime = getRuntimeBridge()
    this.runtime.init()
    this.unsubscribe = this.runtime.subscribe((snapshot) => {
      this.applyRuntimeSnapshot(snapshot)
    })
    this.applyRuntimeSnapshot(this.runtime.getSnapshot())
  },

  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  },

  applyRuntimeSnapshot(snapshot) {
    const nextState = {
      ...buildHomeState(snapshot),
      runtimeReady: !!(this.runtime && this.runtime.available),
    }

    if (this.pinEditing) {
      nextState.authPinInput = this.localAuthPin
    } else {
      this.localAuthPin = String(nextState.authPin || '')
      nextState.authPinInput = this.localAuthPin
    }

    nextState.canAuthenticate = computeCanAuthenticate(nextState, this.localAuthPin)

    this.setData(nextState)
  },

  invokeAction(actionName, payload) {
    const action = this.runtime && this.runtime.actions
      ? this.runtime.actions[actionName]
      : null

    if (typeof action === 'function') {
      return action(payload)
    }

    return undefined
  },

  handleScanTap() {
    return this.invokeAction('startScan')
  },

  handleDisconnectTap() {
    return this.invokeAction('disconnectDevice')
  },

  handleAutoReconnectToggle(event) {
    return this.invokeAction('setAutoReconnect', !!valueFromEvent(event))
  },

  handleDeviceTap(event) {
    const connectDevice = this.runtime && this.runtime.actions
      ? this.runtime.actions.connectDevice
      : null

    if (typeof connectDevice === 'function') {
      return connectDevice(
        datasetFromEvent(event, 'id'),
        datasetFromEvent(event, 'name') || '蓝牙设备',
        false,
      )
    }

    return undefined
  },

  handleToggleDevices() {
    return this.invokeAction('toggleDevicesExpanded')
  },

  handlePinInput(event) {
    const nextPin = normalizePinText(valueFromEvent(event))
    this.localAuthPin = nextPin
    this.setData({
      authPinInput: nextPin,
      canAuthenticate: computeCanAuthenticate(this.data, nextPin),
    })
    return undefined
  },

  handlePinFocus() {
    this.pinEditing = true
    this.localAuthPin = String(this.data.authPinInput || '')
  },

  handlePinBlur(event) {
    this.pinEditing = false
    const nextPin = normalizePinText(valueFromEvent(event))
    this.localAuthPin = nextPin
    this.setData({
      authPinInput: nextPin,
      canAuthenticate: computeCanAuthenticate(this.data, nextPin),
    })
    return this.invokeAction('setAuthPin', nextPin)
  },

  handleAuthenticateTap() {
    this.invokeAction('setAuthPin', this.localAuthPin)
    return this.invokeAction('authenticate')
  },

  handleLockActionTap(event) {
    return this.invokeAction('sendLockAction', datasetFromEvent(event, 'action'))
  },

  handleSendCurrentTap() {
    return this.invokeAction('sendCurrentAngle')
  },

  handleToggleLogs() {
    return this.invokeAction('toggleLogsExpanded')
  },
})
