# bulethoth_lock

基于 `STM32F103C8T6 + HC-04 BLE + SG90 舵机 + 微信小程序` 的智能门锁原型项目。仓库同时包含：

- KiCad 硬件设计文件
- STM32 固件工程
- 微信小程序控制端
- 设计说明、实施计划和硬件文档

这是一个本地蓝牙控制方案，重点在门锁原型、固件安全加固、手机侧交互和硬件接线验证，不包含云端服务或互联网远程开锁。

## 项目结构

```text
.
├─ SmartDoorLock.kicad_pro / .kicad_sch / .kicad_pcb
├─ code
│  ├─ test                # STM32 固件工程（Keil / CubeMX）
│  └─ miniprogram         # 微信小程序工程与测试
├─ docs
│  ├─ hardware            # 硬件说明、接线、BOM
│  └─ superpowers         # 设计稿与实施计划
├─ _ref_STM32CubeF1       # STM32CubeF1 参考库
└─ 资料                   # HC-04 相关原始资料和参考包
```

## 主要模块

### 硬件

- 主控：`STM32F103C8T6`
- 蓝牙：`HC-04`
- 执行器：`SG90` 舵机
- 供电：`18650 + 升压/充电/保护模块`
- 调试串口：`CH340 USB-UART`

### 固件

固件目录：

- [code/test](C:\Users\S2km\Desktop\bulethoth_lock\code\test)

主要入口文件：

- [main.c](C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\main.c)
- [servo_control.c](C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c)
- [lock_config.c](C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c)
- [test.uvprojx](C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx)

当前固件侧包含的核心能力：

- 舵机锁定 / 解锁控制
- 自动回锁
- PIN 认证
- 首次初始化 `PINSET INIT <newPin>`
- 可信手机绑定 / 解绑 / 列表查询
- 状态查询 `STATUS`
- 基于 challenge + MAC 的会话证明
- 上电默认锁定
- 本地配置持久化

### 微信小程序

小程序目录：

- [code/miniprogram](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram)

主要文件：

- [app.json](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\app.json)
- [lock_runtime.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\lock_runtime.js)
- [home.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.js)
- [settings.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.js)

当前小程序侧包含的核心能力：

- BLE 扫描、连接、断开
- 首页 / 设置页双标签结构
- PIN 认证与状态同步
- 自动重连与本地锁配置
- 可信手机绑定与同步
- RSSI 近距离自动开锁逻辑
- 配置回执驱动的状态更新

## 硬件连接摘要

### STM32 最小系统板

`J1` 引脚：

- `3V3`
- `GND`
- `PA2_USART2_TX`
- `PA3_USART2_RX`
- `PWM_SERVO`
- `PA9_USART1_TX`
- `PA10_USART1_RX`

### HC-04

`J2` 引脚：

- `3V3`
- `GND`
- `PA3_USART2_RX`（HC-04 `TXD` -> STM32 `PA3`）
- `HC04_RXD`（经 `R1 = 1k` 串联保护）
- `STATE` 未连接
- `EN` 未连接

### 舵机与供电

- 舵机电源使用独立 `5V_SERVO`
- 逻辑地和舵机地必须共地
- `C1 = 470uF / 16V`
- `C2 = 0.1uF`

## 推荐打开方式

### 硬件

用 KiCad 7/8 打开：

- [SmartDoorLock.kicad_pro](C:\Users\S2km\Desktop\bulethoth_lock\SmartDoorLock.kicad_pro)

### 固件

用 Keil MDK 打开：

- [test.uvprojx](C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx)

### 微信小程序

用微信开发者工具打开：

- [code/miniprogram](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram)

## 本地验证

### 小程序测试

仓库里已经有基于 Node 内置测试器的测试文件：

- [lock_runtime.test.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\lock_runtime.test.js)
- [servo_helpers.test.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js)
- [proximity_helpers.test.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js)

可用命令示例：

```powershell
node --test C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\lock_runtime.test.js
node --test C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\servo_helpers.test.js
node --test C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\tests\proximity_helpers.test.js
```

### 固件验证

固件更适合通过以下方式验证：

- Keil 编译通过
- 串口命令收发正常
- 上电默认锁定
- 自动回锁正常
- 首次 PIN 初始化、PIN 修改、可信手机绑定可复现

## 关键文档

- [Smart Lock Commercial BLE Design](C:\Users\S2km\Desktop\bulethoth_lock\docs\superpowers\specs\2026-05-02-smart-lock-commercial-ble-design.md)
- [Smart Lock UI, Power, and Security Hardening Design](C:\Users\S2km\Desktop\bulethoth_lock\docs\superpowers\specs\2026-05-03-smart-lock-ui-power-security-design.md)
- [接线与 BOM 文档](C:\Users\S2km\Desktop\bulethoth_lock\docs\hardware\2026-04-25-smart-lock-bluepill-hc04-schematic-bom.md)

## 当前状态

项目当前更接近“可验证的产品原型”，而不是量产方案。已经覆盖：

- 本地 BLE 控制链路
- 固件状态机与持久化
- 小程序交互和自动化逻辑
- 基础安全加固

仍然值得继续加强的方向包括：

- 更强的设备身份与密钥管理
- 更完整的量产级低功耗策略
- 更严格的通信安全与重放防护
- 更系统的硬件联调与整机测试记录
