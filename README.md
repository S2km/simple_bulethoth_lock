# simple_bluethoth_lock

基于 `STM32F103C8T6 + HC-04 BLE + SG90` 的蓝牙门锁原型项目。

这个仓库只保留和项目直接相关的工程源码与设计文件，不再上传：

- `docs/` 文档目录
- AI 生成的工作流文件
- 临时测试脚本
- 其他与项目交付无关的辅助产物

## 仓库内容

```text
.
├─ SmartDoorLock.kicad_pro / .kicad_sch / .kicad_pcb
├─ code
│  ├─ test
│  └─ miniprogram
├─ _ref_STM32CubeF1
└─ 资料
```

## 主要组成

### 硬件

- 主控：`STM32F103C8T6`
- 蓝牙模块：`HC-04`
- 执行器：`SG90` 舵机
- 电源：`18650 + 升压/充电/保护模块`
- 调试串口：`CH340 USB-UART`

### 固件

固件工程位于：

- [code/test](C:\Users\S2km\Desktop\bulethoth_lock\code\test)

主要入口文件：

- [main.c](C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\main.c)
- [servo_control.c](C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\servo_control.c)
- [lock_config.c](C:\Users\S2km\Desktop\bulethoth_lock\code\test\Core\Src\lock_config.c)
- [test.uvprojx](C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx)

当前固件能力包括：

- 锁定 / 解锁控制
- PIN 认证
- 首次初始化 `PINSET INIT <newPin>`
- 可信手机绑定 / 解绑 / 查询
- 自动回锁
- 持久化配置
- 基于 challenge + MAC 的会话校验
- 上电默认锁定

### 微信小程序

小程序工程位于：

- [code/miniprogram](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram)

主要文件：

- [app.json](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\app.json)
- [lock_runtime.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\utils\lock_runtime.js)
- [home.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\home\home.js)
- [settings.js](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram\miniprogram\pages\settings\settings.js)

当前小程序能力包括：

- BLE 扫描、连接、断开
- 首页 / 设置页双标签结构
- PIN 认证与状态同步
- 自动重连和本地配置管理
- 可信手机绑定与同步
- RSSI 近距离自动开锁逻辑

## 推荐打开方式

### KiCad

- [SmartDoorLock.kicad_pro](C:\Users\S2km\Desktop\bulethoth_lock\SmartDoorLock.kicad_pro)

### Keil MDK

- [test.uvprojx](C:\Users\S2km\Desktop\bulethoth_lock\code\test\MDK-ARM\test.uvprojx)

### 微信开发者工具

- [code/miniprogram](C:\Users\S2km\Desktop\bulethoth_lock\code\miniprogram)

## 说明

这个仓库现在走“源码优先”的整理方式：

- 保留硬件工程、固件、小程序和必要参考资料
- 不再把设计过程文档、AI 工作流、临时测试文件上传到远程仓库

如果后续需要对外展示更完整文档，建议单独整理发布版资料，而不是直接把工作区过程文件全部放进仓库。
