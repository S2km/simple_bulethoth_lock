const {
  normalizeRssiThresholdDraft,
  normalizeRssiThresholdValue,
} = require('../../utils/settings_helpers')

const FALLBACK_STATE = {
  runtimeReady: false,
  connectionLabel: '运行时待就绪',
  connectionDetail: '等待共享门锁运行时接入',
  connectionPillClass: 'status-off',
  profileSettingsEnabled: false,
  selectedRelockSeconds: 5,
  automationStateLabel: '运行时待命',
  lockProfile: null,
  bindNickname: '',
  bindNicknameInput: '',
  newPin: '',
  newPinInput: '',
  newPinConfirm: '',
  newPinConfirmInput: '',
  canAdministerLock: false,
  canChangePin: false,
  canSend: false,
  currentAngle: 90,
  realtimeMode: false,
  sliderHintText: '松开滑块后发送',
  trustedPhoneView: [],
  authPin: '',
  authPinInput: '',
  rssiThresholdInput: '',
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

function buildSettingsState(snapshot) {
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

function normalizeNicknameText(value) {
  return String(value || '').slice(0, 20)
}

function syncEditableInput(page, nextState, config) {
  const editingFlag = config.editingFlag
  const localKey = config.localKey
  const snapshotKey = config.snapshotKey
  const inputKey = config.inputKey

  if (page[editingFlag]) {
    nextState[inputKey] = page[localKey]
    return
  }

  page[localKey] = String(nextState[snapshotKey] || '')
  nextState[inputKey] = page[localKey]
}

function computeCurrentCanChangePin(page, snapshot) {
  return computeCanChangePin(
    snapshot,
    page.localAuthPin,
    page.localNewPin,
    page.localNewPinConfirm,
  )
}

function setPinFieldState(page, inputKey, value) {
  const nextData = {}
  nextData[inputKey] = value
  nextData.canChangePin = computeCurrentCanChangePin(page, page.data)
  page.setData(nextData)
}

function computeCanChangePin(snapshot, authPinInput, newPinInput, newPinConfirmInput) {
  const currentPin = String(authPinInput || '').trim()
  const nextPin = String(newPinInput || '').trim()
  const confirmPin = String(newPinConfirmInput || '').trim()
  const hasValidCurrentPin = /^\d{6,11}$/.test(currentPin)
  const hasValidNewPin = /^\d{6,11}$/.test(nextPin)
  const hasMatchingNewPin = hasValidNewPin && nextPin === confirmPin

  if (!snapshot || !snapshot.profileSettingsEnabled || Number(snapshot.authLockedSeconds || 0) > 0) {
    return false
  }

  if (snapshot.requiresProvisioning) {
    return hasValidNewPin && nextPin === confirmPin
  }

  return hasValidCurrentPin && hasMatchingNewPin
}

Page({
  data: buildSettingsState(null),

  onLoad() {
    this.pinEditing = false
    this.newPinEditing = false
    this.newPinConfirmEditing = false
    this.bindNicknameEditing = false
    this.rssiThresholdEditing = false
    this.localAuthPin = ''
    this.localNewPin = ''
    this.localNewPinConfirm = ''
    this.localBindNickname = ''
    this.localRssiThresholdInput = ''
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
      ...buildSettingsState(snapshot),
      runtimeReady: !!(this.runtime && this.runtime.available),
    }

    syncEditableInput(this, nextState, {
      editingFlag: 'pinEditing',
      localKey: 'localAuthPin',
      snapshotKey: 'authPin',
      inputKey: 'authPinInput',
    })
    syncEditableInput(this, nextState, {
      editingFlag: 'newPinEditing',
      localKey: 'localNewPin',
      snapshotKey: 'newPin',
      inputKey: 'newPinInput',
    })
    syncEditableInput(this, nextState, {
      editingFlag: 'newPinConfirmEditing',
      localKey: 'localNewPinConfirm',
      snapshotKey: 'newPinConfirm',
      inputKey: 'newPinConfirmInput',
    })
    syncEditableInput(this, nextState, {
      editingFlag: 'bindNicknameEditing',
      localKey: 'localBindNickname',
      snapshotKey: 'bindNickname',
      inputKey: 'bindNicknameInput',
    })
    syncEditableInput(this, nextState, {
      editingFlag: 'rssiThresholdEditing',
      localKey: 'localRssiThresholdInput',
      snapshotKey: 'rssiThresholdInput',
      inputKey: 'rssiThresholdInput',
    })

    const nextThreshold = nextState.lockProfile && nextState.lockProfile.rssiThreshold
    if (!this.rssiThresholdEditing) {
      this.localRssiThresholdInput = String(nextThreshold === undefined ? '' : nextThreshold)
      nextState.rssiThresholdInput = this.localRssiThresholdInput
    }

    nextState.canChangePin = computeCurrentCanChangePin(this, nextState)

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

  handleAutoConnectProfileToggle(event) {
    return this.invokeAction('handleAutoConnectProfileToggle', !!valueFromEvent(event))
  },

  handleSavePinToggle(event) {
    return this.invokeAction('handleSavePinToggle', !!valueFromEvent(event))
  },

  handleAutoAuthToggle(event) {
    return this.invokeAction('handleAutoAuthToggle', !!valueFromEvent(event))
  },

  handleProximityUnlockToggle(event) {
    return this.invokeAction('handleProximityUnlockToggle', !!valueFromEvent(event))
  },

  handleBindNicknameInput(event) {
    const nextValue = normalizeNicknameText(valueFromEvent(event))
    this.bindNicknameEditing = true
    this.localBindNickname = nextValue
    this.setData({ bindNicknameInput: nextValue })
    return undefined
  },

  handleBindNicknameFocus() {
    this.bindNicknameEditing = true
    this.localBindNickname = String(this.data.bindNicknameInput || '')
  },

  handleBindNicknameBlur(event) {
    this.bindNicknameEditing = false
    const nextValue = normalizeNicknameText(valueFromEvent(event))
    this.localBindNickname = nextValue
    this.setData({ bindNicknameInput: nextValue })
    return this.invokeAction('setBindNickname', nextValue)
  },

  handleBindTap() {
    this.invokeAction('setBindNickname', this.localBindNickname)
    return this.invokeAction('bindCurrentPhone')
  },

  handlePinInput(event) {
    const nextPin = normalizePinText(valueFromEvent(event))
    this.pinEditing = true
    this.localAuthPin = nextPin
    setPinFieldState(this, 'authPinInput', nextPin)
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
    setPinFieldState(this, 'authPinInput', nextPin)
    return this.invokeAction('setAuthPin', nextPin)
  },

  handleNewPinInput(event) {
    const nextPin = normalizePinText(valueFromEvent(event))
    this.newPinEditing = true
    this.localNewPin = nextPin
    setPinFieldState(this, 'newPinInput', nextPin)
    return undefined
  },

  handleNewPinFocus() {
    this.newPinEditing = true
    this.localNewPin = String(this.data.newPinInput || '')
  },

  handleNewPinBlur(event) {
    this.newPinEditing = false
    const nextPin = normalizePinText(valueFromEvent(event))
    this.localNewPin = nextPin
    setPinFieldState(this, 'newPinInput', nextPin)
    return this.invokeAction('setNewPin', nextPin)
  },

  handleNewPinConfirmInput(event) {
    const nextPin = normalizePinText(valueFromEvent(event))
    this.newPinConfirmEditing = true
    this.localNewPinConfirm = nextPin
    setPinFieldState(this, 'newPinConfirmInput', nextPin)
    return undefined
  },

  handleNewPinConfirmFocus() {
    this.newPinConfirmEditing = true
    this.localNewPinConfirm = String(this.data.newPinConfirmInput || '')
  },

  handleNewPinConfirmBlur(event) {
    this.newPinConfirmEditing = false
    const nextPin = normalizePinText(valueFromEvent(event))
    this.localNewPinConfirm = nextPin
    setPinFieldState(this, 'newPinConfirmInput', nextPin)
    return this.invokeAction('setNewPinConfirm', nextPin)
  },

  handleChangePinTap() {
    this.invokeAction('setAuthPin', this.localAuthPin)
    this.invokeAction('setNewPin', this.localNewPin)
    this.invokeAction('setNewPinConfirm', this.localNewPinConfirm)
    return this.invokeAction('changePin')
  },

  handleRelockTap(event) {
    return this.invokeAction('setRelockSeconds', Number(datasetFromEvent(event, 'seconds')))
  },

  handleUnbindTap(event) {
    return this.invokeAction('unbindPhone', datasetFromEvent(event, 'clientId'))
  },

  handleRssiThresholdInput(event) {
    const nextValue = normalizeRssiThresholdDraft(valueFromEvent(event))
    this.rssiThresholdEditing = true
    this.localRssiThresholdInput = nextValue
    this.setData({ rssiThresholdInput: nextValue })
    return undefined
  },

  handleRssiThresholdFocus() {
    this.rssiThresholdEditing = true
    this.localRssiThresholdInput = String(this.data.rssiThresholdInput || '')
  },

  handleRssiThresholdBlur(event) {
    this.rssiThresholdEditing = false
    const normalized = normalizeRssiThresholdValue(
      valueFromEvent(event),
      this.data.lockProfile && this.data.lockProfile.rssiThreshold,
    )
    this.localRssiThresholdInput = String(normalized)
    this.setData({ rssiThresholdInput: this.localRssiThresholdInput })
    return this.invokeAction('handleRssiThresholdChange', normalized)
  },

  handlePresetTap(event) {
    const angle = Number(datasetFromEvent(event, 'angle'))
    this.invokeAction('setCurrentAngle', angle)
    return this.invokeAction('sendAngle', angle)
  },

  handleSliderChanging(event) {
    const angle = Number(valueFromEvent(event))
    this.invokeAction('setCurrentAngle', angle)
    if (this.data.realtimeMode) {
      return this.invokeAction('queueRealtimeSend', angle)
    }
    return undefined
  },

  handleSliderChange(event) {
    const angle = Number(valueFromEvent(event))
    this.invokeAction('setCurrentAngle', angle)
    return this.invokeAction('sendAngle', angle)
  },

  handleRealtimeToggle(event) {
    return this.invokeAction('setRealtimeMode', !!valueFromEvent(event))
  },

  handleSendCurrentTap() {
    return this.invokeAction('sendCurrentAngle')
  },
})
