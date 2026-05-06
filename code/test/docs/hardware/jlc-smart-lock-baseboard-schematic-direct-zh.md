# STM32 智能门锁底板原理图直接绘制指南

## 文档用途

本文件是用于 EasyEDA 的直接绘图指导。

- 项目名称：`stm32-smart-lock-baseboard`
- 板卡类型：仅底板
- 插接模块：
  - `STM32F103C8T6 Blue Pill`
  - `HC-04BLE`
  - `SG90 / 9g servo`
- 电池：`1 x 18650`

## 重要安全说明

本版初稿原理图默认使用 **1 节带保护的 18650 电芯**。

- 如果使用无保护 18650 电芯，请增加独立保护电路。
- 不要从 Blue Pill 的 `5V` 引脚给舵机供电。
- 舵机电源与逻辑电源必须分离。

## 网络名称

请先创建以下网络标签：

- `USB_5V`
- `BAT+`
- `BAT-`
- `SYS_BAT`
- `SERVO_5V`
- `VCC_3V3`
- `GND`
- `PWM_PA8`
- `USART1_TX`
- `USART1_RX`
- `USART2_TX`
- `USART2_RX`

## 模块 1：USB-C 5V 输入

### 器件

- `J1` USB-C 16P 母座，仅供电
- `R1` 5.1k，CC1 下拉
- `R2` 5.1k，CC2 下拉

### 连接方式

- `J1 VBUS -> USB_5V`
- `J1 GND -> GND`
- `J1 CC1 -> R1 -> GND`
- `J1 CC2 -> R2 -> GND`
- `J1 D+`、`D-`、`SBU1`、`SBU2` 保持悬空不接
- 屏蔽外壳可连接到 `GND`

## 模块 2：锂电充电器

### 器件

- `U1` TP4056
- `R3` PROG 电阻，用于设置充电电流
- `C1` 1uF 输入电容
- `C2` 1uF 电池侧电容
- `LED1` 充电状态 LED，可选
- `R4` LED 限流电阻，可选

### 首版推荐参数

- `R3 = 2k`
  - 充电电流约 580mA
  - 相比默认 1A，对很多 18650 电芯更安全
- `C1 = 1uF`
- `C2 = 1uF`
- `R4 = 1k`

### 连接方式

- `U1 VCC -> USB_5V`
- `U1 GND -> GND`
- `U1 BAT -> BAT+`
- `BAT- -> GND`
- `C1` 接在 `USB_5V` 与 `GND` 之间
- `C2` 接在 `BAT+` 与 `GND` 之间
- `R3` 从 `U1 PROG` 接到 `GND`
- `U1 CE` 上拉到 `USB_5V`
- `U1 TEMP` 按所选符号处理
  - 如果所选器件未使用该脚，请按对应符号或数据手册建议连接
- `U1 CHRG` 可通过 `R4` 驱动 `LED1`
- `U1 STDBY` 为可选项，如无需要可不连接

## 模块 3：电池座与电源开关

### 器件

- `BT1` 18650 电池座
- `SW1` 单刀单掷滑动开关

### 连接方式

- `BT1 + -> BAT+`
- `BT1 - -> BAT-`
- `BAT- -> GND`
- `BAT+ -> SW1 input`
- `SW1 output -> SYS_BAT`

## 模块 4：舵机 5V 升压

### 器件

- `U2` MT3608 升压转换器
- `L1` 22uH 电感
- `D1` 肖特基二极管
- `R5`、`R6` 反馈电阻
- `C3` 输入电容
- `C4` 输出电容
- `C5` 舵机大容量储能电容
- `C6` 舵机高频电容

### 首版推荐参数

- `L1 = 22uH`
- `D1 = SS34` 或等效肖特基二极管
- `C3 = 22uF`
- `C4 = 22uF`
- `C5 = 470uF / 10V`
- `C6 = 0.1uF`
- `R5 = 100k`
- `R6 = 24k`
  - 目标输出约为 `5.0V`

### 连接方式

- `SYS_BAT -> U2 VIN`
- `SYS_BAT -> C3 -> GND`
- `U2 GND -> GND`
- `U2 SW` 按 MT3608 参考电路连接 `L1` 和 `D1`
- `U2 FB` 连接到 `R5/R6` 分压网络
- `U2 output -> SERVO_5V`
- `SERVO_5V -> C4 -> GND`
- `SERVO_5V -> C5 -> GND`
- `SERVO_5V -> C6 -> GND`

## 模块 5：3.3V 逻辑稳压

### 器件

- `U3` AMS1117-3.3 或 ME6211-3.3
- `C7` 输入电容
- `C8` 输出储能电容
- `C9` 输出高频电容

### 首版推荐参数

- 如果使用 `AMS1117-3.3`：
  - `C7 = 10uF`
  - `C8 = 10uF`
  - `C9 = 0.1uF`
- 如果使用 `ME6211-3.3`：
  - 按其数据手册或符号要求使用对应电容值

### 连接方式

- `SYS_BAT -> U3 VIN`
- `U3 GND -> GND`
- `U3 VOUT -> VCC_3V3`
- `C7` 接在 `SYS_BAT` 与 `GND` 之间
- `C8` 接在 `VCC_3V3` 与 `GND` 之间
- `C9` 接在 `VCC_3V3` 与 `GND` 之间

## 模块 6：STM32 Blue Pill 插座

### 器件

- `J2` 左侧母排针
- `J3` 右侧母排针

### 必须引出的网络

- `3V3 -> VCC_3V3`
- `GND -> GND`
- `5V`
- `PA8 -> PWM_PA8`
- `PA2 -> USART2_TX`
- `PA3 -> USART2_RX`
- `PA9 -> USART1_TX`
- `PA10 -> USART1_RX`

### 说明

- Blue Pill 排针上的 `5V` 仅在你需要调试便利时才引出。
- **不要**使用 Blue Pill 的 `5V` 给舵机供电。
- 主逻辑供电应为 `VCC_3V3`。

## 模块 7：HC-04BLE 排针

### 器件

- `J4` 1x4 2.54mm 排针
- `C10` 10uF
- `C11` 0.1uF

### 排针引脚顺序

1. `VCC_3V3`
2. `GND`
3. `TXD`
4. `RXD`

### 连接方式

- `J4-1 -> VCC_3V3`
- `J4-2 -> GND`
- `J4-3 (HC-04 TXD) -> USART2_RX -> PA3`
- `J4-4 (HC-04 RXD) -> USART2_TX -> PA2`
- `C10` 接在 `VCC_3V3` 与 `GND` 之间
- `C11` 接在 `VCC_3V3` 与 `GND` 之间

## 模块 8：舵机接口

### 器件

- `J5` 1x3 舵机排针

### 排针引脚顺序

1. `SERVO_5V`
2. `GND`
3. `PWM_PA8`

### 连接方式

- `J5-1 -> SERVO_5V`
- `J5-2 -> GND`
- `J5-3 -> PWM_PA8 -> PA8`

## 模块 9：调试 UART 排针

### 器件

- `J6` 1x4 2.54mm 排针

### 排针引脚顺序

1. `VCC_3V3`
2. `GND`
3. `USART1_TX`
4. `USART1_RX`

### 连接方式

- `J6-1 -> VCC_3V3`
- `J6-2 -> GND`
- `J6-3 -> USART1_TX -> PA9`
- `J6-4 -> USART1_RX -> PA10`

## 整机连接摘要

### 电源路径

- `USB-C VBUS -> USB_5V`
- `USB_5V -> TP4056 VCC`
- `TP4056 BAT -> BAT+`
- `18650 + -> BAT+`
- `18650 - -> GND`
- `BAT+ -> SW1 -> SYS_BAT`
- `SYS_BAT -> U2 boost -> SERVO_5V`
- `SYS_BAT -> U3 LDO -> VCC_3V3`

### 信号路径

- `PA8 -> PWM_PA8 -> J5 舵机信号`
- `PA2 -> USART2_TX -> J4 HC-04 RXD`
- `PA3 -> USART2_RX -> J4 HC-04 TXD`
- `PA9 -> USART1_TX -> J6 调试 RX 侧`
- `PA10 -> USART1_RX -> J6 调试 TX 侧`

## EasyEDA 绘图顺序

请按以下顺序绘制：

1. `USB-C`
2. `TP4056 充电器`
3. `18650 电池座`
4. `电源开关`
5. `MT3608 升压`
6. `3.3V 稳压器`
7. `Blue Pill 排针`
8. `HC-04 排针`
9. `舵机排针`
10. `调试排针`
11. 去耦电容
12. 网络标签

## 必查项目

- `SERVO_5V` 与 `VCC_3V3` 必须是独立网络
- 所有地必须共地
- 舵机不能由 Blue Pill 的 `5V` 供电
- HC-04 必须由 `VCC_3V3` 供电
- `PA2/PA3` 只能连接 BLE 通道
- `PA9/PA10` 只能连接调试通道
- 如果板上没有加入保护 IC，请使用带保护的 18650 电芯
