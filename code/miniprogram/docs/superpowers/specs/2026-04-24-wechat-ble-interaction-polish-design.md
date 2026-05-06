# WeChat BLE Servo Interaction Polish Design

**Date:** 2026-04-24

**Project:** `C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram`

## Goal

Upgrade the BLE servo mini program homepage from a basic debug page into a more polished single-page control cockpit.

The updated page should keep the current debugging usefulness while making daily servo control faster, clearer, and more comfortable on a phone.

## Confirmed UX Direction

The user approved the following interaction direction:

- overall mode: `balanced`
- primary layout style: `A. Cockpit balanced version`
- log behavior: `semi-expanded`
- control emphasis: `dual core`

This means the page should feel like a lightweight control cockpit:

- the upper half focuses on servo control,
- the lower half still preserves clear connection feedback and debugging visibility,
- logs remain available without taking over the page.

## Product Intent

This page is still a **servo debugging and control console**, not a consumer lock UI.

It should help the user do two things at the same time:

1. control the servo quickly,
2. diagnose BLE connection or command issues quickly.

The optimization should improve usability, not replace the current technical capabilities.

## Page Structure

The homepage remains a single page, but it is reorganized into four visual regions.

### 1. Top Status Card

This becomes the quick-glance summary area.

It should show only the most useful immediate status:

- control availability state
- current device name
- current angle
- recent action summary

Examples of recent action summary:

- `recent send A90`
- `reconnect failed`
- `waiting for device`

This area should avoid excessive technical details such as UUIDs in the default view.

### 2. Main Control Area

This is the visual center of the page.

It should contain:

- a large angle display
- a large slider for `0~180`
- preset angle buttons:
  - `0 deg`
  - `45 deg`
  - `90 deg`
  - `135 deg`
  - `180 deg`
- a `send current angle` button
- a `realtime mode` switch

Both the slider and preset buttons must feel primary. This is the approved `dual core` control model.

Expected behavior:

- preset buttons send immediately
- slider updates the displayed angle while dragging
- slider sends on release in default mode
- slider sends throttled updates during drag in realtime mode
- selected or recently sent angle should be visibly highlighted in the UI

### 3. Connection Operations Area

This is a secondary area, still on the homepage but visually below the main control area.

It should include:

- scan button
- disconnect button
- auto reconnect switch
- device list

Behavior rules:

- when connected, this area should look compact and secondary
- when reconnect fails or when no device is connected, this area should become more prominent
- device list visibility can stay inline, but its visual emphasis should drop when the page is already in a controllable state

### 4. Semi-Expanded Log Area

The log area should no longer dominate the page.

By default it should show:

- a status summary line
- the most recent send or receive summary
- 1 to 2 key recent log entries
- an entry point to expand all logs

When expanded, the full recent log list should appear with newest entries first.

## Interaction Model

### Initial Page Flow

1. page loads
2. Bluetooth adapter initializes
3. app attempts automatic reconnect if enabled
4. on reconnect success, page enters controllable state
5. on reconnect failure, page shows waiting-to-connect state and exposes scanning/device selection more clearly

### Control Flow

When the user changes angle by slider or preset:

- the current angle display updates immediately
- the recent action summary updates after send
- the semi-expanded log area shows the latest command result

### Disconnect Flow

When the BLE link is lost or manually disconnected:

- top status card changes to a non-controllable state
- send actions become disabled
- current angle may remain visible as the last known target
- connection operations area expands in importance
- log summary shows disconnect clearly

## Status Design

The page should separate status into two layers.

### Immediate Status Layer

Visible in the top card:

- `controllable`
- `reconnecting`
- `scanning`
- `connect failed`
- `disconnected`

These states are more useful than raw technical words like `connected` alone because they directly tell the user whether action is possible.

### Debug Detail Layer

Visible only in logs or secondary areas:

- service selection details
- characteristic details
- notification setup logs
- reconnect attempts
- low-level BLE errors

This preserves debugging power without crowding the main page.

## Log Strategy

### Default Summary Content

The semi-expanded log section should prioritize only:

- connection events
- send events
- error events

Examples:

- `connected HC-04BLE`
- `sent A135`
- `write failed`

### Full Log Content

The expanded log section may continue to include:

- BLE service discovery logs
- characteristic selection logs
- notify enable logs
- received message logs
- scanning logs

### Ordering

Both summary logs and full logs should use newest-first ordering.

This ensures each new interaction appears at the top without forcing the user to scroll downward to find the latest event.

## Visual Direction

The visual design should be a bright, clean cockpit instead of a generic settings page.

### Overall Tone

- light gray-blue page background
- stronger top status card with blue or blue-green emphasis
- white content cards with clearer hierarchy
- more generous spacing than the current debug page

### Control Priority

The main control region must feel more important than the connection region.

This should be achieved by:

- larger slider region
- larger angle display
- fuller preset button shapes
- clearer distinction for the primary send action

### Button Treatment

Preset buttons should have at least two visual states:

- normal
- selected/recently sent

This gives the interface memory of the current target angle and reduces reliance on logs.

### Slider Treatment

The slider should feel more intentional than the default form look:

- thicker track
- clearer thumb
- visible live angle feedback
- clear realtime mode hint when drag-to-send is active

### Connection Region Behavior

When the page is controllable:

- connection actions remain available but visually secondary

When the page is not controllable:

- connection actions and device discovery become more visually prominent

This is a layout-priority shift, not a page navigation change.

## Component Responsibilities

### `miniprogram/pages/index/index.js`

Own:

- page state
- connection state mapping to user-facing status labels
- summary log derivation
- expanded/collapsed log behavior
- control area visual state derivation
- existing BLE connect/send logic

### `miniprogram/pages/index/index.wxml`

Own:

- top status card layout
- control area layout
- connection operations layout
- semi-expanded log layout

### `miniprogram/pages/index/index.wxss`

Own:

- cockpit visual style
- hierarchy and spacing
- button state appearance
- slider area emphasis
- compact versus expanded area presentation

### `miniprogram/utils/servo_helpers.js`

Keep:

- command formatting
- BLE characteristic selection helpers
- shared UI-friendly helpers if small and clearly reusable

## Error Handling

The page should continue to log technical errors, but user-facing feedback should become clearer.

### User-Facing Error Presentation

If any of these happen:

- Bluetooth unavailable
- reconnect failure
- connection failure
- missing writable characteristic
- write failure
- disconnect during control

Then the page should do both:

1. show a clear immediate status change in the top area or summary area
2. retain the technical detail in the full log list

### Non-Interruptive Success Feedback

Successful sends should not depend on frequent toast popups.

Success should mainly be shown through:

- updated current angle
- updated recent action text
- updated semi-expanded log summary

## Testing And Validation

The updated interaction should be verified against the following checks.

### Control Experience Checks

- slider and preset buttons are both easy to use with one hand
- selected angle is always obvious without opening logs
- current control availability is obvious within one glance

### Connection Visibility Checks

- reconnect success is visible without opening full logs
- reconnect failure clearly surfaces the device list area
- disconnect clearly disables control actions

### Log Usability Checks

- summary area shows the latest meaningful state
- full logs remain available for BLE debugging
- newest event always appears first

### Regression Checks

- scan still works
- manual connect still works
- auto reconnect still works
- send command format remains `A<angle>\n`
- realtime throttling behavior still works
- known HC-04 UUID selection behavior remains unchanged

## Out Of Scope

This interaction polish does not include:

- adding multiple pages
- changing the STM32 command format
- changing BLE protocol behavior
- adding charts, history analytics, or account-like features
- converting the tool into a consumer lock product UI

## Implementation Notes

The work should stay focused on homepage interaction polish.

If a new small helper is needed for summary-state derivation or compact log selection, it is acceptable, but large refactoring is not required unless the page becomes hard to maintain.
