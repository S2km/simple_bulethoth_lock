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
