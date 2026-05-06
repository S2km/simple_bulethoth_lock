# STM32 Dual UART Servo Control Design

**Date:** 2026-04-24

**Project:** `C:\Users\S2km\Desktop\bulethoth_lock\code\test`

## Goal

Make both `USART1` and `USART2` able to control the same servo on `PA8` independently, while keeping all CubeMX-managed files safe from regeneration loss.

## Current Context

- MCU is `STM32F103C8T6`.
- Servo output is already on `TIM1_CH1` / `PA8`.
- `USART1` is already created in CubeMX on `PA9/PA10`.
- `USART2` is already created in CubeMX on `PA2/PA3`.
- Existing custom logic already lives in standalone files:
  - `Core/Inc/servo_control.h`
  - `Core/Src/servo_control.c`
- `main.c` already forwards UART interrupt callbacks inside `USER CODE` regions.

## Requirements

1. `USART1` and `USART2` must both be able to receive commands and control the servo.
2. The two UART receive paths must be written separately in logic, so one UART does not overwrite the other's receive state.
3. Commands must use a prefix format.
4. The servo output remains a single PWM output on `TIM1_CH1`.
5. CubeMX-generated files must only be modified inside `/* USER CODE BEGIN ... */` and `/* USER CODE END ... */`.
6. Business logic should remain in user-owned source files so CubeMX regeneration does not remove it.

## Command Protocol

The command protocol is the same on both UARTs:

- Format: `A<angle>`
- Terminator: `\r`, `\n`, or `\r\n`
- Valid examples:
  - `A0`
  - `A90`
  - `A180`
- Invalid examples:
  - `90`
  - `B90`
  - `A181`
  - `A-1`

Rules:

- Prefix `A` means "set angle".
- Angle range is `0` to `180`.
- Leading and trailing spaces may be ignored around the full command line.
- On invalid input, the UART that sent the command should receive an error message.

## Recommended Architecture

Use one shared `servo_control` module that internally manages two independent UART receive channels.

### Why This Approach

- Keeps the servo logic in one place.
- Avoids duplicated parsing and PWM code.
- Makes CubeMX regeneration safer because `main.c` only keeps lightweight hooks.
- Allows both UARTs to stay active at the same time.

## Module Design

### `servo_control.c/.h`

The module will own:

- Servo PWM target update logic.
- UART receive state for `USART1`.
- UART receive state for `USART2`.
- Command parsing and validation.
- Reply messages for each UART.

The module will not own:

- CubeMX peripheral initialization.
- IRQ handlers themselves.
- Pin configuration.

### Internal UART Channel State

Each UART gets its own state structure with at least:

- UART handle pointer
- one-byte interrupt receive buffer
- line buffer
- parsed command buffer
- current write index
- command-ready flag
- channel name for reply text

This ensures:

- `USART1` data is stored separately from `USART2`
- concurrent use does not corrupt the other UART's command buffer

## Integration Points

### `main.c`

Only minimal changes are allowed, and only inside existing `USER CODE` sections:

- include `servo_control.h`
- initialize servo control with both UART handles and the servo timer handle
- call the polling task from the main loop
- forward UART RX complete callback
- forward UART error callback

### CubeMX Files

No custom logic should be placed outside protected user sections.

## Data Flow

1. System initializes `TIM1`, `USART1`, and `USART2` through CubeMX-generated code.
2. User code starts PWM on `TIM1_CH1`.
3. User code initializes the servo module with:
   - `huart1`
   - `huart2`
   - `htim1`
   - `TIM_CHANNEL_1`
4. The servo module starts interrupt reception on both UARTs.
5. A command like `A135\r\n` arrives on either UART.
6. The matching UART callback stores the received bytes into that UART's own buffer.
7. When line termination is received, that UART marks one command ready.
8. `ServoControl_Task()` processes ready commands one by one.
9. If parsing succeeds, PWM compare is updated for the servo.
10. A success reply is sent only back through the UART that issued the command.
11. If parsing fails, an error reply is sent only on that UART.

## Response Messages

Recommended responses:

- On startup:
  - `USART1 ready, send A0-A180`
  - `USART2 ready, send A0-A180`
- On success:
  - `USART1 angle=90`
  - `USART2 angle=135`
- On error:
  - `USART1 error: send A0-A180`
  - `USART2 error: send A0-A180`

## Error Handling

- If a UART receive buffer overflows, clear only that UART's current line buffer and restart reception on that UART.
- If a UART interrupt receive returns an error, clear only that UART's receive index and restart reception on that UART.
- If angle is out of range, do not move the servo.
- If command prefix is wrong, do not move the servo.

## Testing and Verification

Verification target:

1. Build succeeds with no compile errors.
2. `USART1` can send `A90` and move the servo.
3. `USART2` can send `A45` and move the servo.
4. Sending invalid commands on one UART does not break the other UART.
5. CubeMX regeneration preserves the custom logic because it remains in user-owned files and protected code regions.

## Files Expected To Change

- Modify: `Core/Inc/servo_control.h`
- Modify: `Core/Src/servo_control.c`
- Modify: `Core/Src/main.c`
- Verify project inclusion if needed: `MDK-ARM/test.uvprojx`

## Out of Scope

- Changing servo hardware wiring
- Adding multi-servo support
- Adding AT command configuration for the Bluetooth module
- Changing CubeMX pin assignments

## Notes

- `USART2` is intended for the HC-04 Bluetooth module on `PA2/PA3`.
- `USART1` can remain available for wired serial debugging and control.
- The latest valid command wins because there is only one physical servo output.
