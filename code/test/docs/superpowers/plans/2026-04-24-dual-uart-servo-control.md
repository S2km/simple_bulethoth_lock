# Dual UART Servo Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both `USART1` and `USART2` accept prefixed angle commands and control the same servo on `PA8/TIM1_CH1` without losing custom code on CubeMX regeneration.

**Architecture:** Keep CubeMX-generated files minimal and place all business logic in the standalone `servo_control` module. Refactor the module so it owns two separate UART receive channels, one for `USART1` and one for `USART2`, while sharing one parser and one PWM output path.

**Tech Stack:** STM32F1 HAL, STM32CubeMX-generated project, Keil MDK project file `MDK-ARM/test.uvprojx`

---

## File Structure

- `Core/Inc/servo_control.h`
  Responsibility: public API for initializing the servo controller with two UARTs and forwarding UART callbacks.
- `Core/Src/servo_control.c`
  Responsibility: dual-UART receive state, prefixed command parsing, servo PWM update, per-UART responses.
- `Core/Src/main.c`
  Responsibility: keep CubeMX-safe hooks only inside `USER CODE` regions.
- `MDK-ARM/test.uvprojx`
  Responsibility: verify `servo_control.c` is still included in the Keil target.

### Task 1: Refactor `servo_control` to support two UART channels

**Files:**
- Modify: `Core/Inc/servo_control.h`
- Modify: `Core/Src/servo_control.c`

- [ ] **Step 1: Write the intended public API change**

Replace the single-UART init declaration with a dual-UART init declaration in `Core/Inc/servo_control.h`:

```c
void ServoControl_Init(UART_HandleTypeDef *huart1,
                       UART_HandleTypeDef *huart2,
                       TIM_HandleTypeDef *htim,
                       uint32_t channel);
```

- [ ] **Step 2: Verify current code does not yet match the new API**

Read:

```powershell
Get-Content Core\Inc\servo_control.h
```

Expected before implementation:

- `ServoControl_Init` still only accepts one `UART_HandleTypeDef *`

- [ ] **Step 3: Introduce one UART state structure and two channel instances**

Implement a focused state structure in `Core/Src/servo_control.c`:

```c
typedef struct
{
  UART_HandleTypeDef *huart;
  uint8_t rxByte;
  char rxBuffer[16];
  char commandBuffer[16];
  volatile uint8_t rxIndex;
  volatile uint8_t commandReady;
  const char *name;
} ServoUartChannel;

static ServoUartChannel servoUart1;
static ServoUartChannel servoUart2;
static TIM_HandleTypeDef *servoTim;
static uint32_t servoTimChannel;
```

- [ ] **Step 4: Implement minimal dual-channel helpers**

Split UART handling by channel instead of using one global receive state:

```c
static ServoUartChannel *ServoControl_FindChannel(UART_HandleTypeDef *huart);
static void ServoControl_StartReception(ServoUartChannel *channel);
static void ServoControl_ProcessChannelCommand(ServoUartChannel *channel);
static void ServoControl_SendText(ServoUartChannel *channel, const char *text);
static uint8_t ServoControl_TryParseAngle(const char *command, uint8_t *angle);
static void ServoControl_SetAngle(uint8_t angle);
```

- [ ] **Step 5: Implement the prefixed command parser**

Accept only `A<angle>` with optional leading or trailing spaces:

```c
while ((*command == ' ') || (*command == '\t'))
{
  command++;
}

if (*command != 'A')
{
  return 0U;
}

command++;
```

Then parse digits and reject anything outside `0` to `180`.

- [ ] **Step 6: Add per-UART startup and reply messages**

Send these after both UART interrupt receptions start:

```c
ServoControl_SendText(&servoUart1, "\r\nUSART1 ready, send A0-A180\r\n");
ServoControl_SendText(&servoUart2, "\r\nUSART2 ready, send A0-A180\r\n");
```

On success:

```c
(void)snprintf(response, sizeof(response), "%s angle=%u\r\n", channel->name, angle);
```

On error:

```c
(void)snprintf(response, sizeof(response), "%s error: send A0-A180\r\n", channel->name);
```

- [ ] **Step 7: Keep servo behavior unchanged except for new command source**

Preserve the PWM compare conversion:

```c
pulse = 50U + ((uint16_t)angle * 200U) / 180U;
__HAL_TIM_SET_COMPARE(servoTim, servoTimChannel, pulse);
```

This keeps the current servo pulse mapping on `TIM1_CH1`.

### Task 2: Update CubeMX-safe hooks in `main.c`

**Files:**
- Modify: `Core/Src/main.c`

- [ ] **Step 1: Verify edits stay inside protected sections**

Read:

```powershell
Get-Content Core\Src\main.c
```

Expected:

- include hook exists in `/* USER CODE BEGIN Includes */`
- init hook exists in `/* USER CODE BEGIN 2 */`
- loop hook exists in `/* USER CODE BEGIN 3 */`
- UART callback hook exists in `/* USER CODE BEGIN 4 */`

- [ ] **Step 2: Update the init call to pass both UART handles**

Inside `/* USER CODE BEGIN 2 */`, use:

```c
if (HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1) != HAL_OK)
{
  Error_Handler();
}

ServoControl_Init(&huart1, &huart2, &htim1, TIM_CHANNEL_1);
```

- [ ] **Step 3: Keep the main loop and UART callback forwarding minimal**

Inside `/* USER CODE BEGIN 3 */`:

```c
ServoControl_Task();
```

Inside `/* USER CODE BEGIN 4 */`:

```c
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
  ServoControl_UartRxCpltCallback(huart);
}

void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
  ServoControl_UartErrorCallback(huart);
}
```

### Task 3: Verify Keil project inclusion and build

**Files:**
- Verify: `MDK-ARM/test.uvprojx`
- Verify output: `MDK-ARM/test/test.build_log.htm`

- [ ] **Step 1: Confirm `servo_control.c` is still part of the MDK target**

Run:

```powershell
Select-String -Path MDK-ARM\test.uvprojx -Pattern "servo_control.c"
```

Expected:

- one match pointing at `..\Core\Src\servo_control.c`

- [ ] **Step 2: Rebuild the project**

Use the same Keil build path already working on this machine. If `UV4.exe` is on `PATH`, run:

```powershell
UV4.exe -b MDK-ARM\test.uvprojx -j0
```

If `UV4.exe` is not on `PATH`, build from the Keil IDE and then inspect the output log file.

Expected:

- build finishes with `0 Error(s), 0 Warning(s)`

- [ ] **Step 3: Check the generated build log**

Run:

```powershell
Get-Content MDK-ARM\test\test.build_log.htm
```

Expected:

- the log contains `0 Error(s), 0 Warning(s)`

### Task 4: Manual serial verification

**Files:**
- No code changes

- [ ] **Step 1: Verify USART1 wired serial control**

Send the following from the serial tool connected to `USART1`:

```text
A90
```

Expected:

- servo rotates toward 90 degrees
- serial reply contains `USART1 angle=90`

- [ ] **Step 2: Verify USART2 HC-04 Bluetooth control**

Send the following from the Bluetooth serial app through `HC-04` on `USART2`:

```text
A45
```

Expected:

- servo rotates toward 45 degrees
- Bluetooth-side reply contains `USART2 angle=45`

- [ ] **Step 3: Verify invalid command isolation**

Send on `USART2`:

```text
90
```

Expected:

- no servo move caused by this invalid command
- Bluetooth-side reply contains `USART2 error: send A0-A180`
- `USART1` still accepts a later valid command like `A135`

## Self-Review

- Spec coverage: the plan covers dual UART support, prefix command format, CubeMX-safe integration, build verification, and manual verification for both ports.
- Placeholder scan: no `TODO`, `TBD`, or vague “handle it later” steps remain.
- Type consistency: the plan uses one new `ServoControl_Init(&huart1, &huart2, &htim1, TIM_CHANNEL_1)` signature consistently across header, source, and `main.c`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-dual-uart-servo-control.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task with review between tasks.
2. Inline Execution - execute tasks in this session with direct edits and verification.

For this workspace, continue with inline execution unless the user explicitly asks to split the work across subagents.
