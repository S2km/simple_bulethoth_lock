# JLC Smart Lock Baseboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a JLCPCB / EasyEDA-ready smart-lock baseboard schematic and a matching BOM for the confirmed modular prototype hardware.

**Architecture:** Keep the hardware work split into three deliverables: a concrete component-selection note, a machine-readable BOM source file, and the EasyEDA schematic itself. Use the approved spec as the single source of truth for power topology, connector mapping, and module boundaries, then validate the schematic back against the spec before exporting the BOM.

**Tech Stack:** Markdown docs in this workspace, CSV BOM source, JLCPCB / EasyEDA in browser, PowerShell for local verification

---

## File Structure

- Create: `docs/hardware/jlc-smart-lock-baseboard-bom.csv`
  Responsibility: source BOM table for board-mounted parts and external plug-in modules.
- Create: `docs/hardware/jlc-smart-lock-baseboard-components.md`
  Responsibility: concrete selected parts, package choices, electrical role, and JLC sourcing notes.
- Create: `docs/hardware/jlc-smart-lock-baseboard-checklist.md`
  Responsibility: schematic cross-check list used during EasyEDA capture and final review.
- Create or update in browser only: `JLCPCB / EasyEDA schematic project`
  Responsibility: actual schematic capture for USB-C charging, battery, 5V servo rail, 3.3V logic rail, STM32 socket, HC-04 connector, servo connector, and debug connector.
- Reference: `docs/superpowers/specs/2026-04-24-jlc-smart-lock-baseboard-design.md`
  Responsibility: approved source spec for the baseboard design.

## Execution Notes

- This workspace is not currently a git repository, so do not add commit steps during execution.
- Save each local artifact before browser capture begins so browser work has a stable source of truth.
- Prefer JLC common stock parts where possible.
- If a selected JLC part becomes unavailable during schematic capture, update both the component note and the BOM source immediately before continuing.

### Task 1: Create the Concrete Component Selection Note

**Files:**
- Reference: `docs/superpowers/specs/2026-04-24-jlc-smart-lock-baseboard-design.md`
- Create: `docs/hardware/jlc-smart-lock-baseboard-components.md`

- [ ] **Step 1: Create the hardware docs directory if it does not already exist**

Run:

```powershell
New-Item -ItemType Directory -Force docs\hardware
```

Expected: the `docs\hardware` directory exists.

- [ ] **Step 2: Write the component-selection note with fixed sections**

Write `docs/hardware/jlc-smart-lock-baseboard-components.md` with this content:

```md
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
```

- [ ] **Step 3: Verify the component-selection note was written correctly**

Run:

```powershell
Get-Content docs\hardware\jlc-smart-lock-baseboard-components.md
```

Expected: the file contains all six functional blocks, fixed nets, and the PA8 / PA2 / PA3 / PA9 / PA10 signal mapping.

### Task 2: Create the BOM Source File

**Files:**
- Reference: `docs/hardware/jlc-smart-lock-baseboard-components.md`
- Create: `docs/hardware/jlc-smart-lock-baseboard-bom.csv`

- [ ] **Step 1: Write the BOM CSV with both board-mounted parts and external modules**

Write `docs/hardware/jlc-smart-lock-baseboard-bom.csv` with this exact header and starter rows:

```csv
Category,Designator,Item,Function,Preferred Spec,Package/Format,Qty,Assembly Scope,Notes
Board-Mounted,J1,USB-C Receptacle,USB 5V input,USB-C 5V sink only,SMT,1,JLC Assembly,"Use 5V-only wiring, no PD"
Board-Mounted,U1,Li-ion Charger IC,Charge single 18650 from USB_5V,Single-cell 5V-input charger,SMT,1,JLC Assembly,Prefer common JLC stock
Board-Mounted,BT1,18650 Holder,Main battery holder,Single-cell 18650,Through-hole,1,Manual Assembly,Mechanical part
Board-Mounted,SW1,Power Switch,Battery/load disconnect,SPST,Through-hole or SMT,1,Manual Assembly,Accessible from board edge
Board-Mounted,U2,5V Boost Regulator,Generate SERVO_5V,5V output boost converter,SMT,1,JLC Assembly,Size with SG90 startup margin
Board-Mounted,U3,3.3V Regulator,Generate VCC_3V3,3.3V regulator,SMT,1,JLC Assembly,Feeds STM32 board and HC-04
Board-Mounted,C_SERVO_BULK,Electrolytic Capacitor,Servo bulk storage,470uF to 1000uF,Through-hole or SMT,1,JLC/Manual Mixed,Place near servo connector
Board-Mounted,C_SERVO_HF,Ceramic Capacitor,Servo local high-frequency decoupling,0.1uF,SMT,1,JLC Assembly,Place near servo connector
Board-Mounted,C_3V3_BULK,Ceramic Capacitor,3.3V bulk decoupling,10uF,SMT,1,JLC Assembly,Place near U3 output
Board-Mounted,C_3V3_HF,Ceramic Capacitor,3.3V high-frequency decoupling,0.1uF,SMT,1,JLC Assembly,Place near U3 output
Board-Mounted,J2,STM32 Socket Left,Blue Pill socket,Dual female header 2.54mm,Through-hole,1,Manual Assembly,For plug-in MCU board
Board-Mounted,J3,STM32 Socket Right,Blue Pill socket,Dual female header 2.54mm,Through-hole,1,Manual Assembly,For plug-in MCU board
Board-Mounted,J4,HC-04 Header,HC-04BLE connector,1x4 2.54mm,Through-hole,1,Manual Assembly,VCC_3V3/GND/TXD/RXD
Board-Mounted,J5,Servo Header,Servo connector,1x3 2.54mm,Through-hole,1,Manual Assembly,SERVO_5V/GND/PWM_PA8
Board-Mounted,J6,Debug UART Header,USART1 debug connector,1x4 2.54mm,Through-hole,1,Manual Assembly,VCC_3V3/GND/TX/RX
Board-Mounted,LED1,Charge/Power LED,Status indication,0603 or 0805 LED,SMT,1,JLC Assembly,Optional if routing allows
External Module,M1,STM32F103C8T6 Minimum System Board,Plug-in controller board,Blue Pill style module,Module,1,External,User-supplied module
External Module,M2,HC-04BLE Module,Plug-in BLE serial module,HC-04BLE,Module,1,External,User-supplied module
External Module,M3,SG90 Servo,Lock actuator,SG90 9g servo,Module,1,External,User-supplied actuator
External Module,M4,18650 Cell,Main battery,Single-cell Li-ion 18650,Cell,1,External,User-supplied battery
```

- [ ] **Step 2: Verify the BOM file can be read back and the two BOM categories exist**

Run:

```powershell
Get-Content docs\hardware\jlc-smart-lock-baseboard-bom.csv
```

Expected: the file begins with the CSV header and contains rows for both `Board-Mounted` and `External Module`.

- [ ] **Step 3: Spot-check the BOM schema with PowerShell CSV parsing**

Run:

```powershell
Import-Csv docs\hardware\jlc-smart-lock-baseboard-bom.csv | Select-Object -First 5
```

Expected: PowerShell parses the CSV without errors and shows objects with the properties `Category`, `Designator`, `Item`, `Function`, `Preferred Spec`, `Package/Format`, `Qty`, `Assembly Scope`, and `Notes`.

### Task 3: Create the Schematic Capture Checklist

**Files:**
- Reference: `docs/superpowers/specs/2026-04-24-jlc-smart-lock-baseboard-design.md`
- Create: `docs/hardware/jlc-smart-lock-baseboard-checklist.md`

- [ ] **Step 1: Write the checklist used during EasyEDA capture**

Write `docs/hardware/jlc-smart-lock-baseboard-checklist.md` with this content:

```md
# JLC Smart Lock Baseboard Schematic Checklist

## Functional Blocks

- [ ] USB-C 5V input present
- [ ] Single-cell charger present
- [ ] 18650 holder present
- [ ] Battery power switch present
- [ ] 5V servo boost present
- [ ] 3.3V logic regulator present
- [ ] STM32 socket present
- [ ] HC-04BLE connector present
- [ ] Servo connector present
- [ ] Debug UART connector present

## Net Checks

- [ ] USB_5V named and used only for input/charging path
- [ ] BAT+ and BAT- connected to battery holder
- [ ] SYS_BAT feeds both U2 and U3 inputs
- [ ] SERVO_5V feeds only servo power path
- [ ] VCC_3V3 feeds STM32 logic side and HC-04BLE
- [ ] GND common across all blocks

## Signal Checks

- [ ] PA8 routes to PWM_PA8 and servo connector signal pin
- [ ] PA2 routes to HC-04 RXD
- [ ] PA3 routes to HC-04 TXD
- [ ] PA9 routes to debug header RX side
- [ ] PA10 routes to debug header TX side

## Decoupling Checks

- [ ] 470uF to 1000uF capacitor near servo connector
- [ ] 0.1uF near servo connector
- [ ] 10uF and 0.1uF near 3.3V regulator output
- [ ] 10uF and 0.1uF near HC-04 connector supply pins

## Review Checks

- [ ] No direct servo power from STM32 board 5V pin
- [ ] HC-04 powered from 3.3V rail
- [ ] Debug connector remains independent of HC-04 path
- [ ] Optional LEDs/test pads only if routing remains simple
```

- [ ] **Step 2: Verify the checklist file content**

Run:

```powershell
Get-Content docs\hardware\jlc-smart-lock-baseboard-checklist.md
```

Expected: the checklist contains block checks, net checks, signal checks, decoupling checks, and review checks.

### Task 4: Capture the Schematic in JLCPCB / EasyEDA

**Files:**
- Reference: `docs/superpowers/specs/2026-04-24-jlc-smart-lock-baseboard-design.md`
- Reference: `docs/hardware/jlc-smart-lock-baseboard-components.md`
- Reference: `docs/hardware/jlc-smart-lock-baseboard-bom.csv`
- Reference: `docs/hardware/jlc-smart-lock-baseboard-checklist.md`
- Create or update in browser: `JLCPCB / EasyEDA schematic project`

- [ ] **Step 1: Confirm browser access and JLC login state before editing**

Manual/browser action:

```text
Open JLCPCB / EasyEDA in the browser and confirm the user session can create or edit a schematic project.
```

Expected: the browser can access the schematic editor without a login blocker.

- [ ] **Step 2: Create a new schematic project named for this board**

Manual/browser action:

```text
Create a new EasyEDA project named "stm32-smart-lock-baseboard".
```

Expected: a new blank schematic project exists.

- [ ] **Step 3: Capture the USB-C, charger, battery holder, and power switch block first**

Manual/browser action:

```text
Place J1, U1, BT1, and SW1. Name the rails USB_5V, BAT+, BAT-, and SYS_BAT. Wire USB-C 5V into the charger, charger into the battery path, and battery path through the power switch into SYS_BAT.
```

Expected: the battery input side of the schematic is complete and clearly named.

- [ ] **Step 4: Capture the 5V servo power block**

Manual/browser action:

```text
Place U2 and the servo power capacitors. Wire SYS_BAT into U2 input and name the output SERVO_5V. Place J5 and wire SERVO_5V, GND, and PWM_PA8 to the connector.
```

Expected: the servo connector is fully powered from SERVO_5V and not from the STM32 board power pins.

- [ ] **Step 5: Capture the 3.3V logic power block**

Manual/browser action:

```text
Place U3 and its output capacitors. Wire SYS_BAT into U3 input and name the output VCC_3V3.
```

Expected: the 3.3V logic rail exists independently of the servo rail.

- [ ] **Step 6: Capture the STM32 socket and its required signals**

Manual/browser action:

```text
Place J2 and J3 for the Blue Pill socket. Label or wire the exposed pins so PA8, PA2, PA3, PA9, PA10, 3.3V, 5V, and GND are accessible in the schematic.
```

Expected: the MCU module connection points are visible and match the approved signal map.

- [ ] **Step 7: Capture the HC-04BLE and debug headers**

Manual/browser action:

```text
Place J4 and J6. Wire HC-04 TXD to PA3, HC-04 RXD to PA2, debug TX/RX to PA9/PA10, and power the HC-04 from VCC_3V3.
```

Expected: BLE and debug serial paths are both present and independent.

- [ ] **Step 8: Add optional LEDs or test pads only if the schematic remains clean**

Manual/browser action:

```text
If the sheet remains readable, add one status LED and the planned test pads for SERVO_5V, VCC_3V3, GND, USART1_TX, USART2_TX, and USART2_RX.
```

Expected: optional indicators improve bring-up without cluttering the core schematic.

### Task 5: Validate the Schematic and Export BOM

**Files:**
- Reference: `docs/hardware/jlc-smart-lock-baseboard-checklist.md`
- Update in browser: `JLCPCB / EasyEDA schematic project`
- Export from browser: `BOM from EasyEDA`

- [ ] **Step 1: Walk the checklist line by line against the finished schematic**

Manual/browser action:

```text
Open docs/hardware/jlc-smart-lock-baseboard-checklist.md locally and compare every checkbox item against the EasyEDA schematic before export.
```

Expected: every checklist item is satisfied or intentionally omitted with a documented reason.

- [ ] **Step 2: Run EasyEDA electrical or annotation checks**

Manual/browser action:

```text
Use EasyEDA's annotation / ERC tools to catch unconnected nets, naming mistakes, or duplicate references.
```

Expected: no unresolved wiring or reference-designator errors remain.

- [ ] **Step 3: Export the EasyEDA BOM and compare it to the local BOM source**

Manual/browser action:

```text
Export the EasyEDA BOM and compare its designators and quantities against docs/hardware/jlc-smart-lock-baseboard-bom.csv.
```

Expected: board-mounted parts in the exported BOM match the local BOM source or any differences are reconciled back into the local CSV.

- [ ] **Step 4: Save final screenshots or a PDF of the schematic for review**

Manual/browser action:

```text
Export or capture the finished schematic as reviewable output before moving to PCB layout.
```

Expected: there is a static artifact that can be reviewed without reopening the editor.

## Self-Review

- Spec coverage:
  - Power topology is covered by Tasks 1, 2, and 4.
  - Connector mapping is covered by Tasks 1, 3, and 4.
  - BOM split is covered by Task 2 and Task 5.
  - JLC capture workflow is covered by Task 4 and Task 5.
- Placeholder scan:
  - No `TODO`, `TBD`, or deferred “implement later” instructions are left in the plan.
- Type consistency:
  - Net names and signal names are consistent with the approved spec: `USB_5V`, `BAT+`, `BAT-`, `SYS_BAT`, `SERVO_5V`, `VCC_3V3`, `GND`, `PA8`, `PA2`, `PA3`, `PA9`, `PA10`.

