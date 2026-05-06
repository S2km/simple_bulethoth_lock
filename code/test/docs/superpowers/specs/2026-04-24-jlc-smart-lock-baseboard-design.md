# STM32 Smart Lock Baseboard Design

**Date:** 2026-04-24

**Project:** `C:\Users\S2km\Desktop\bulethoth_lock\code\test`

## Goal

Design a JLCPCB-ready smart-lock baseboard that:

- accepts a plug-in `STM32F103C8T6` minimum system board
- accepts a plug-in `HC-04BLE` module
- powers one `SG90` servo from a dedicated `5V` rail
- uses one removable `18650` cell as the battery source
- supports on-board `USB-C` charging
- keeps all core modules replaceable during prototype iteration

The immediate deliverables for this design phase are:

- a validated hardware design spec
- a schematic partition plan for JLCPCB / EasyEDA
- a BOM structure that separates board-mounted parts from external modules

## Selected Product Direction

This design follows the user-confirmed hardware direction:

- baseboard approach, not a fully integrated MCU board
- on-board charging is required
- `STM32F103C8T6` minimum system board is plug-in replaceable
- `HC-04BLE` module is plug-in replaceable
- battery format is `18650` holder
- actuator is `SG90 / 9g` servo
- charging connector is `USB-C`

## Recommended Architecture

Use one modular baseboard with six clear functional blocks:

1. `USB-C 5V input`
2. `single-cell Li-ion charging and battery path`
3. `5V servo power rail`
4. `3.3V logic rail`
5. `STM32 minimum-system-board socket`
6. `HC-04 / servo / debug connectors`

This approach is preferred over a fully integrated board because it:

- lowers first-board risk
- keeps firmware development on the known Blue Pill style board
- allows rapid replacement of damaged or mismatched modules
- simplifies bring-up, debugging, and future hardware revisioning

## System Power Design

### Power Topology

The board power path is:

```text
USB-C 5V
  -> charging input
  -> single-cell Li-ion charge path
  -> 18650 battery
  -> battery system rail
     -> 5V boost for servo
     -> 3.3V regulator for STM32 board and HC-04BLE
```

### Power Nets

Use the following schematic net names:

- `USB_5V`
- `BAT+`
- `BAT-`
- `SYS_BAT`
- `SERVO_5V`
- `VCC_3V3`
- `GND`

### Rail Responsibilities

- `USB_5V`
  - from the `USB-C` connector
  - used only as charging / external input source
- `SYS_BAT`
  - the single-cell battery system rail
  - feeds the servo boost converter and the 3.3V regulator
- `SERVO_5V`
  - dedicated to the servo power path
  - must not be reused as the main MCU logic rail
- `VCC_3V3`
  - dedicated to the STM32 minimum system board and `HC-04BLE`

### Why Servo and Logic Rails Must Be Split

`SG90` servos can introduce startup current spikes and voltage sag. If the servo shares the same weak rail as the MCU and BLE module, the likely symptoms are:

- servo buzzing
- MCU brownout or reset
- BLE disconnects
- behavior changing depending on whether `ST-Link` is plugged in

The design therefore requires:

- one dedicated `5V` servo rail
- one independent `3.3V` logic rail
- common ground between all subsystems

## Charging and Battery Block

### Battery Format

Use one `18650` battery holder on the baseboard.

### Charging Connector

Use one `USB-C` connector configured as a simple `5V` power input only.

This design does not require USB PD negotiation.

### Charging Strategy

Use a single-cell Li-ion charging circuit suitable for:

- `5V` USB input
- one removable `18650` cell
- prototype-friendly implementation on JLCPCB

The design should also include:

- one battery power switch between the battery system rail and the downstream load path
- charging status indication if supported by the chosen charger implementation

### Recommended Charging Direction

Preferred implementation direction:

- use a mature single-cell charger solution with well-understood external support components
- avoid over-complex power-path management on the first revision unless the selected JLC parts make it easy

For this project stage, reliability and part availability are more important than extreme integration density.

## Servo Power Block

### Requirement

Generate a stable `5V` rail from the single-cell battery rail for one `SG90`.

### Design Rules

- use a dedicated boost converter for `SERVO_5V`
- keep the servo connector physically close to the servo rail output capacitors
- place bulk capacitance near the servo connector

### Required Local Decoupling

At minimum:

- `470uF` to `1000uF` bulk capacitor on `SERVO_5V`
- `0.1uF` ceramic capacitor near the servo connector

### Current Margin Policy

Although the actuator is currently `SG90`, the servo power path should not be sized as a fragile minimum. It should keep enough margin for startup spikes and door-lock mechanical load variation.

The first revision should therefore target a clearly more robust current capability than the no-margin current implied by a bench test.

## Logic Power Block

### Requirement

Generate a stable `3.3V` logic rail from the battery system rail.

### Loads on 3.3V Rail

- `STM32F103C8T6` minimum system board logic side
- `HC-04BLE` module
- status LEDs if used

### Required Local Decoupling

At minimum:

- `10uF + 0.1uF` near the 3.3V regulator output
- `0.1uF` decoupling close to each exposed logic module supply point
- `10uF + 0.1uF` near the `HC-04BLE` connector supply pins

## STM32 Minimum System Board Socket

Use dual female headers so the `STM32F103C8T6` minimum system board can be plugged in and replaced.

### Required Signal Exposure

The baseboard must connect at least these signals:

- `PA8`
  - servo PWM signal
- `PA2`
  - `USART2_TX` to `HC-04BLE RXD`
- `PA3`
  - `USART2_RX` from `HC-04BLE TXD`
- `PA9`
  - `USART1_TX` to external debug serial connector
- `PA10`
  - `USART1_RX` from external debug serial connector
- `3.3V`
- `5V`
- `GND`

### Integration Note

The baseboard should treat the STM32 minimum system board as a plug-in controller module rather than trying to reinterpret all of its internal on-board regulators or jumpers.

## HC-04BLE Connector

Use one replaceable `1x4` connector for the `HC-04BLE` module.

### Pin Definition

1. `VCC_3V3`
2. `GND`
3. `TXD`
4. `RXD`

### Required Wiring

- `HC-04 TXD -> STM32 PA3`
- `HC-04 RXD -> STM32 PA2`

### Supply Rule

This design assumes the BLE module is powered from the `3.3V` logic rail.

## Servo Connector

Use one standard `1x3` servo connector.

### Pin Definition

1. `SERVO_5V`
2. `GND`
3. `PWM_PA8`

### Wiring Rule

- servo signal comes only from `PA8`
- servo power comes only from `SERVO_5V`
- servo ground joins common system ground

## Debug Connector

Use one dedicated `1x4` debug UART connector so the existing `USART1` firmware logs remain available during bring-up.

### Pin Definition

1. `VCC_3V3`
2. `GND`
3. `USART1_TX`
4. `USART1_RX`

This connector is for serial debugging and should remain independent of the BLE control path on `USART2`.

## Optional Status Features

The first schematic revision may include:

- charging status LED
- power LED
- optional labeled test pads for:
  - `SERVO_5V`
  - `VCC_3V3`
  - `GND`
  - `USART1_TX`
  - `USART2_TX`
  - `USART2_RX`

These features are recommended if they do not materially complicate routing.

## Schematic Sheet Partitioning

The JLCPCB / EasyEDA schematic should be partitioned into these logical blocks:

1. `USB-C and charger`
2. `18650 holder and power switch`
3. `5V servo boost`
4. `3.3V logic regulator`
5. `STM32 socket`
6. `HC-04BLE connector`
7. `servo connector`
8. `debug UART connector`
9. `indicators and test pads`

This partitioning is intentional so that:

- the schematic is easier to audit
- future PCB placement can separate noisy and sensitive domains
- BOM review is easier

## PCB Placement Guidance

When the design moves from schematic to PCB:

- place the `USB-C` connector and charger near one board edge
- place the `18650` holder according to mechanical envelope first
- keep the servo power path short and wide
- keep the `SERVO_5V` bulk capacitor close to the servo connector
- keep `HC-04BLE` away from the noisiest boost-switching region where practical
- keep the `STM32` and debug connector accessible for flashing and bring-up

## BOM Strategy

The BOM must be split into two categories.

### 1. Board-Mounted Components

These are mounted on the baseboard itself:

- `USB-C` connector
- charger IC or charger-stage parts
- battery holder
- power switch
- boost converter parts for `SERVO_5V`
- `3.3V` regulator parts
- capacitors
- resistors
- LEDs
- connectors
- headers / sockets / pin headers
- test pads if represented as components

### 2. External / Plug-In Modules

These are not considered baseboard-mounted soldered parts, but must still be listed in the project BOM:

- `STM32F103C8T6` minimum system board
- `HC-04BLE` module
- `SG90` servo
- `18650` battery cell

This separation is required so procurement stays clear during JLCPCB ordering and later assembly.

## BOM Selection Principles

During JLCPCB schematic capture and later BOM generation, choose parts using these rules:

- prioritize JLC stock availability
- prioritize common packages over rare packages
- prefer proven, low-risk power parts for revision 1
- avoid parts that force unnecessary manufacturing complexity
- keep connector pitch and orientation easy to hand-assemble

## Safety and Reliability Notes

This design improves prototype safety compared with a direct BLE-to-servo demo, but it is still a prototype smart-lock controller.

The following constraints apply:

- BLE application-layer authentication is handled in firmware, not in the power circuit
- physical battery reverse insertion protection should be considered during component selection
- the first board is intended for prototype verification, not immediate unattended production deployment

## Out of Scope

The following are not part of this design phase:

- integrating the bare `STM32F103C8T6` directly onto the main PCB
- integrating the BLE radio directly onto the main PCB
- designing the mechanical door-lock structure
- designing the enclosure
- converting this into a production-certified security product

## Deliverables Expected After This Spec

After this design spec is approved, the next implementation phase will produce:

- a concrete JLCPCB / EasyEDA schematic
- a practical board BOM
- connector-level wiring confirmation
- PCB-oriented notes for the first layout pass
