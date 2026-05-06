const HOLD_MS = 2000

function createProximityState() {
  return {
    phase: 'idle',
    holdStartedAt: 0,
  }
}

function shouldReset(input) {
  return (
    input.disconnected ||
    !input.isConnected ||
    !input.isTrusted ||
    !input.autoAuthEnabled ||
    !input.proximityUnlockEnabled ||
    !input.hasPinCredential
  )
}

function reduceProximityState(state, input) {
  if (shouldReset(input)) {
    return { state: createProximityState(), action: 'none' }
  }

  const current = state
    ? {
        phase: state.phase || 'idle',
        holdStartedAt: Number(state.holdStartedAt) || 0,
      }
    : createProximityState()
  const aboveThreshold = Number(input.rssi) >= Number(input.threshold)

  if (!aboveThreshold) {
    return { state: createProximityState(), action: 'none' }
  }

  if (current.phase === 'idle') {
    return {
      state: { phase: 'observing', holdStartedAt: input.nowMs },
      action: 'none',
    }
  }

  if (current.phase === 'cooldown') {
    return { state: current, action: 'none' }
  }

  if (current.phase === 'observing' && (input.nowMs - current.holdStartedAt) >= HOLD_MS) {
    return {
      state: { phase: 'auth_pending', holdStartedAt: current.holdStartedAt },
      action: 'request_trusted_auth',
    }
  }

  if (current.phase === 'observing') {
    return { state: current, action: 'none' }
  }

  if (current.phase === 'auth_pending' && input.authSucceeded && input.lockState === 'LOCK') {
    return {
      state: { phase: 'cooldown', holdStartedAt: current.holdStartedAt },
      action: 'request_unlock',
    }
  }

  if (current.phase === 'auth_pending' && input.authSucceeded) {
    return {
      state: { phase: 'cooldown', holdStartedAt: current.holdStartedAt },
      action: 'none',
    }
  }

  if (current.phase === 'auth_pending' && input.authFailed) {
    return { state: createProximityState(), action: 'none' }
  }

  return { state: current, action: 'none' }
}

module.exports = {
  HOLD_MS,
  createProximityState,
  reduceProximityState,
}
