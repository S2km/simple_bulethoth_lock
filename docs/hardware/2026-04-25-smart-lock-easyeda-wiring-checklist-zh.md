# 智能门锁底板 EasyEDA 画图清单

## 适用范围

本清单对应当前确认方案：

- 主控使用 `STM32F103C8T6 Blue Pill` 最小系统板
- 蓝牙模块使用 `HC-04` 串口蓝牙模块
- 执行机构使用 `SG90` 舵机
- 电源使用外置淘宝 `18650 充电/升压/UPS 5V 模块`
- 电源模块安装在同一块主板上
- 主板只从电源模块取 `5V` 和 `GND`
- 主板上再用 `3.3V LDO` 给 `Blue Pill + HC-04` 供电

---

## 一、先创建网络标号

先在原理图里创建这些网络名：

- `PWR_5V_IN`
- `VCC_3V3`
- `GND`
- `SERVO_PWM`
- `BLE_TX`
- `BLE_RX`
- `DBG_TX`
- `DBG_RX`

建议先把这些网络名放好，再开始连接，后面不容易接错。

---

## 二、放置元件

按这个顺序放元件最不容易乱：

1. `U1` 电源模块焊盘区或排针区
2. `SW1` 电源开关
3. `U2` 3.3V LDO
4. `C3/C4/C5` LDO 输入输出电容
5. `J1/J2` Blue Pill 双排母座
6. `J3` HC-04 接口排针
7. `C6/C7` HC-04 去耦电容
8. `J4` SG90 舵机接口
9. `C1/C2` 舵机电源滤波电容
10. `R1` 舵机信号串联电阻
11. `J5` 调试串口
12. `MH1~MH4` 安装孔

---

## 三、电源模块区域怎么画

把淘宝模块当成一个子模块 `U1` 来处理。

如果你现在还没有它的精确封装，先画成一个简化接口符号，至少留出：

- `U1.OUT+`
- `U1.OUT-`

连接方式：

- `U1.OUT+ -> SW1-1`
- `U1.OUT- -> GND`
- `SW1-2 -> PWR_5V_IN`

检查点：

- 主板上所有 `5V` 都必须来自 `SW1` 后面的 `PWR_5V_IN`
- 不要从电池原始正极直接给主板供电
- 不要把 `PWR_5V_IN` 和 `VCC_3V3` 画成同一网络

---

## 四、3.3V 稳压区域怎么画

`U2` 推荐先用：

- `ME6211C33M5G-N`

引脚连接：

- `PWR_5V_IN -> U2.IN`
- `GND -> U2.GND`
- `U2.OUT -> VCC_3V3`

电容连接：

- `C3 10uF`：`PWR_5V_IN` 到 `GND`
- `C4 10uF`：`VCC_3V3` 到 `GND`
- `C5 0.1uF`：`VCC_3V3` 到 `GND`

检查点：

- `U2` 输入是 `5V`
- `U2` 输出只能叫 `VCC_3V3`
- `Blue Pill` 和 `HC-04` 都只能接到 `VCC_3V3`

---

## 五、Blue Pill 插座怎么画

放两个 `1x20 2.54mm` 母座：

- `J1`
- `J2`

原理图里最少接出这些脚：

- `3V3`
- `GND`
- `PA8`
- `PA2`
- `PA3`
- `PA9`
- `PA10`

连接方式：

- `Blue Pill 3V3 -> VCC_3V3`
- `Blue Pill GND -> GND`
- `Blue Pill PA8 -> R1-1`
- `Blue Pill PA2 -> BLE_TX`
- `Blue Pill PA3 -> BLE_RX`
- `Blue Pill PA9 -> DBG_TX`
- `Blue Pill PA10 -> DBG_RX`

检查点：

- 不要给 `Blue Pill 5V` 引脚接电
- 至少接两个 `GND`
- 如果 Blue Pill 原板上也有 `3.3V` 稳压，不冲突，外部给它 `3V3` 即可

---

## 六、HC-04 接口怎么画

放一个 `1x4 2.54mm` 排针 `J3`。

建议引脚顺序：

1. `VCC_3V3`
2. `GND`
3. `HC-04 TXD`
4. `HC-04 RXD`

实际网络连接：

- `J3-1 -> VCC_3V3`
- `J3-2 -> GND`
- `J3-3 -> BLE_RX -> PA3`
- `J3-4 -> BLE_TX -> PA2`

去耦：

- `C6 10uF`：`VCC_3V3` 到 `GND`
- `C7 0.1uF`：`VCC_3V3` 到 `GND`

检查点：

- 串口一定是交叉连接
- `HC-04 TXD -> STM32 RX`
- `HC-04 RXD -> STM32 TX`
- `HC-04` 供电是 `3.3V`，不是 `5V`

---

## 七、SG90 接口怎么画

放一个 `1x3 2.54mm` 排针 `J4`。

建议引脚顺序：

1. `PWR_5V_IN`
2. `GND`
3. `SERVO_PWM`

连接方式：

- `J4-1 -> PWR_5V_IN`
- `J4-2 -> GND`
- `J4-3 -> SERVO_PWM`
- `R1-1 -> PA8`
- `R1-2 -> SERVO_PWM`

滤波电容：

- `C1 470uF~1000uF/10V`：`PWR_5V_IN` 到 `GND`
- `C2 0.1uF`：`PWR_5V_IN` 到 `GND`

检查点：

- 舵机电源直接走 `5V`
- 舵机信号前串 `R1=220R`
- `C1` 尽量靠近 `J4`

---

## 八、调试串口怎么画

放一个 `1x4 2.54mm` 排针 `J5`。

建议引脚顺序：

1. `VCC_3V3`
2. `GND`
3. `DBG_TX`
4. `DBG_RX`

连接方式：

- `J5-1 -> VCC_3V3`
- `J5-2 -> GND`
- `J5-3 -> PA9`
- `J5-4 -> PA10`

说明：

- 后面接 USB 转串口模块调试时，仍然要交叉接线
- 这个接口主要用于日志、调试和下载辅助

---

## 九、你在 EasyEDA 里可以直接照抄的连线表

### 电源部分

- `U1.OUT+ -> SW1-1`
- `SW1-2 -> PWR_5V_IN`
- `U1.OUT- -> GND`
- `PWR_5V_IN -> U2.IN`
- `PWR_5V_IN -> J4-1`
- `PWR_5V_IN -> C1+`
- `PWR_5V_IN -> C2-1`
- `PWR_5V_IN -> C3+`
- `GND -> U2.GND`
- `GND -> J4-2`
- `GND -> C1-`
- `GND -> C2-2`
- `GND -> C3-`
- `GND -> C4-`
- `GND -> C5-`
- `GND -> C6-`
- `GND -> C7-`
- `U2.OUT -> VCC_3V3`
- `VCC_3V3 -> Blue Pill 3V3`
- `VCC_3V3 -> J3-1`
- `VCC_3V3 -> J5-1`
- `VCC_3V3 -> C4+`
- `VCC_3V3 -> C5+`
- `VCC_3V3 -> C6+`
- `VCC_3V3 -> C7+`

### 信号部分

- `Blue Pill PA8 -> R1-1`
- `R1-2 -> SERVO_PWM`
- `SERVO_PWM -> J4-3`
- `Blue Pill PA2 -> BLE_TX`
- `BLE_TX -> J3-4`
- `Blue Pill PA3 -> BLE_RX`
- `BLE_RX -> J3-3`
- `Blue Pill PA9 -> DBG_TX`
- `DBG_TX -> J5-3`
- `Blue Pill PA10 -> DBG_RX`
- `DBG_RX -> J5-4`

---

## 十、ERC 前最后检查一次

你在 EasyEDA 画完后，逐条看这几项：

1. `PWR_5V_IN` 和 `VCC_3V3` 有没有误连
2. `HC-04` 是不是接的 `3.3V`
3. `SG90` 是不是接的 `5V`
4. `PA2/PA3` 串口方向有没有接反
5. `PA8` 有没有先串 `R1` 再到舵机
6. `C1` 是否并在舵机 `5V` 和 `GND` 之间
7. `C4/C5` 是否并在 `3.3V` 和 `GND` 之间
8. `GND` 是否全板共地
9. Blue Pill 的 `5V` 管脚是不是悬空未接

---

## 十一、PCB 摆放建议

从左到右或从上到下建议这样摆：

1. `U1 电源模块`
2. `SW1 开关`
3. `J4 舵机接口 + C1`
4. `U2 + C3/C4/C5`
5. `J1/J2 Blue Pill`
6. `J3 HC-04`
7. `J5 调试串口`

布线注意：

- `5V` 到舵机那段线尽量粗
- `GND` 最好铺铜
- `HC-04` 尽量离升压模块的电感远一点
- `SERVO_PWM` 不要贴着升压模块高噪声区域走

---

## 十二、现在还没最终定死的只有一项

还没完全定死的是 `U1` 的实际封装焊盘：

- 你拿到淘宝模块实物后
- 量一下长宽
- 量一下安装孔
- 量一下 `OUT+ / OUT-` 焊盘位置

然后再在 PCB 里把 `U1` 的模块焊盘区精确补上。

电气原理图本身已经可以先画。
