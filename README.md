# SmartDoorLock

KiCad 7/8 compatible starter project for a smart door lock based on `STM32F103C8T6` minimum system board, `HC-04` Bluetooth module, `SG90` servo, `18650` boost/charge/protection module, and `CH340` USB-UART debug module.

## Files

- `SmartDoorLock.kicad_pro`: KiCad project file
- `SmartDoorLock.kicad_sch`: schematic source
- `SmartDoorLock.kicad_pcb`: placeholder PCB board

## Module Mapping

### 1. STM32F103C8T6 minimum system board

This project uses a `Conn_01x07` generic 2.54 mm header as the logical replacement for the minimum system board interface.

`J1` pin mapping:

- Pin 1: `3V3`
- Pin 2: `GND`
- Pin 3: `PA2_USART2_TX`
- Pin 4: `PA3_USART2_RX`
- Pin 5: `PWM_SERVO`
- Pin 6: `PA9_USART1_TX`
- Pin 7: `PA10_USART1_RX`

### 2. HC-04 Bluetooth module

`J2` pin mapping:

- Pin 1: `3V3`
- Pin 2: `GND`
- Pin 3: `PA3_USART2_RX`  (HC-04 `TXD` -> STM32 `PA3`)
- Pin 4: `HC04_RXD` through `R1`
- Pin 5: `STATE` left unconnected
- Pin 6: `EN` left unconnected

Series protection resistor:

- `R1 = 1k`
- Connection: `PA2_USART2_TX -> R1 -> HC04_RXD`

### 3. SG90 servo

`J3` pin mapping:

- Pin 1: `5V_SERVO`
- Pin 2: `GND`
- Pin 3: `PWM_SERVO`

Servo supply filtering:

- `C1 = 470uF / 16V` electrolytic, across `5V_SERVO` and `GND`
- `C2 = 0.1uF` ceramic, across `5V_SERVO` and `GND`

### 4. 18650 boost/charge/protection module

`J4` pin mapping:

- Pin 1: `BAT+`
- Pin 2: `BAT-`
- Pin 3: `5V_SERVO` (`OUT+`)
- Pin 4: `GND` (`OUT-`)

Battery connection:

- `J6` is the 18650 battery connector
- `J6` Pin 1: `BAT+`
- `J6` Pin 2: `BAT-`

### 5. CH340 USB-UART debug module

`J5` pin mapping:

- Pin 1: `3V3`
- Pin 2: `GND`
- Pin 3: `PA10_USART1_RX`  (CH340 `TXD` -> STM32 `PA10`)
- Pin 4: `PA9_USART1_TX`   (CH340 `RXD` -> STM32 `PA9`)

## Key Notes

- Servo power is independent from STM32 logic power.
- The servo `5V_SERVO` rail must share the same `GND` with the STM32 system.
- The 18650 battery is shown explicitly on connector `J6` and feeds the boost/charge module `J4` through `BAT+` and `BAT-`.
- `HC-04 RXD` is protected with a `1k` series resistor from `PA2`.
- In the schematic, `STATE` and `EN` on the Bluetooth module are intentionally marked as no-connect.
- The PCB file is currently a placeholder board outline. You can update PCB from schematic and place actual footprints later.
