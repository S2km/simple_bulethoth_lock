# Smart Lock BLE Authentication Design

**Date:** 2026-04-24

**Project:**
- Firmware: `C:\Users\S2km\Desktop\bulethoth_lock\code\test`
- Mini Program: `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram`

## Goal

Add an application-layer safety gate to the current STM32 + HC-04BLE smart-lock control path so that:

1. connecting to BLE is not enough to unlock,
2. the user must pass a fixed PIN verification first,
3. a successful verification grants a short authorization window of `30 seconds`,
4. lock control commands are rejected automatically after timeout or repeated failures.

This design focuses on a practical first security layer that fits the current hardware:

- STM32F103C8T6
- HC-04BLE on `USART2`
- WeChat Mini Program as the BLE controller
- servo-based lock actuation

## Current Risk

The current firmware accepts plain servo angle commands such as `A90` or `A180` immediately after a BLE connection is established.

That means any nearby phone that can connect to the BLE module may be able to send an unlock angle directly.

For a debugging tool this is acceptable, but for a smart-lock scenario it is unsafe.

## Confirmed Product Decisions

The user confirmed the following security direction:

- control boundary: connect over BLE first, then perform a second verification
- verification type: fixed PIN / password
- authorization behavior: short-lived session after verification
- authorization duration: `30 seconds`

## Security Scope

This design adds **application-layer access control**, not full BLE-grade cryptographic security.

It is intended to stop casual or accidental misuse such as:

- someone connecting and sending raw control commands directly,
- the lock remaining permanently controllable after one successful connection,
- unlimited password guessing without penalty.

It does **not** fully prevent a determined attacker with traffic capture and replay capability.

That stronger protection is intentionally deferred to a later upgrade phase such as:

- challenge-response authentication,
- session token with nonce,
- server-assisted authorization.

## Design Summary

Use a two-layer command model:

1. **authentication commands**
2. **lock action commands**

Only after the firmware accepts a correct PIN does it enter an authorized state for `30 seconds`.

During that window, the app may send lock actions such as `UNLOCK` and `LOCK`.

After timeout, disconnect, or repeated failures, authorization is cleared automatically.

## Command Protocol

### Production Commands

The smart-lock command set becomes:

- `PIN <code>`
- `UNLOCK`
- `LOCK`
- `STATUS`

Examples:

- `PIN 123456`
- `UNLOCK`
- `LOCK`
- `STATUS`

Line ending remains newline-terminated text, matching the current UART/BLE receive flow.

### Responses

The firmware should respond with short text acknowledgements that are easy to print in `USART1` debug output and easy for the mini program to parse.

Recommended responses:

- `AUTH OK 30`
- `AUTH FAIL 1`
- `AUTH FAIL 2`
- `AUTH LOCKED 60`
- `ACTION OK UNLOCK`
- `ACTION OK LOCK`
- `DENY AUTH REQUIRED`
- `DENY AUTH EXPIRED`
- `STATUS LOCKED`
- `STATUS UNLOCKED`
- `STATUS AUTH 18`
- `STATUS AUTH 0`

The trailing number in `AUTH OK 30` means `30 seconds` of authorization remain at the moment of success.

### Debug / Maintenance Commands

The current raw angle command `A<angle>` should no longer be treated as a normal BLE user command for lock operation.

Recommended rule:

- keep `A<angle>` only for maintenance or debugging,
- require the same authorization window before accepting it,
- do not expose it in the normal mini-program lock UI.

This avoids leaving an obvious bypass path in the firmware.

## Firmware State Model

The firmware should maintain a small authentication state machine.

### States

1. `UNAUTHORIZED`
2. `AUTHORIZED`
3. `LOCKOUT`

### State Entry Rules

#### `UNAUTHORIZED`

Default state on boot and after disconnect.

In this state:

- `PIN <code>` is allowed
- `STATUS` is allowed
- `LOCK` / `UNLOCK` are denied
- `A<angle>` is denied unless already authorized

#### `AUTHORIZED`

Entered only after a correct PIN.

In this state:

- `LOCK`
- `UNLOCK`
- `STATUS`
- maintenance `A<angle>`

are allowed until the authorization timer expires.

#### `LOCKOUT`

Entered after too many consecutive PIN failures.

In this state:

- all `PIN` attempts are rejected until cooldown finishes
- action commands remain denied
- `STATUS` remains allowed

## Timing Rules

### Authorization Window

- successful `PIN` verification grants `30 seconds`
- each new successful `PIN` resets the authorization timer back to `30 seconds`
- when the timer reaches zero, state returns to `UNAUTHORIZED`

### Failure Lockout

To slow brute-force attempts, use:

- maximum consecutive PIN failures: `5`
- lockout duration after the 5th failure: `60 seconds`

Behavior:

- failed PIN increments a failure counter
- successful PIN clears the failure counter
- during lockout, firmware replies with `AUTH LOCKED <remaining>`

These values are intentionally modest so they are easy to implement on STM32 and still materially improve safety.

## Disconnect Rules

When the BLE side disconnects, the firmware must immediately revoke authorization.

Recommended behavior:

- clear authorization timer
- keep failure count until a successful PIN or until lockout cooldown finishes
- keep lock state unchanged
- do not automatically unlock or relock because of disconnect

This ensures that reconnecting later still requires explicit authentication.

## Lock Behavior Model

The lock should be controlled as a lock, not as a free-angle servo in normal usage.

Recommended abstraction:

- `LOCK` maps to one fixed servo angle
- `UNLOCK` maps to another fixed servo angle

Example configuration:

- `LOCK_ANGLE = 0`
- `UNLOCK_ANGLE = 90`

The exact angles remain project configuration values because real mechanical linkage may differ.

This is safer than exposing arbitrary angles as the main user API.

## UART Ownership and Trust Boundary

The current project already uses:

- `USART1` for debug / manual serial interaction
- `USART2` for HC-04BLE

Recommended policy:

- treat both channels with the same command parser and same authorization rules for lock actions
- use `USART1` primarily to print detailed debug logs
- do not leave `USART1` with an unauthenticated unlock bypass in normal firmware

Reason:

Even though `USART1` often feels like a developer port, it is still a control path if the board is physically reachable.

## Mini Program Interaction Design

The mini program should move from “connect and send servo angle” to “connect, authenticate, then operate”.

### Main User Flow

1. connect to `HC-04BLE`
2. show state as `connected but not authorized`
3. user enters PIN
4. mini program sends `PIN <code>\n`
5. firmware returns success or failure text
6. on success, UI enters `authorized` mode and shows a `30-second` countdown
7. user may tap `Unlock` or `Lock`
8. when countdown expires, UI returns to `authorization required`

### Mini Program UI Additions

The page should add:

- a PIN input box
- an `Authenticate` button
- an authorization countdown indicator
- explicit lock action buttons:
  - `Unlock`
  - `Lock`
- a clear “authorization required” state label

Recommended behavior:

- hide or de-emphasize raw angle controls in lock mode
- in the lock page, do not show `A<angle>` entry controls at all
- keep debug logs visible
- show firmware response lines in the activity log

### Local PIN Storage

Do **not** auto-store the PIN silently as plain reusable state for convenience in the first version.

Safer first-step behavior:

- user enters PIN when needed
- the app may optionally remember it only if a deliberate “remember on this phone” setting is added later

This avoids turning a lost phone into an immediate unlock remote by default.

## Firmware Parsing Rules

The current parser only understands `A<angle>`.

It should be extended to:

- trim leading and trailing spaces
- detect command verb first
- support:
  - `PIN <digits>`
  - `LOCK`
  - `UNLOCK`
  - `STATUS`
  - maintenance `A<angle>`

Recommended parser policy:

- command keywords are uppercase only in the first version
- reject malformed input clearly
- keep buffers small and bounded
- avoid `sscanf` if simpler manual parsing is clearer and safer in embedded code

## Logging and Debug Visibility

The firmware should continue printing debug information on `USART1`, especially for security-related state changes.

Recommended log lines:

- `DBG auth success on USART2, window=30000ms`
- `DBG auth fail on USART2, count=3`
- `DBG auth lockout on USART2, until=...`
- `DBG auth expired`
- `DBG unlock accepted`
- `DBG unlock denied, auth required`

The mini program should surface user-facing summaries, not every low-level debug line.

## Error Handling

The system should explicitly handle:

- malformed PIN command
- malformed action command
- action requested before authorization
- authorization timeout
- repeated wrong PIN attempts
- BLE disconnect during authorized window

User-facing errors in the mini program should be short and understandable:

- `PIN incorrect`
- `Too many failures, try again later`
- `Authorization expired`
- `Authenticate before unlock`

## Recommended Implementation Boundaries

### Firmware

Implement in or around the existing servo control module:

- authentication state variables
- authorization timer logic using `HAL_GetTick()`
- command parser upgrade
- lock action dispatcher
- debug logging

All STM32 edits must stay inside CubeMX-safe user code regions if touching generated files.

### Mini Program

Implement on top of the current BLE page:

- authentication panel
- auth state in page data
- countdown timer in UI
- lock/unlock command send helpers
- response parsing for auth and status text

## Testing Strategy

### Firmware Manual Tests

1. boot device and connect over BLE
2. send `UNLOCK` before PIN
3. confirm denial
4. send correct `PIN`
5. confirm `AUTH OK 30`
6. send `UNLOCK`
7. confirm servo moves to unlock angle
8. wait more than `30 seconds`
9. send `UNLOCK` again
10. confirm denial
11. send wrong PIN five times
12. confirm lockout response

### Mini Program Manual Tests

1. connect to device
2. confirm page shows unauthorized state
3. enter wrong PIN and confirm friendly error
4. enter correct PIN and confirm countdown starts
5. tap `Unlock`
6. confirm action succeeds within window
7. wait for expiry
8. confirm action buttons become denied or disabled

## Acceptance Criteria

The design is considered successfully implemented when:

1. BLE connection alone no longer permits unlock actions
2. correct PIN enables actions for exactly `30 seconds`
3. expired authorization blocks new unlock attempts
4. repeated wrong PIN attempts trigger temporary lockout
5. lock and unlock are exposed as high-level commands
6. mini program clearly shows unauthorized, authorized, and expired states
7. firmware keeps debug visibility on `USART1`

## Deferred Future Upgrades

These are intentionally out of scope for this phase:

- challenge-response with random nonce
- encrypted or obfuscated PIN exchange
- cloud-based authorization
- multi-user credential management
- audit log persistence in flash
- tamper sensor integration

## Recommendation

Implement this as the next phase before any further polish work on general BLE servo interaction.

For a smart-lock use case, eliminating unauthenticated unlock commands is more important than additional UI refinement.
