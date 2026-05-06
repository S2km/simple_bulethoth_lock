const test = require('node:test')
const assert = require('node:assert/strict')

const {
  HOLD_MS,
  createProximityState,
  reduceProximityState,
} = require('../miniprogram/utils/proximity_helpers')

function makeInput(overrides = {}) {
  return {
    nowMs: 0,
    isConnected: true,
    isTrusted: true,
    autoAuthEnabled: true,
    proximityUnlockEnabled: true,
    hasPinCredential: true,
    lockState: 'LOCK',
    rssi: -55,
    threshold: -60,
    authSucceeded: false,
    authFailed: false,
    disconnected: false,
    ...overrides,
  }
}

test('continuous hold is required before requesting trusted auto auth', () => {
  let state = createProximityState()
  let result = reduceProximityState(state, makeInput({ nowMs: 0 }))
  assert.equal(result.action, 'none')

  result = reduceProximityState(result.state, makeInput({ nowMs: HOLD_MS - 500 }))
  assert.equal(result.action, 'none')

  result = reduceProximityState(result.state, makeInput({ nowMs: HOLD_MS + 100 }))
  assert.equal(result.action, 'request_trusted_auth')
})

test('one strong sample below hold time does not trigger auth', () => {
  const result = reduceProximityState(createProximityState(), makeInput({ nowMs: 500 }))
  assert.equal(result.action, 'none')
})

test('auth success triggers exactly one unlock request', () => {
  let state = createProximityState()
  state = reduceProximityState(state, makeInput({ nowMs: 0 })).state
  state = reduceProximityState(state, makeInput({ nowMs: HOLD_MS + 100 })).state
  const result = reduceProximityState(state, makeInput({ nowMs: HOLD_MS + 200, authSucceeded: true }))
  assert.equal(result.action, 'request_unlock')

  const repeat = reduceProximityState(result.state, makeInput({ nowMs: HOLD_MS + 300, authSucceeded: true }))
  assert.equal(repeat.action, 'none')
})

test('auth success while lock is already unlocked enters cooldown without a duplicate unlock', () => {
  let state = createProximityState()
  state = reduceProximityState(state, makeInput({ nowMs: 0 })).state
  state = reduceProximityState(state, makeInput({ nowMs: HOLD_MS + 100 })).state
  const result = reduceProximityState(
    state,
    makeInput({ nowMs: HOLD_MS + 200, authSucceeded: true, lockState: 'UNLOCK' }),
  )
  assert.equal(result.action, 'none')
  assert.equal(result.state.phase, 'cooldown')
})

test('remaining above threshold after one unlock keeps cooldown active until exit', () => {
  let state = createProximityState()
  state = reduceProximityState(state, makeInput({ nowMs: 0 })).state
  state = reduceProximityState(state, makeInput({ nowMs: HOLD_MS + 100 })).state
  state = reduceProximityState(state, makeInput({ nowMs: HOLD_MS + 200, authSucceeded: true })).state
  const sameZone = reduceProximityState(state, makeInput({ nowMs: 7000, lockState: 'LOCK' }))
  assert.equal(sameZone.action, 'none')

  const exited = reduceProximityState(sameZone.state, makeInput({ nowMs: 7200, rssi: -72 }))
  assert.equal(exited.state.phase, 'idle')

  const reentered = reduceProximityState(exited.state, makeInput({ nowMs: 7400, rssi: -55 }))
  assert.equal(reentered.action, 'none')

  const held = reduceProximityState(reentered.state, makeInput({ nowMs: 7400 + HOLD_MS - 100, rssi: -55 }))
  assert.equal(held.action, 'none')

  const retriggered = reduceProximityState(held.state, makeInput({ nowMs: 7400 + HOLD_MS + 100, rssi: -55 }))
  assert.equal(retriggered.action, 'request_trusted_auth')
})

test('disconnect clears the active proximity session', () => {
  let state = createProximityState()
  state = reduceProximityState(state, makeInput({ nowMs: 0 })).state
  state = reduceProximityState(state, makeInput({ nowMs: HOLD_MS + 100 })).state
  const result = reduceProximityState(state, makeInput({ nowMs: HOLD_MS + 150, disconnected: true, isConnected: false }))
  assert.equal(result.state.phase, 'idle')
  assert.equal(result.action, 'none')
})

;[
  { name: 'connection drops', input: { isConnected: false } },
  { name: 'device is not trusted', input: { isTrusted: false } },
  { name: 'auto auth is disabled', input: { autoAuthEnabled: false } },
  { name: 'proximity unlock is disabled', input: { proximityUnlockEnabled: false } },
  { name: 'pin credential is missing', input: { hasPinCredential: false } },
].forEach(({ name, input }) => {
  test(`reset predicate returns idle state when ${name}`, () => {
    const dirtyState = { phase: 'cooldown', holdStartedAt: 2200, unlockSent: true, requiresExit: true }
    const result = reduceProximityState(dirtyState, makeInput(input))
    assert.deepEqual(result.state, createProximityState())
    assert.equal(result.action, 'none')
  })
})
