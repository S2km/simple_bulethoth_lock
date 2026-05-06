# Smart Lock KiCAD Schematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a KiCAD-format schematic for the smart-lock baseboard that matches the project’s confirmed UPS-module power architecture.

**Architecture:** Use the existing hardware docs as the source of truth, normalize them to the confirmed UPS-module-on-board design, and generate one single-sheet `.kicad_sch` with custom embedded symbols for the UPS module, Blue Pill used pins, HC-04 header, servo header, debug header, LDO, and required passives. Keep the output self-contained so it can open without a custom symbol library.

**Tech Stack:** KiCAD schematic S-expression format, Python 3 for deterministic file generation, Markdown for implementation notes.

---

### Task 1: Confirm source-of-truth hardware constraints

**Files:**
- Read: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\docs\hardware\jlc-smart-lock-baseboard-schematic-ups-module-zh.md`
- Read: `C:\Users\S2km\Desktop\bulethoth_lock\code\test\docs\superpowers\specs\2026-04-24-jlc-smart-lock-baseboard-design.md`
- Read: `C:\Users\S2km\Desktop\bulethoth_lock\docs\hardware\2026-04-25-smart-lock-bluepill-hc04-schematic-bom.md`

- [ ] **Step 1: Lock the chosen architecture**

Use these exact rules:

```text
UPS module is mounted on the same PCB as a daughter module.
UPS module chosen output is 5V.
Servo is powered directly from the 5V rail after the main switch.
Blue Pill and HC-04 are powered from a dedicated 3.3V LDO.
Blue Pill 5V pin is not driven in this revision.
HC-04 is powered from 3.3V and uses PA2/PA3.
Debug UART uses PA9/PA10.
```

- [ ] **Step 2: Normalize the final net names**

Use these final net names in the KiCAD schematic:

```text
PWR_5V_IN
VCC_3V3
GND
SERVO_PWM
BLE_TX
BLE_RX
DBG_TX
DBG_RX
BAT+
```

### Task 2: Define output file structure

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\hardware\kicad\smart_lock_baseboard.kicad_sch`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\hardware\kicad\README.md`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\tools\generate_smart_lock_kicad.py`

- [ ] **Step 1: Use one self-contained sheet**

Output one KiCAD schematic file with embedded custom symbols for:

```text
UPS_5V_Module
Battery_18650
LDO_3V3
BluePill_UsedPins
HC04_Header
Servo_Header
Debug_UART_Header
SW_SPST
R
C
CP
```

- [ ] **Step 2: Keep the sheet self-contained**

Do not require an external custom symbol library. Put symbol definitions into the `.kicad_sch` `lib_symbols` section so the file is portable.

### Task 3: Generate the KiCAD schematic

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\tools\generate_smart_lock_kicad.py`
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\hardware\kicad\smart_lock_baseboard.kicad_sch`

- [ ] **Step 1: Encode the final electrical connectivity**

Generate a single-sheet schematic that includes these exact connections:

```text
BT1 + -> BAT+ -> U1 BAT+
BT1 - -> GND -> U1 BAT-
U1 OUT+ -> SW1 -> PWR_5V_IN
U1 OUT- -> GND
PWR_5V_IN -> J4 servo V+
PWR_5V_IN -> C1 470uF -> GND
PWR_5V_IN -> C2 0.1uF -> GND
PWR_5V_IN -> U2 IN
U2 OUT -> VCC_3V3
U2 GND -> GND
VCC_3V3 -> C4 10uF -> GND
VCC_3V3 -> C5 0.1uF -> GND
VCC_3V3 -> C6 10uF -> GND
VCC_3V3 -> C7 0.1uF -> GND
VCC_3V3 -> Blue Pill 3V3 pins
GND -> Blue Pill GND pins
PA8 -> R1 220R -> SERVO_PWM -> J4 signal
PA2 -> BLE_TX -> J3 RXD
PA3 -> BLE_RX -> J3 TXD
PA9 -> DBG_TX -> J5 TX
PA10 -> DBG_RX -> J5 RX
J3 VCC -> VCC_3V3
J3 GND -> GND
J5 VCC -> VCC_3V3
J5 GND -> GND
```

- [ ] **Step 2: Add visible notes**

Include visible text notes in the sheet that say:

```text
Blue Pill is powered from external 3.3V only in this revision.
Do not drive the Blue Pill 5V pin.
UPS module footprint/pad geometry must be confirmed from the real module before PCB layout.
```

### Task 4: Add usage documentation

**Files:**
- Create: `C:\Users\S2km\Desktop\bulethoth_lock\hardware\kicad\README.md`

- [ ] **Step 1: Document what was generated**

The README must say:

```text
Which docs were used as the source of truth.
That the output is a single-sheet KiCAD schematic.
That the UPS daughter-module mechanical footprint is still a placeholder at the schematic level.
That Blue Pill is represented by a simplified used-pins symbol electrically, while the PCB should still use dual 1x20 sockets.
```

### Task 5: Perform non-visual verification

**Files:**
- Run against: `C:\Users\S2km\Desktop\bulethoth_lock\hardware\kicad\smart_lock_baseboard.kicad_sch`

- [ ] **Step 1: Run the generator script**

Run:

```powershell
python C:\Users\S2km\Desktop\bulethoth_lock\tools\generate_smart_lock_kicad.py
```

Expected:

```text
Creates or overwrites smart_lock_baseboard.kicad_sch
Prints the output path
```

- [ ] **Step 2: Run a basic structural check**

Run:

```powershell
@'
from pathlib import Path
text = Path(r"C:\Users\S2km\Desktop\bulethoth_lock\hardware\kicad\smart_lock_baseboard.kicad_sch").read_text(encoding="utf-8")
print("paren_balance=", text.count("(") - text.count(")"))
for token in ["PWR_5V_IN", "VCC_3V3", "SERVO_PWM", "BLE_TX", "BLE_RX", "DBG_TX", "DBG_RX"]:
    print(token, token in text)
'@ | python -
```

Expected:

```text
paren_balance= 0
All required net labels reported as True
```
