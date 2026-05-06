# WeChat BLE Servo Debug Mini Program Design

**Date:** 2026-04-24

**Project:** `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram`

## Goal

Build a WeChat Mini Program page that connects to the `HC-04BLE` Bluetooth module and controls the STM32 servo by sending prefixed angle commands.

## Current Context

- The STM32 side is already able to receive Bluetooth angle commands on `USART2`.
- The accepted command format is `A<angle>` with line ending, for example:
  - `A0`
  - `A90`
  - `A180`
- The current mini program project is still the default WeChat starter template.
- The current project has no BLE scan, connect, notify, or write logic yet.
- The current project has no UI component dependencies and should stay lightweight.

## Product Intent

This mini program is a **servo debugging tool**, not a door-lock style product UI.

The page should help the user:

1. discover or reconnect to the BLE module,
2. send target angles quickly,
3. see connection state clearly,
4. inspect recent send and receive logs when debugging.

## Primary UX Direction

Use a **single-page debug console** with clear visual separation:

- top: Bluetooth connection area
- middle: servo control area
- bottom: log area

This is preferred over a multi-page flow because it is faster for debugging and makes BLE problems easier to distinguish from servo command problems.

## Page Layout

### 1. Bluetooth Connection Area

This area should show:

- whether the Bluetooth adapter is available,
- whether the app is scanning,
- whether the app is connected,
- the current connected device name,
- whether auto reconnect is enabled,
- a button to scan,
- a button to disconnect,
- a selectable device list when scanning or when auto reconnect fails.

Behavior:

- on page load, try to initialize Bluetooth first,
- then try to reconnect to the previously successful device,
- if reconnect fails, fall back to scan mode,
- the device list should allow manual selection and connection.

### 2. Servo Control Area

This area should show:

- current angle value,
- a `0~180` slider,
- preset buttons for:
  - `0 deg`
  - `45 deg`
  - `90 deg`
  - `135 deg`
  - `180 deg`
- a `realtime mode` switch,
- a `send current angle` button.

Behavior:

- preset buttons send immediately,
- slider default behavior is **send only when the user releases the slider**,
- if `realtime mode` is enabled, slider movement sends throttled updates,
- the command format sent to BLE is `A<angle>\n`.

### 3. Log Area

This area should show recent records such as:

- Bluetooth adapter open success or failure,
- reconnect success or failure,
- scan results,
- manual connect success or failure,
- sent commands,
- received BLE notifications or textual responses,
- write failures.

The log is important for debugging and should remain visible on the page instead of being hidden behind another page.

## BLE Connection Strategy

The preferred BLE strategy is:

1. open Bluetooth adapter,
2. read last successful `deviceId` from local storage,
3. if present, attempt automatic reconnect,
4. if reconnect succeeds, continue into service and characteristic discovery,
5. if reconnect fails, begin device discovery and show the list,
6. when the user taps a discovered device, connect to it manually,
7. after successful connection, save the `deviceId` for next time.

This gives the user the convenience of auto reconnect while still keeping the manual scan-and-select path available.

## BLE Discovery Requirements

The mini program must support:

- `wx.openBluetoothAdapter`
- `wx.startBluetoothDevicesDiscovery`
- `wx.onBluetoothDeviceFound`
- `wx.createBLEConnection`
- `wx.getBLEDeviceServices`
- `wx.getBLEDeviceCharacteristics`
- `wx.notifyBLECharacteristicValueChange`
- `wx.writeBLECharacteristicValue`

The implementation should discover and store:

- `deviceId`
- `deviceName`
- `serviceId`
- writable characteristic id
- notifiable characteristic id

If the device connects but no writable characteristic is found, the UI should clearly log that state.

## Command Rules

The mini program sends only one command family in this phase:

- set servo angle with prefix `A`

Examples:

- `A0\n`
- `A45\n`
- `A90\n`
- `A180\n`

Rules:

- angles must stay in the range `0~180`,
- slider values should be integer values,
- displayed angle and transmitted angle should match.

## Realtime Mode

The mini program supports two send modes:

### Default Mode

- user drags slider,
- command is sent only on release,
- this is the safe default because it reduces BLE traffic and is more stable.

### Realtime Mode

- user drags slider,
- app sends angle updates while moving,
- sends must be throttled to avoid flooding BLE writes.

Realtime mode is optional at runtime and should be controlled by a visible switch.

## Recommended State Model

The page state should include at least:

- `adapterReady`
- `isScanning`
- `isConnected`
- `autoReconnect`
- `deviceList`
- `deviceId`
- `deviceName`
- `serviceId`
- `writeCharacteristicId`
- `notifyCharacteristicId`
- `currentAngle`
- `realtimeMode`
- `logs`

## Recommended File Responsibilities

### `miniprogram/pages/index/index.js`

Own:

- page state,
- BLE initialization,
- reconnect flow,
- scan flow,
- connect flow,
- characteristic discovery,
- notification handling,
- servo command sending,
- log updates.

### `miniprogram/pages/index/index.wxml`

Own:

- Bluetooth section layout,
- servo section layout,
- log section layout.

### `miniprogram/pages/index/index.wxss`

Own:

- page styling,
- spacing and grouping,
- debug-console look and readability.

### Optional `miniprogram/utils/ble.js`

If the page logic becomes too crowded, BLE operations may be extracted into a small helper module.

This extraction is optional and should only be done if it improves clarity without overcomplicating the starter project.

## Error Handling

The UI should explicitly handle and log:

- Bluetooth adapter unavailable,
- Bluetooth not enabled on the phone,
- reconnect failure,
- scan failure,
- connection failure,
- missing BLE service,
- missing writable characteristic,
- missing notify characteristic,
- write failure,
- unexpected device disconnect.

Behavior:

- auto reconnect failure should not block the user,
- the app should automatically return to scan mode,
- failed writes should not silently disappear.

## Validation Goals

The finished mini program should allow the user to verify all of the following:

1. the page can discover `HC-04BLE`,
2. the page can manually connect to `HC-04BLE`,
3. after a successful manual connection, the next visit can auto reconnect,
4. tapping `90 deg` sends `A90\n`,
5. releasing the slider sends the selected angle,
6. enabling `realtime mode` allows throttled live updates while dragging,
7. logs show both sent commands and received device feedback.

## Out of Scope

This phase does not include:

- a finished smart lock product UI,
- user account features,
- multi-page device management,
- multiple servo support,
- firmware-side protocol changes beyond the current `A<angle>` format.

## Notes

- The STM32 side already uses a simple prefixed UART/BLE command format, so the mini program should match that exactly.
- The current priority is debug speed and reliability, not product polish.
- The design intentionally keeps everything on one screen to reduce confusion during Bluetooth debugging.
