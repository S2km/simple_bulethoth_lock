#ifndef __SERVO_CONTROL_H__
#define __SERVO_CONTROL_H__

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define SERVO_COMMAND_BUFFER_SIZE        96U

void ServoControl_Init(UART_HandleTypeDef *huart1,
                       UART_HandleTypeDef *huart2,
                       TIM_HandleTypeDef *htim,
                       uint32_t channel);
void ServoControl_Task(void);
void ServoControl_UartRxCpltCallback(UART_HandleTypeDef *huart);
void ServoControl_UartErrorCallback(UART_HandleTypeDef *huart);

#ifdef __cplusplus
}
#endif

#endif /* __SERVO_CONTROL_H__ */
