# JLC Smart Lock Baseboard Component Selections

## Design Inputs

- Baseboard only, not fully integrated MCU board
- USB-C charging input
- One removable 18650 cell
- Plug-in STM32F103C8T6 minimum system board
- Plug-in HC-04BLE module
- SG90 servo on dedicated 5V rail

## Selected Functional Blocks

### USB-C Input

- Role: 5V power-only input
- Notes: no USB PD negotiation required
- Connector preference: 16-pin USB-C receptacle wired in 5V sink mode with CC resistors

### Single-Cell Charger

- Role: charge one 18650 from USB_5V
- Selection rule: mature single-cell charger with easy JLC sourcing and simple support components
- First-pass preference: TP4056-class charger implementation if JLC availability is strong

### Battery Holder

- Role: removable 18650 cell holder
- Selection rule: through-hole holder footprint with strong mechanical retention

### Battery Power Switch

- Role: disconnect downstream load from battery path
- Selection rule: simple slide switch or rocker switch suitable for panel-edge access

### Servo 5V Boost

- Role: create SERVO_5V from SYS_BAT
- Selection rule: boost regulator with practical SG90 startup margin
- Output target: 5V

### Logic 3.3V Regulator

- Role: create VCC_3V3 from SYS_BAT
- Selection rule: simple regulator with enough current for STM32 board and HC-04BLE
- Output target: 3.3V

### Connectors

- STM32 socket: dual female headers for Blue Pill style board
- HC-04BLE: 1x4 2.54mm header
- Servo: 1x3 2.54mm header
- Debug UART: 1x4 2.54mm header

## Fixed Nets

- USB_5V
- BAT+
- BAT-
- SYS_BAT
- SERVO_5V
- VCC_3V3
- GND

## Fixed Signal Mapping

- PA8 -> PWM_PA8 -> Servo signal
- PA2 -> USART2_TX -> HC-04 RXD
- PA3 -> USART2_RX -> HC-04 TXD
- PA9 -> USART1_TX -> Debug RX
- PA10 -> USART1_RX -> Debug TX

## Placement Priorities

- USB-C and charger near board edge
- 18650 holder placed from mechanical envelope first
- Servo boost and bulk capacitor close to servo connector
- HC-04 away from the noisiest boost switching region
- STM32 socket and debug header kept accessible
