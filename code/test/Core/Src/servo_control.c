#include "servo_control.h"
#include "lock_config.h"

#include <stdio.h>
#include <stdarg.h>
#include <string.h>

#define SERVO_LOCK_ANGLE                0U
#define SERVO_UNLOCK_ANGLE              180U
#define SERVO_AUTH_WINDOW_MS            30000UL
#define SERVO_AUTH_MAX_FAILURES         5U
#define SERVO_AUTH_LOCKOUT_MS           60000UL
#define SERVO_UART_TX_TIMEOUT_MS        120U
#define SERVO_DEBUG_UART_TX_TIMEOUT_MS  80U
#define SERVO_DEBUG_LOGGING_ENABLED     0U
#define SERVO_CHALLENGE_TIMEOUT_MS      10000UL
#define SERVO_PROVISION_WINDOW_MS       15000UL
#define SERVO_SERVO_HOLD_MS             900UL
#define SERVO_TRUSTED_KEY_LENGTH        16U

static const char servoPinSetInitToken[] = "INIT";

typedef enum
{
  SERVO_COMMAND_NONE = 0,
  SERVO_COMMAND_PIN,
  SERVO_COMMAND_TPIN,
  SERVO_COMMAND_PINSET,
  SERVO_COMMAND_BIND,
  SERVO_COMMAND_UNBIND,
  SERVO_COMMAND_TRUST_LIST,
  SERVO_COMMAND_RELOCK,
  SERVO_COMMAND_LOCK,
  SERVO_COMMAND_UNLOCK,
  SERVO_COMMAND_STATUS,
  SERVO_COMMAND_ANGLE
} ServoCommandType;

typedef enum
{
  SERVO_AUTH_MODE_NONE = 0,
  SERVO_AUTH_MODE_MANUAL,
  SERVO_AUTH_MODE_TRUSTED
} ServoAuthMode;

typedef enum
{
  SERVO_COMMAND_STAGE_NONE = 0,
  SERVO_COMMAND_STAGE_AUTH,
  SERVO_COMMAND_STAGE_CONTROL,
  SERVO_COMMAND_STAGE_CONFIG
} ServoCommandStage;

typedef struct
{
  ServoCommandType type;
  uint8_t angle;
  uint8_t relockSeconds;
  char mac[17];
  char pin[12];
  char newPin[12];
  char clientId[33];
  char clientKey[33];
  char nickname[21];
} ServoParsedCommand;

typedef struct
{
  ServoAuthMode mode;
  uint8_t failureCount;
  uint32_t expiresTick;
  uint32_t lockoutTick;
  uint8_t expiredPending;
  uint8_t expiredLatched;
  char authorizedClientId[33];
  uint32_t lastChallenge;
  uint32_t challengeIssuedTick;
  uint8_t challengePending;
  uint32_t sessionKeyHash;
} ServoAuthState;

typedef struct
{
  UART_HandleTypeDef *huart;
  uint8_t rxByte;
  char rxBuffer[SERVO_COMMAND_BUFFER_SIZE];
  char commandBuffer[SERVO_COMMAND_BUFFER_SIZE];
  volatile uint8_t rxIndex;
  volatile uint8_t commandReady;
  volatile uint8_t overflowPending;
  volatile uint8_t queuedErrorCount;
  volatile uint8_t errorPending;
  volatile uint32_t errorCount;
  volatile uint32_t lastErrorCode;
  const char *name;
} ServoUartChannel;

static ServoUartChannel servoUart1;
static ServoUartChannel servoUart2;
static TIM_HandleTypeDef *servoTim;
static uint32_t servoTimChannel;
static UART_HandleTypeDef *servoDebugUart;
static uint32_t servoDebugHeartbeatTick;
static uint8_t servoCurrentAngle;
static uint8_t servoLockIsUnlocked;
static LockConfigData servoConfig;
static ServoAuthState servoAuthState1;
static ServoAuthState servoAuthState2;
static uint8_t servoRelockArmed;
static uint32_t servoRelockDeadlineTick;
static uint8_t servoServoPulseActive;
static uint32_t servoServoPulseReleaseTick;
static uint32_t servoProvisionUnlockTick;

static void ServoControl_InitChannel(ServoUartChannel *channel, UART_HandleTypeDef *huart, const char *name);
static ServoUartChannel *ServoControl_FindChannel(UART_HandleTypeDef *huart);
static void ServoControl_ProcessChannelCommand(ServoUartChannel *channel);
static void ServoControl_SendText(ServoUartChannel *channel, const char *text);
static void ServoControl_StartReception(ServoUartChannel *channel);
static void ServoControl_DebugPrint(const char *format, ...);
static uint32_t ServoControl_GetTxTimeoutMs(UART_HandleTypeDef *huart, uint16_t length, uint32_t minimumTimeoutMs);
static void ServoControl_ProcessChannelError(ServoUartChannel *channel);
static ServoAuthState *ServoControl_GetAuthState(const ServoUartChannel *channel);
static void ServoControl_InitAuthState(ServoAuthState *authState);
static void ServoControl_ClearAuthorization(ServoAuthState *authState);
static void ServoControl_RefreshAuthorization(ServoAuthState *authState, ServoAuthMode mode, const char *clientId);
static uint8_t ServoControl_IsAuthorized(ServoAuthState *authState);
static uint8_t ServoControl_IsProvisioned(void);
static uint8_t ServoControl_IsLockoutActive(ServoAuthState *authState, uint32_t nowTick, uint32_t *remainingSeconds);
static uint8_t ServoControl_ParseCommand(const char *command, ServoParsedCommand *parsed);
static const char *ServoControl_GetCommandLogLabel(const char *command);
static uint8_t ServoControl_HandlePinAuthorization(ServoUartChannel *channel,
                                                   const char *pin,
                                                   ServoAuthMode mode,
                                                   const char *clientId,
                                                   uint8_t trustedResponse,
                                                   const char *mac);
static void ServoControl_HandlePinCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleTrustedPinCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandlePinSetCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleBindCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleUnbindCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleTrustListCommand(ServoUartChannel *channel);
static void ServoControl_HandleRelockCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_HandleActionCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed);
static void ServoControl_SendStatus(ServoUartChannel *channel);
static void ServoControl_SetLockedState(uint8_t unlockRequested);
static void ServoControl_DrainQueuedErrors(ServoUartChannel *channel);
static uint8_t ServoControl_TryParseAngle(const char *command, ServoParsedCommand *parsed);
static void ServoControl_SetAngle(uint8_t angle);
static void ServoControl_ArmRelock(uint8_t seconds);
static void ServoControl_CancelRelock(void);
static void ServoControl_UpdateProvisionWindow(void);
static uint8_t ServoControl_IsProvisionWindowOpen(const ServoUartChannel *channel);
static uint32_t ServoControl_ReadUidWord(uint32_t index);
static uint32_t ServoControl_RotateLeft32(uint32_t value, uint8_t shift);
static uint32_t ServoControl_ComputeSessionChallenge(const ServoUartChannel *channel, uint32_t nowTick);
static uint32_t ServoControl_ComputeClientKeyHash(const char *clientKey);
static uint8_t ServoControl_ChannelRequiresSessionProof(const ServoUartChannel *channel);
static uint32_t ServoControl_FnvHashText(const char *text);
static uint32_t ServoControl_FnvMixWord(uint32_t hash, uint32_t word);
static uint32_t ServoControl_FnvMixString(uint32_t hash, const char *text);
static uint32_t ServoControl_ComputeSessionMacHash(uint32_t secretHash,
                                                   uint32_t challenge,
                                                   const char *commandName,
                                                   const char *payloadA,
                                                   const char *payloadB,
                                                   const char *payloadC);
static uint8_t ServoControl_ParseMacValue(const char *mac, uint32_t *valueOut);
static uint8_t ServoControl_ReadTrustedKeyHash(const char *clientId, uint32_t *keyHashOut);
static void ServoControl_AppendChallenge(ServoUartChannel *channel);
static uint8_t ServoControl_VerifyBleProof(ServoUartChannel *channel,
                                           ServoAuthState *authState,
                                           uint32_t secretHash,
                                           const char *commandName,
                                           const char *payloadA,
                                           const char *payloadB,
                                           const char *payloadC,
                                           const char *mac);
static void ServoControl_SkipWhitespace(const char **cursor);
static uint8_t ServoControl_ReadToken(const char **cursor, char *destination, uint32_t capacity);
static uint8_t ServoControl_IsRelockSecondsAllowed(uint8_t seconds);
static uint8_t ServoControl_IsTrustedFieldSafe(const char *value);
static uint8_t ServoControl_SanitizeTrustedRecords(void);

static ServoAuthState *ServoControl_GetAuthState(const ServoUartChannel *channel)
{
  if (channel == &servoUart2)
  {
    return &servoAuthState2;
  }

  return &servoAuthState1;
}

static void ServoControl_InitAuthState(ServoAuthState *authState)
{
  if (authState == NULL)
  {
    return;
  }

  memset(authState, 0, sizeof(*authState));
  authState->mode = SERVO_AUTH_MODE_NONE;
  authState->sessionKeyHash = 0U;
}

static void ServoControl_UpdateProvisionWindow(void)
{
  if (ServoControl_IsProvisioned() != 0U)
  {
    servoProvisionUnlockTick = 0U;
  }
}

static uint8_t ServoControl_IsProvisionWindowOpen(const ServoUartChannel *channel)
{
  uint32_t nowTick;

  if (ServoControl_IsProvisioned() != 0U)
  {
    return 0U;
  }

  if (channel != &servoUart1)
  {
    return 0U;
  }

  nowTick = HAL_GetTick();
  return ((servoProvisionUnlockTick != 0U) && ((int32_t)(servoProvisionUnlockTick - nowTick) > 0)) ? 1U : 0U;
}

static uint32_t ServoControl_ReadUidWord(uint32_t index)
{
  const uint32_t *uidBase = (const uint32_t *)(uintptr_t)UID_BASE;
  return uidBase[index];
}

static uint32_t ServoControl_RotateLeft32(uint32_t value, uint8_t shift)
{
  return (value << shift) | (value >> (32U - shift));
}

static uint32_t ServoControl_ComputeSessionChallenge(const ServoUartChannel *channel, uint32_t nowTick)
{
  uint32_t seed = nowTick ^ ServoControl_ReadUidWord(0U) ^ ServoControl_ReadUidWord(1U) ^ ServoControl_ReadUidWord(2U);
  seed ^= (channel == &servoUart2) ? 0xA5A55A5AUL : 0x5AA5A55AUL;
  seed ^= ServoControl_RotateLeft32(seed, 7U);
  seed ^= ServoControl_RotateLeft32(seed, 13U);
  return seed;
}

static uint32_t ServoControl_ComputeClientKeyHash(const char *clientKey)
{
  return ServoControl_FnvHashText(clientKey);
}

static uint8_t ServoControl_ChannelRequiresSessionProof(const ServoUartChannel *channel)
{
  return (channel == &servoUart2) ? 1U : 0U;
}

static uint32_t ServoControl_FnvHashText(const char *text)
{
  uint32_t hash = 2166136261UL;
  const uint8_t *cursor = (const uint8_t *)text;

  if (text == NULL)
  {
    return 0U;
  }

  while (*cursor != 0U)
  {
    hash ^= *cursor++;
    hash *= 16777619UL;
  }

  return hash;
}

static uint32_t ServoControl_FnvMixWord(uint32_t hash, uint32_t word)
{
  uint8_t index;
  uint32_t mixed = hash;

  for (index = 0U; index < 4U; index++)
  {
    mixed ^= (word & 0xFFU);
    mixed *= 16777619UL;
    word >>= 8U;
  }

  return mixed;
}

static uint32_t ServoControl_FnvMixString(uint32_t hash, const char *text)
{
  uint32_t mixed = hash;
  const uint8_t *cursor = (const uint8_t *)text;

  if (text != NULL)
  {
    while (*cursor != 0U)
    {
      mixed ^= *cursor++;
      mixed *= 16777619UL;
    }
  }

  mixed ^= 0U;
  mixed *= 16777619UL;
  return mixed;
}

static uint32_t ServoControl_ComputeSessionMacHash(uint32_t secretHash,
                                                   uint32_t challenge,
                                                   const char *commandName,
                                                   const char *payloadA,
                                                   const char *payloadB,
                                                   const char *payloadC)
{
  uint32_t hash = 2166136261UL;

  hash = ServoControl_FnvMixWord(hash, secretHash);
  hash = ServoControl_FnvMixWord(hash, challenge);
  hash = ServoControl_FnvMixString(hash, commandName);
  hash = ServoControl_FnvMixString(hash, payloadA);
  hash = ServoControl_FnvMixString(hash, payloadB);
  hash = ServoControl_FnvMixString(hash, payloadC);
  return hash;
}

static uint8_t ServoControl_ParseMacValue(const char *mac, uint32_t *valueOut)
{
  uint32_t value = 0U;
  const char *cursor;

  if ((mac == NULL) || (valueOut == NULL))
  {
    return 0U;
  }

  cursor = mac;
  if (*cursor == '\0')
  {
    return 0U;
  }

  while (*cursor != '\0')
  {
    value <<= 4U;
    if ((*cursor >= '0') && (*cursor <= '9'))
    {
      value |= (uint32_t)(*cursor - '0');
    }
    else if ((*cursor >= 'A') && (*cursor <= 'F'))
    {
      value |= (uint32_t)(*cursor - 'A' + 10U);
    }
    else
    {
      return 0U;
    }
    cursor++;
  }

  *valueOut = value;
  return 1U;
}

static uint8_t ServoControl_ReadTrustedKeyHash(const char *clientId, uint32_t *keyHashOut)
{
  int8_t index;

  if ((clientId == NULL) || (keyHashOut == NULL))
  {
    return 0U;
  }

  index = LockConfig_FindPhone(&servoConfig, clientId);
  if (index < 0)
  {
    return 0U;
  }

  *keyHashOut = ServoControl_ComputeClientKeyHash(servoConfig.phones[(uint8_t)index].clientKey);
  return 1U;
}

static void ServoControl_AppendChallenge(ServoUartChannel *channel)
{
  ServoAuthState *authState;

  authState = ServoControl_GetAuthState(channel);
  authState->lastChallenge = ServoControl_ComputeSessionChallenge(channel, HAL_GetTick());
  authState->challengeIssuedTick = HAL_GetTick();
  authState->challengePending = 1U;
}

static uint8_t ServoControl_VerifyBleProof(ServoUartChannel *channel,
                                           ServoAuthState *authState,
                                           uint32_t secretHash,
                                           const char *commandName,
                                           const char *payloadA,
                                           const char *payloadB,
                                           const char *payloadC,
                                           const char *mac)
{
  uint32_t providedMac;
  uint32_t expectedMac;
  uint32_t nowTick;

  if ((authState == NULL) || (ServoControl_ChannelRequiresSessionProof(channel) == 0U))
  {
    return 1U;
  }

  nowTick = HAL_GetTick();
  if ((authState->challengePending == 0U) ||
      ((int32_t)(nowTick - authState->challengeIssuedTick) >= (int32_t)SERVO_CHALLENGE_TIMEOUT_MS))
  {
    return 0U;
  }

  if (ServoControl_ParseMacValue(mac, &providedMac) == 0U)
  {
    return 0U;
  }

  expectedMac = ServoControl_ComputeSessionMacHash(secretHash,
                                                   authState->lastChallenge,
                                                   commandName,
                                                   payloadA,
                                                   payloadB,
                                                   payloadC);

  if (providedMac != expectedMac)
  {
    return 0U;
  }

  authState->challengePending = 0U;
  return 1U;
}

void ServoControl_Init(UART_HandleTypeDef *huart1,
                       UART_HandleTypeDef *huart2,
                       TIM_HandleTypeDef *htim,
                       uint32_t channel)
{
  uint8_t loaded;
  uint8_t sanitized;

  servoTim = htim;
  servoTimChannel = channel;
  servoDebugUart = huart1;
  loaded = LockConfig_Load(&servoConfig);
  sanitized = ServoControl_SanitizeTrustedRecords();
  ServoControl_InitAuthState(&servoAuthState1);
  ServoControl_InitAuthState(&servoAuthState2);
  servoRelockArmed = 0U;
  servoRelockDeadlineTick = 0U;
  servoServoPulseActive = 0U;
  servoServoPulseReleaseTick = 0U;
  servoProvisionUnlockTick = HAL_GetTick() + SERVO_PROVISION_WINDOW_MS;

  if (loaded == 0U)
  {
    (void)LockConfig_Save(&servoConfig);
    ServoControl_DebugPrint("DBG config initialized and saved\r\n");
  }
  else if (LockConfig_HasPin(&servoConfig) == 0U)
  {
    if (LockConfig_Save(&servoConfig) == HAL_OK)
    {
      ServoControl_DebugPrint("DBG missing pin healed and saved\r\n");
    }
    else
    {
      ServoControl_DebugPrint("DBG missing pin heal save failed\r\n");
    }
  }
  else if (sanitized != 0U)
  {
    if (LockConfig_Save(&servoConfig) == HAL_OK)
    {
      ServoControl_DebugPrint("DBG trusted records sanitized and saved\r\n");
    }
    else
    {
      ServoControl_DebugPrint("DBG trusted record sanitize save failed\r\n");
    }
  }

  servoDebugHeartbeatTick = 0U;
  servoCurrentAngle = SERVO_LOCK_ANGLE;
  servoLockIsUnlocked = 0U;

  ServoControl_InitChannel(&servoUart1, huart1, "USART1");
  ServoControl_InitChannel(&servoUart2, huart2, "USART2");

  ServoControl_SetLockedState(0U);

  ServoControl_StartReception(&servoUart1);
  ServoControl_StartReception(&servoUart2);

  if (ServoControl_IsProvisioned() != 0U)
  {
    ServoControl_SendText(&servoUart1,
                          "\r\nUSART1 ready, commands: PIN/TPIN/PINSET/BIND/UNBIND/TRUST LIST/RELOCK/LOCK/UNLOCK/STATUS/A0-A180\r\n");
    ServoControl_SendText(&servoUart2,
                          "\r\nUSART2 ready, commands: PIN/TPIN/PINSET/BIND/UNBIND/TRUST LIST/RELOCK/LOCK/UNLOCK/STATUS/A0-A180\r\n");
  }
  else
  {
    ServoControl_SendText(&servoUart1,
                          "\r\nUSART1 ready, local setup window open: PINSET INIT <newPin>\r\n");
    ServoControl_SendText(&servoUart2,
                          "\r\nUSART2 ready, remote setup denied until provisioning completes\r\n");
  }

  ServoControl_DebugPrint("DBG init complete, lock state=LOCK, provisioned=%u\r\n",
                          ServoControl_IsProvisioned());
}

void ServoControl_Task(void)
{
  uint32_t nowTick;

  nowTick = HAL_GetTick();
  ServoControl_UpdateProvisionWindow();
  if ((servoDebugUart != NULL) && ((nowTick - servoDebugHeartbeatTick) >= 1000U))
  {
    servoDebugHeartbeatTick = nowTick;
    // ServoControl_DebugPrint("DBG alive tick=%lu angle=%u rx2idx=%u cmd2=%u\r\n",
                            // nowTick,
                            // servoCurrentAngle,
                            // servoUart2.rxIndex,
                            // servoUart2.commandReady);
  }

  if ((ServoControl_IsAuthorized(&servoAuthState1) == 0U) && (servoAuthState1.expiredPending != 0U))
  {
    servoAuthState1.expiredPending = 0U;
    ServoControl_DebugPrint("DBG auth expired\r\n");
  }

  if ((ServoControl_IsAuthorized(&servoAuthState2) == 0U) && (servoAuthState2.expiredPending != 0U))
  {
    servoAuthState2.expiredPending = 0U;
    ServoControl_DebugPrint("DBG auth expired on USART2\r\n");
  }

  if ((servoServoPulseActive != 0U) && ((int32_t)(nowTick - servoServoPulseReleaseTick) >= 0))
  {
    (void)HAL_TIM_PWM_Stop(servoTim, servoTimChannel);
    servoServoPulseActive = 0U;
  }

  if ((servoRelockArmed != 0U) && ((int32_t)(HAL_GetTick() - servoRelockDeadlineTick) >= 0))
  {
    ServoControl_CancelRelock();
    ServoControl_SetLockedState(0U);
    ServoControl_DebugPrint("DBG auto relock executed\r\n");
  }

  if (servoUart1.commandReady != 0U)
  {
    ServoControl_ProcessChannelCommand(&servoUart1);
  }

  if (servoUart1.errorPending != 0U)
  {
    ServoControl_ProcessChannelError(&servoUart1);
  }

  ServoControl_DrainQueuedErrors(&servoUart1);

  if (servoUart2.commandReady != 0U)
  {
    ServoControl_ProcessChannelCommand(&servoUart2);
  }

  if (servoUart2.errorPending != 0U)
  {
    ServoControl_ProcessChannelError(&servoUart2);
  }

  ServoControl_DrainQueuedErrors(&servoUart2);
}

void ServoControl_UartRxCpltCallback(UART_HandleTypeDef *huart)
{
  ServoUartChannel *channel;

  channel = ServoControl_FindChannel(huart);
  if (channel == NULL)
  {
    return;
  }

  if ((channel->rxByte == '\r') || (channel->rxByte == '\n'))
  {
    if (channel->overflowPending != 0U)
    {
      if (channel->commandReady == 0U)
      {
        channel->commandBuffer[0] = '\0';
        channel->commandReady = 1U;
      }
      else if (channel->queuedErrorCount < 255U)
      {
        channel->queuedErrorCount++;
      }
    }
    else if (channel->rxIndex > 0U)
    {
      if (channel->commandReady == 0U)
      {
        memcpy(channel->commandBuffer, channel->rxBuffer, channel->rxIndex);
        channel->commandBuffer[channel->rxIndex] = '\0';
        channel->commandReady = 1U;
      }
      else
      {
        if (channel->queuedErrorCount < 255U)
        {
          channel->queuedErrorCount++;
        }
      }
    }
    channel->overflowPending = 0U;
    channel->rxIndex = 0U;
  }
  else if (channel->overflowPending == 0U)
  {
    if (channel->rxIndex < (sizeof(channel->rxBuffer) - 1U))
    {
      channel->rxBuffer[channel->rxIndex] = (char)channel->rxByte;
      channel->rxIndex++;
    }
    else
    {
      channel->overflowPending = 1U;
      channel->rxIndex = 0U;
    }
  }

  (void)HAL_UART_Receive_IT(channel->huart, &channel->rxByte, 1U);
}

void ServoControl_UartErrorCallback(UART_HandleTypeDef *huart)
{
  ServoUartChannel *channel;

  channel = ServoControl_FindChannel(huart);
  if (channel == NULL)
  {
    return;
  }

  channel->lastErrorCode = huart->ErrorCode;
  channel->errorCount++;
  channel->errorPending = 1U;
  channel->rxIndex = 0U;
  (void)HAL_UART_Receive_IT(channel->huart, &channel->rxByte, 1U);
}

static void ServoControl_InitChannel(ServoUartChannel *channel, UART_HandleTypeDef *huart, const char *name)
{
  channel->huart = huart;
  channel->rxByte = 0U;
  memset(channel->rxBuffer, 0, sizeof(channel->rxBuffer));
  memset(channel->commandBuffer, 0, sizeof(channel->commandBuffer));
  channel->rxIndex = 0U;
  channel->commandReady = 0U;
  channel->overflowPending = 0U;
  channel->queuedErrorCount = 0U;
  channel->errorPending = 0U;
  channel->errorCount = 0U;
  channel->lastErrorCode = 0U;
  channel->name = name;
}

static ServoUartChannel *ServoControl_FindChannel(UART_HandleTypeDef *huart)
{
  if ((huart != NULL) && (servoUart1.huart != NULL) && (huart->Instance == servoUart1.huart->Instance))
  {
    return &servoUart1;
  }

  if ((huart != NULL) && (servoUart2.huart != NULL) && (huart->Instance == servoUart2.huart->Instance))
  {
    return &servoUart2;
  }

  return NULL;
}

static void ServoControl_ProcessChannelCommand(ServoUartChannel *channel)
{
  char command[sizeof(channel->commandBuffer)];
  ServoParsedCommand parsed;

  __disable_irq();
  memcpy(command, channel->commandBuffer, sizeof(command));
  channel->commandReady = 0U;
  __enable_irq();

  command[sizeof(command) - 1U] = '\0';
  ServoControl_DebugPrint("DBG %s command=%s\r\n", channel->name, ServoControl_GetCommandLogLabel(command));

  if (ServoControl_ParseCommand(command, &parsed) == 0U)
  {
    ServoControl_SendText(channel, "ERROR COMMAND\r\n");
    return;
  }

  if (parsed.type == SERVO_COMMAND_PIN)
  {
    ServoControl_HandlePinCommand(channel, &parsed);
    return;
  }

  switch (parsed.type)
  {
    case SERVO_COMMAND_TPIN:
      ServoControl_HandleTrustedPinCommand(channel, &parsed);
      break;

    case SERVO_COMMAND_PINSET:
      ServoControl_HandlePinSetCommand(channel, &parsed);
      break;

    case SERVO_COMMAND_BIND:
      ServoControl_HandleBindCommand(channel, &parsed);
      break;

    case SERVO_COMMAND_UNBIND:
      ServoControl_HandleUnbindCommand(channel, &parsed);
      break;

    case SERVO_COMMAND_TRUST_LIST:
      ServoControl_HandleTrustListCommand(channel);
      break;

    case SERVO_COMMAND_RELOCK:
      ServoControl_HandleRelockCommand(channel, &parsed);
      break;

    case SERVO_COMMAND_STATUS:
      ServoControl_SendStatus(channel);
      break;

    default:
      ServoControl_HandleActionCommand(channel, &parsed);
      break;
  }
}

static uint32_t ServoControl_GetTxTimeoutMs(UART_HandleTypeDef *huart, uint16_t length, uint32_t minimumTimeoutMs)
{
  uint32_t baudRate;
  uint32_t frameCount;
  uint32_t timeoutMs;

  if (huart == NULL)
  {
    return minimumTimeoutMs;
  }

  baudRate = huart->Init.BaudRate;
  if (baudRate == 0U)
  {
    return minimumTimeoutMs;
  }

  frameCount = (uint32_t)length * 10U;
  timeoutMs = ((frameCount * 1000U) + baudRate - 1U) / baudRate;
  timeoutMs += 5U;

  if (timeoutMs < minimumTimeoutMs)
  {
    timeoutMs = minimumTimeoutMs;
  }

  return timeoutMs;
}

static void ServoControl_ProcessChannelError(ServoUartChannel *channel)
{
  uint32_t errorCode;
  uint32_t errorCount;
  ServoAuthState *authState;

  __disable_irq();
  errorCode = channel->lastErrorCode;
  errorCount = channel->errorCount;
  channel->errorPending = 0U;
  __enable_irq();

  ServoControl_DebugPrint("DBG %s uart error count=%lu last=0x%08lX\r\n",
                          channel->name,
                          errorCount,
                          errorCode);

  authState = ServoControl_GetAuthState(channel);
  ServoControl_ClearAuthorization(authState);
  authState->expiredPending = 0U;
  authState->expiredLatched = 0U;
  ServoControl_DebugPrint("DBG %s reset, auth cleared\r\n", channel->name);
}

static uint8_t ServoControl_IsProvisioned(void)
{
  return LockConfig_HasPin(&servoConfig);
}

static void ServoControl_ClearAuthorization(ServoAuthState *authState)
{
  if (authState == NULL)
  {
    return;
  }

  authState->mode = SERVO_AUTH_MODE_NONE;
  memset(authState->authorizedClientId, 0, sizeof(authState->authorizedClientId));
  authState->expiresTick = 0U;
  authState->challengePending = 0U;
  authState->lastChallenge = 0U;
  authState->challengeIssuedTick = 0U;
  authState->sessionKeyHash = 0U;
}

static void ServoControl_RefreshAuthorization(ServoAuthState *authState, ServoAuthMode mode, const char *clientId)
{
  if (authState == NULL)
  {
    return;
  }

  authState->mode = mode;
  if ((mode == SERVO_AUTH_MODE_TRUSTED) && (clientId != NULL))
  {
    strncpy(authState->authorizedClientId, clientId, sizeof(authState->authorizedClientId) - 1U);
    authState->authorizedClientId[sizeof(authState->authorizedClientId) - 1U] = '\0';
  }
  else
  {
    memset(authState->authorizedClientId, 0, sizeof(authState->authorizedClientId));
  }
  authState->failureCount = 0U;
  authState->lockoutTick = 0U;
  authState->expiresTick = HAL_GetTick() + SERVO_AUTH_WINDOW_MS;
  authState->expiredPending = 0U;
  authState->expiredLatched = 0U;
  authState->challengePending = 0U;
}

static uint8_t ServoControl_IsAuthorized(ServoAuthState *authState)
{
  uint32_t nowTick = HAL_GetTick();

  if (authState == NULL)
  {
    return 0U;
  }

  if ((authState->mode != SERVO_AUTH_MODE_NONE) && ((int32_t)(nowTick - authState->expiresTick) >= 0))
  {
    authState->mode = SERVO_AUTH_MODE_NONE;
    memset(authState->authorizedClientId, 0, sizeof(authState->authorizedClientId));
    authState->expiresTick = 0U;
    authState->expiredPending = 1U;
    authState->expiredLatched = 1U;
  }

  return (authState->mode != SERVO_AUTH_MODE_NONE) ? 1U : 0U;
}

static uint8_t ServoControl_IsLockoutActive(ServoAuthState *authState, uint32_t nowTick, uint32_t *remainingSeconds)
{
  if (remainingSeconds != NULL)
  {
    *remainingSeconds = 0U;
  }

  if (authState == NULL)
  {
    return 0U;
  }

  if (authState->lockoutTick == 0U)
  {
    return 0U;
  }

  if ((int32_t)(nowTick - authState->lockoutTick) < 0)
  {
    if (remainingSeconds != NULL)
    {
      uint32_t remainingMs = authState->lockoutTick - nowTick;
      uint32_t seconds = (remainingMs + 999U) / 1000U;
      *remainingSeconds = (seconds == 0U) ? 1U : seconds;
    }
    return 1U;
  }

  authState->failureCount = 0U;
  authState->lockoutTick = 0U;
  return 0U;
}

static uint8_t ServoControl_ParseCommand(const char *command, ServoParsedCommand *parsed)
{
  const char *cursor;
  const char *tokenCursor;
  const char *valueCursor;
  char keyword[12];
  char valueToken[12];
  uint16_t numeric;

  if ((command == NULL) || (parsed == NULL))
  {
    return 0U;
  }

  memset(parsed, 0, sizeof(*parsed));
  cursor = command;

  ServoControl_SkipWhitespace(&cursor);

  if (ServoControl_TryParseAngle(cursor, parsed) != 0U)
  {
    return 1U;
  }

  tokenCursor = cursor;
  if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) == 0U)
  {
    return 0U;
  }

  if (strcmp(keyword, "PIN") == 0)
  {
    if (ServoControl_ReadToken(&tokenCursor, parsed->pin, sizeof(parsed->pin)) == 0U)
    {
      return 0U;
    }
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }
    parsed->type = SERVO_COMMAND_PIN;
    return 1U;
  }

  if (strcmp(keyword, "TPIN") == 0)
  {
    if ((ServoControl_ReadToken(&tokenCursor, parsed->clientId, sizeof(parsed->clientId)) == 0U) ||
        (ServoControl_ReadToken(&tokenCursor, parsed->pin, sizeof(parsed->pin)) == 0U))
    {
      return 0U;
    }
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) == 0U)
    {
      strncpy(parsed->mac, parsed->pin, sizeof(parsed->mac) - 1U);
      parsed->mac[sizeof(parsed->mac) - 1U] = '\0';
      parsed->pin[0] = '\0';
    }
    else if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
    {
      return 0U;
    }
    parsed->type = SERVO_COMMAND_TPIN;
    return 1U;
  }

  if (strcmp(keyword, "PINSET") == 0)
  {
    if ((ServoControl_ReadToken(&tokenCursor, parsed->pin, sizeof(parsed->pin)) == 0U) ||
        (ServoControl_ReadToken(&tokenCursor, parsed->newPin, sizeof(parsed->newPin)) == 0U))
    {
      return 0U;
    }
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }
    parsed->type = SERVO_COMMAND_PINSET;
    return 1U;
  }

  if (strcmp(keyword, "BIND") == 0)
  {
    if ((ServoControl_ReadToken(&tokenCursor, parsed->clientId, sizeof(parsed->clientId)) == 0U) ||
        (ServoControl_ReadToken(&tokenCursor, parsed->clientKey, sizeof(parsed->clientKey)) == 0U) ||
        (ServoControl_ReadToken(&tokenCursor, parsed->nickname, sizeof(parsed->nickname)) == 0U))
    {
      return 0U;
    }
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }
    parsed->type = SERVO_COMMAND_BIND;
    return 1U;
  }

  if (strcmp(keyword, "UNBIND") == 0)
  {
    if (ServoControl_ReadToken(&tokenCursor, parsed->clientId, sizeof(parsed->clientId)) == 0U)
    {
      return 0U;
    }
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }
    parsed->type = SERVO_COMMAND_UNBIND;
    return 1U;
  }

  if (strcmp(keyword, "RELOCK") == 0)
  {
    if (ServoControl_ReadToken(&tokenCursor, valueToken, sizeof(valueToken)) == 0U)
    {
      return 0U;
    }

    numeric = 0U;
    valueCursor = valueToken;
    while (*valueCursor != '\0')
    {
      if ((*valueCursor < '0') || (*valueCursor > '9'))
      {
        return 0U;
      }
      numeric = (uint16_t)((numeric * 10U) + (uint16_t)(*valueCursor - '0'));
      if (numeric > 255U)
      {
        return 0U;
      }
      valueCursor++;
    }

    if (ServoControl_IsRelockSecondsAllowed((uint8_t)numeric) == 0U)
    {
      return 0U;
    }

    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }

    parsed->type = SERVO_COMMAND_RELOCK;
    parsed->relockSeconds = (uint8_t)numeric;
    return 1U;
  }

  if (strcmp(keyword, "LOCK") == 0)
  {
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }
    parsed->type = SERVO_COMMAND_LOCK;
    return 1U;
  }

  if (strcmp(keyword, "UNLOCK") == 0)
  {
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }
    parsed->type = SERVO_COMMAND_UNLOCK;
    return 1U;
  }

  if (strcmp(keyword, "STATUS") == 0)
  {
    if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
    {
      return 0U;
    }
    parsed->type = SERVO_COMMAND_STATUS;
    return 1U;
  }

  if (strcmp(keyword, "TRUST") == 0)
  {
    if ((ServoControl_ReadToken(&tokenCursor, valueToken, sizeof(valueToken)) == 0U) ||
        (strcmp(valueToken, "LIST") != 0))
    {
      return 0U;
    }
    if (ServoControl_ReadToken(&tokenCursor, parsed->mac, sizeof(parsed->mac)) != 0U)
    {
      if (ServoControl_ReadToken(&tokenCursor, keyword, sizeof(keyword)) != 0U)
      {
        return 0U;
      }
    }
    parsed->type = SERVO_COMMAND_TRUST_LIST;
    return 1U;
  }

  return 0U;
}

static const char *ServoControl_GetCommandLogLabel(const char *command)
{
  static char label[20];
  const char *cursor;
  uint32_t length;

  if (command == NULL)
  {
    return "INVALID";
  }

  cursor = command;
  while ((*cursor == ' ') || (*cursor == '\t'))
  {
    cursor++;
  }

  length = 0U;
  while ((cursor[length] != '\0') &&
         (cursor[length] != ' ') &&
         (cursor[length] != '\t') &&
         (length < (sizeof(label) - 1U)))
  {
    label[length] = cursor[length];
    length++;
  }

  if (length == 0U)
  {
    return "EMPTY";
  }

  label[length] = '\0';

  if ((strcmp(label, "PIN") == 0) ||
      (strcmp(label, "TPIN") == 0) ||
      (strcmp(label, "PINSET") == 0))
  {
    return "SENSITIVE";
  }

  return label;
}

static uint8_t ServoControl_HandlePinAuthorization(ServoUartChannel *channel,
                                                   const char *pin,
                                                   ServoAuthMode mode,
                                                   const char *clientId,
                                                   uint8_t trustedResponse,
                                                   const char *mac)
{
  char response[40];
  uint32_t nowTick;
  uint32_t remainingSeconds = 0U;
  ServoAuthState *authState;
  uint32_t secretHash;

  authState = ServoControl_GetAuthState(channel);

  if (ServoControl_IsProvisioned() == 0U)
  {
    ServoControl_ClearAuthorization(authState);
    authState->expiredLatched = 0U;
    ServoControl_SendText(channel, "AUTH UNPROVISIONED\r\n");
    return 0U;
  }

  nowTick = HAL_GetTick();
  if (ServoControl_IsLockoutActive(authState, nowTick, &remainingSeconds) != 0U)
  {
    (void)snprintf(response, sizeof(response), "AUTH LOCKED %lu\r\n", remainingSeconds);
    ServoControl_SendText(channel, response);
    return 0U;
  }

  if (strcmp(pin, servoConfig.pin) == 0)
  {
    secretHash = ServoControl_FnvHashText(pin);
    if (ServoControl_VerifyBleProof(channel,
                                    authState,
                                    secretHash,
                                    (trustedResponse != 0U) ? "TPIN" : "PIN",
                                    (trustedResponse != 0U) ? clientId : pin,
                                    NULL,
                                    NULL,
                                    mac) == 0U)
    {
      ServoControl_ClearAuthorization(authState);
      ServoControl_SendText(channel, "AUTH FAIL 0\r\n");
      return 0U;
    }

    ServoControl_RefreshAuthorization(authState, mode, clientId);
    authState->sessionKeyHash = secretHash;
    ServoControl_AppendChallenge(channel);
    if (trustedResponse != 0U)
    {
      (void)snprintf(response,
                     sizeof(response),
                     "TPIN OK %lu CHAL=%08lX\r\n",
                     SERVO_AUTH_WINDOW_MS / 1000UL,
                     authState->lastChallenge);
    }
    else
    {
      (void)snprintf(response,
                     sizeof(response),
                     "AUTH OK %lu CHAL=%08lX\r\n",
                     SERVO_AUTH_WINDOW_MS / 1000UL,
                     authState->lastChallenge);
    }
    ServoControl_SendText(channel, response);
    ServoControl_DebugPrint("DBG auth success on %s, window=%lums mode=%u\r\n",
                            channel->name,
                            SERVO_AUTH_WINDOW_MS,
                            (uint8_t)mode);
    return 1U;
  }

  ServoControl_ClearAuthorization(authState);
  authState->expiredLatched = 0U;
  if (authState->failureCount < 255U)
  {
    authState->failureCount++;
  }

  ServoControl_DebugPrint("DBG auth fail on %s, count=%u\r\n", channel->name, authState->failureCount);

  if (authState->failureCount >= SERVO_AUTH_MAX_FAILURES)
  {
    authState->lockoutTick = nowTick + SERVO_AUTH_LOCKOUT_MS;
    (void)snprintf(response, sizeof(response), "AUTH LOCKED %lu\r\n", SERVO_AUTH_LOCKOUT_MS / 1000UL);
    ServoControl_SendText(channel, response);
    ServoControl_DebugPrint("DBG auth lockout on %s\r\n", channel->name);
    return 0U;
  }

  (void)snprintf(response, sizeof(response), "AUTH FAIL %u\r\n", authState->failureCount);
  ServoControl_SendText(channel, response);
  return 0U;
}

static void ServoControl_HandlePinCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed)
{
  (void)ServoControl_HandlePinAuthorization(channel,
                                            parsed->pin,
                                            SERVO_AUTH_MODE_MANUAL,
                                            NULL,
                                            0U,
                                            parsed->mac);
}

static void ServoControl_HandleTrustedPinCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed)
{
  char response[40];
  uint32_t nowTick;
  uint32_t remainingSeconds = 0U;
  ServoAuthState *authState;
  uint32_t trustedKeyHash;

  authState = ServoControl_GetAuthState(channel);
  nowTick = HAL_GetTick();
  if (ServoControl_IsLockoutActive(authState, nowTick, &remainingSeconds) != 0U)
  {
    (void)snprintf(response, sizeof(response), "AUTH LOCKED %lu\r\n", remainingSeconds);
    ServoControl_SendText(channel, response);
    return;
  }

  if (ServoControl_IsTrustedFieldSafe(parsed->clientId) == 0U)
  {
    ServoControl_SendText(channel, "TPIN DENY UNKNOWN_CLIENT\r\n");
    return;
  }

  if (LockConfig_FindPhone(&servoConfig, parsed->clientId) < 0)
  {
    ServoControl_SendText(channel, "TPIN DENY UNKNOWN_CLIENT\r\n");
    return;
  }

  if (parsed->pin[0] == '\0')
  {
    if (ServoControl_ReadTrustedKeyHash(parsed->clientId, &trustedKeyHash) == 0U)
    {
      ServoControl_SendText(channel, "TPIN DENY UNKNOWN_CLIENT\r\n");
      return;
    }

    if (ServoControl_VerifyBleProof(channel,
                                    authState,
                                    trustedKeyHash,
                                    "TPIN",
                                    parsed->clientId,
                                    NULL,
                                    NULL,
                                    parsed->mac) == 0U)
    {
      ServoControl_SendText(channel, "TPIN DENY UNKNOWN_CLIENT\r\n");
      return;
    }

    ServoControl_RefreshAuthorization(authState, SERVO_AUTH_MODE_TRUSTED, parsed->clientId);
    authState->sessionKeyHash = trustedKeyHash;
    ServoControl_AppendChallenge(channel);
    (void)snprintf(response,
                   sizeof(response),
                   "TPIN OK %lu CHAL=%08lX\r\n",
                   SERVO_AUTH_WINDOW_MS / 1000UL,
                   authState->lastChallenge);
    ServoControl_SendText(channel, response);
    return;
  }

  (void)ServoControl_HandlePinAuthorization(channel,
                                            parsed->pin,
                                            SERVO_AUTH_MODE_TRUSTED,
                                            parsed->clientId,
                                            1U,
                                            parsed->mac);
}

static void ServoControl_HandlePinSetCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed)
{
  char previousPin[sizeof(servoConfig.pin)];
  char response[48];
  uint8_t pinWasProvisioned;
  ServoAuthState *authState;

  pinWasProvisioned = ServoControl_IsProvisioned();
  authState = ServoControl_GetAuthState(channel);

  if (pinWasProvisioned == 0U)
  {
    if ((strcmp(parsed->pin, servoPinSetInitToken) != 0) ||
        (ServoControl_IsProvisionWindowOpen(channel) == 0U))
    {
      ServoControl_SendText(channel, "PINSET INIT REQUIRED\r\n");
      return;
    }
  }
  else
  {
    if ((ServoControl_IsAuthorized(authState) == 0U) || (authState->mode != SERVO_AUTH_MODE_MANUAL))
    {
      ServoControl_SendText(channel, "PINSET FAIL\r\n");
      return;
    }

    if (strcmp(parsed->pin, servoConfig.pin) != 0)
    {
      ServoControl_SendText(channel, "PINSET FAIL\r\n");
      return;
    }

    if (ServoControl_VerifyBleProof(channel,
                                    authState,
                                    authState->sessionKeyHash,
                                    "PINSET",
                                    parsed->pin,
                                    parsed->newPin,
                                    NULL,
                                    parsed->mac) == 0U)
    {
      ServoControl_ClearAuthorization(authState);
      ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
      return;
    }
  }

  if (strcmp(parsed->newPin, servoPinSetInitToken) == 0)
  {
    ServoControl_SendText(channel, "PINSET FAIL\r\n");
    return;
  }

  strcpy(previousPin, servoConfig.pin);
  strcpy(servoConfig.pin, parsed->newPin);
  if (LockConfig_Save(&servoConfig) == HAL_OK)
  {
    ServoControl_AppendChallenge(channel);
    (void)snprintf(response, sizeof(response), "PINSET OK CHAL=%08lX\r\n", authState->lastChallenge);
    ServoControl_SendText(channel, response);
    if (pinWasProvisioned == 0U)
    {
      ServoControl_ClearAuthorization(authState);
      servoProvisionUnlockTick = 0U;
    }
  }
  else
  {
    strcpy(servoConfig.pin, previousPin);
    ServoControl_SendText(channel, "PINSET FAIL\r\n");
  }
}

static void ServoControl_HandleBindCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed)
{
  LockConfigData previousConfig;
  char response[40];
  ServoAuthState *authState;

  authState = ServoControl_GetAuthState(channel);

  if ((ServoControl_IsAuthorized(authState) == 0U) || (authState->mode != SERVO_AUTH_MODE_MANUAL))
  {
    ServoControl_SendText(channel, "BIND FAIL\r\n");
    return;
  }

  if ((ServoControl_IsTrustedFieldSafe(parsed->clientId) == 0U) ||
      (ServoControl_IsTrustedFieldSafe(parsed->clientKey) == 0U) ||
      (ServoControl_IsTrustedFieldSafe(parsed->nickname) == 0U))
  {
    ServoControl_SendText(channel, "BIND FAIL\r\n");
    return;
  }

  if (ServoControl_VerifyBleProof(channel,
                                  authState,
                                  authState->sessionKeyHash,
                                  "BIND",
                                  parsed->clientId,
                                  parsed->clientKey,
                                  parsed->nickname,
                                  parsed->mac) == 0U)
  {
    ServoControl_ClearAuthorization(authState);
    ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
    return;
  }

  memcpy(&previousConfig, &servoConfig, sizeof(previousConfig));
  if (LockConfig_UpsertPhone(&servoConfig, parsed->clientId, parsed->clientKey, parsed->nickname, NULL) == 0U)
  {
    ServoControl_SendText(channel, "BIND FAIL\r\n");
    return;
  }

  if (LockConfig_Save(&servoConfig) == HAL_OK)
  {
    ServoControl_AppendChallenge(channel);
    (void)snprintf(response, sizeof(response), "BIND OK CHAL=%08lX\r\n", authState->lastChallenge);
    ServoControl_SendText(channel, response);
  }
  else
  {
    memcpy(&servoConfig, &previousConfig, sizeof(servoConfig));
    ServoControl_SendText(channel, "BIND FAIL\r\n");
  }
}

static void ServoControl_HandleUnbindCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed)
{
  LockConfigData previousConfig;
  char response[40];
  ServoAuthState *authState;

  authState = ServoControl_GetAuthState(channel);

  if ((ServoControl_IsAuthorized(authState) == 0U) || (authState->mode != SERVO_AUTH_MODE_MANUAL))
  {
    ServoControl_SendText(channel, "UNBIND FAIL\r\n");
    return;
  }

  if (ServoControl_IsTrustedFieldSafe(parsed->clientId) == 0U)
  {
    ServoControl_SendText(channel, "UNBIND FAIL\r\n");
    return;
  }

  if (ServoControl_VerifyBleProof(channel,
                                  authState,
                                  authState->sessionKeyHash,
                                  "UNBIND",
                                  parsed->clientId,
                                  NULL,
                                  NULL,
                                  parsed->mac) == 0U)
  {
    ServoControl_ClearAuthorization(authState);
    ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
    return;
  }

  memcpy(&previousConfig, &servoConfig, sizeof(previousConfig));
  if (LockConfig_RemovePhone(&servoConfig, parsed->clientId) == 0U)
  {
    ServoControl_SendText(channel, "UNBIND FAIL\r\n");
    return;
  }

  if (LockConfig_Save(&servoConfig) == HAL_OK)
  {
    ServoControl_AppendChallenge(channel);
    (void)snprintf(response, sizeof(response), "UNBIND OK CHAL=%08lX\r\n", authState->lastChallenge);
    ServoControl_SendText(channel, response);
  }
  else
  {
    memcpy(&servoConfig, &previousConfig, sizeof(servoConfig));
    ServoControl_SendText(channel, "UNBIND FAIL\r\n");
  }
}

static void ServoControl_HandleTrustListCommand(ServoUartChannel *channel)
{
  char response[384];
  uint32_t offset;
  uint8_t index;
  uint8_t hasAny = 0U;
  int length;
  ServoAuthState *authState;

  authState = ServoControl_GetAuthState(channel);

  if (ServoControl_IsAuthorized(authState) == 0U)
  {
    if ((authState->expiredPending != 0U) || (authState->expiredLatched != 0U))
    {
      authState->expiredPending = 0U;
      authState->expiredLatched = 0U;
      ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
    }
    else
    {
      ServoControl_SendText(channel, "DENY AUTH REQUIRED\r\n");
    }
    return;
  }

  strcpy(response, "TRUST LIST");
  offset = strlen(response);

  for (index = 0U; index < LOCK_MAX_TRUSTED_PHONES; index++)
  {
    if (servoConfig.phones[index].enabled == 0U)
    {
      continue;
    }

    if ((ServoControl_IsTrustedFieldSafe(servoConfig.phones[index].clientId) == 0U) ||
        (ServoControl_IsTrustedFieldSafe(servoConfig.phones[index].clientKey) == 0U) ||
        (ServoControl_IsTrustedFieldSafe(servoConfig.phones[index].nickname) == 0U))
    {
      continue;
    }

    length = snprintf(&response[offset],
                      sizeof(response) - offset,
                      "%s%s|%s|%s|1",
                      (hasAny != 0U) ? ";" : " ",
                      servoConfig.phones[index].clientId,
                      servoConfig.phones[index].clientKey,
                      servoConfig.phones[index].nickname);
    if ((length <= 0) || ((uint32_t)length >= (sizeof(response) - offset)))
    {
      break;
    }

    offset += (uint32_t)length;
    hasAny = 1U;
  }

  if ((sizeof(response) - offset) > 2U)
  {
    response[offset++] = '\r';
    response[offset++] = '\n';
    response[offset] = '\0';
  }
  else
  {
    strcpy(response, "TRUST LIST\r\n");
  }

  ServoControl_SendText(channel, response);
}

static void ServoControl_HandleRelockCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed)
{
  LockConfigData previousConfig;
  char response[40];
  ServoAuthState *authState;

  authState = ServoControl_GetAuthState(channel);

  if ((ServoControl_IsAuthorized(authState) == 0U) || (authState->mode != SERVO_AUTH_MODE_MANUAL))
  {
    ServoControl_SendText(channel, "RELOCK FAIL\r\n");
    return;
  }

  if (ServoControl_VerifyBleProof(channel,
                                  authState,
                                  authState->sessionKeyHash,
                                  "RELOCK",
                                  parsed->relockSeconds == 3U ? "3" :
                                  parsed->relockSeconds == 5U ? "5" :
                                  parsed->relockSeconds == 8U ? "8" : "10",
                                  NULL,
                                  NULL,
                                  parsed->mac) == 0U)
  {
    ServoControl_ClearAuthorization(authState);
    ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
    return;
  }

  memcpy(&previousConfig, &servoConfig, sizeof(previousConfig));
  servoConfig.relockSeconds = parsed->relockSeconds;
  if (LockConfig_Save(&servoConfig) == HAL_OK)
  {
    ServoControl_AppendChallenge(channel);
    (void)snprintf(response, sizeof(response), "RELOCK OK CHAL=%08lX\r\n", authState->lastChallenge);
    ServoControl_SendText(channel, response);
  }
  else
  {
    memcpy(&servoConfig, &previousConfig, sizeof(servoConfig));
    ServoControl_SendText(channel, "RELOCK FAIL\r\n");
  }
}

static void ServoControl_HandleActionCommand(ServoUartChannel *channel, const ServoParsedCommand *parsed)
{
  ServoAuthState *authState;
  char proofPayload[8];
  char response[40];

  authState = ServoControl_GetAuthState(channel);

  if (ServoControl_IsAuthorized(authState) == 0U)
  {
    if ((authState->expiredPending != 0U) || (authState->expiredLatched != 0U))
    {
      authState->expiredPending = 0U;
      authState->expiredLatched = 0U;
      ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
    }
    else
    {
      ServoControl_SendText(channel, "DENY AUTH REQUIRED\r\n");
    }
    return;
  }

  switch (parsed->type)
  {
    case SERVO_COMMAND_LOCK:
      if (ServoControl_VerifyBleProof(channel,
                                      authState,
                                      authState->sessionKeyHash,
                                      "LOCK",
                                      NULL,
                                      NULL,
                                      NULL,
                                      parsed->mac) == 0U)
      {
        ServoControl_ClearAuthorization(authState);
        ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
        return;
      }
      ServoControl_CancelRelock();
      ServoControl_SetLockedState(0U);
      ServoControl_AppendChallenge(channel);
      (void)snprintf(response, sizeof(response), "ACTION OK LOCK CHAL=%08lX\r\n", authState->lastChallenge);
      ServoControl_SendText(channel, response);
      ServoControl_DebugPrint("DBG lock accepted\r\n");
      break;

    case SERVO_COMMAND_UNLOCK:
      if (ServoControl_VerifyBleProof(channel,
                                      authState,
                                      authState->sessionKeyHash,
                                      "UNLOCK",
                                      NULL,
                                      NULL,
                                      NULL,
                                      parsed->mac) == 0U)
      {
        ServoControl_ClearAuthorization(authState);
        ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
        return;
      }
      ServoControl_SetLockedState(1U);
      ServoControl_ArmRelock(servoConfig.relockSeconds);
      ServoControl_AppendChallenge(channel);
      (void)snprintf(response, sizeof(response), "ACTION OK UNLOCK CHAL=%08lX\r\n", authState->lastChallenge);
      ServoControl_SendText(channel, response);
      ServoControl_DebugPrint("DBG unlock accepted\r\n");
      break;

    case SERVO_COMMAND_ANGLE:
      (void)snprintf(proofPayload, sizeof(proofPayload), "A%u", parsed->angle);
      if (ServoControl_VerifyBleProof(channel,
                                      authState,
                                      authState->sessionKeyHash,
                                      proofPayload,
                                      NULL,
                                      NULL,
                                      NULL,
                                      parsed->mac) == 0U)
      {
        ServoControl_ClearAuthorization(authState);
        ServoControl_SendText(channel, "DENY AUTH EXPIRED\r\n");
        return;
      }
      ServoControl_SetAngle(parsed->angle);
      if (parsed->angle == SERVO_LOCK_ANGLE)
      {
        servoLockIsUnlocked = 0U;
        ServoControl_CancelRelock();
      }
      else if (parsed->angle == SERVO_UNLOCK_ANGLE)
      {
        servoLockIsUnlocked = 1U;
        ServoControl_ArmRelock(servoConfig.relockSeconds);
      }
      else
      {
        servoLockIsUnlocked = 0U;
        ServoControl_CancelRelock();
      }
      ServoControl_AppendChallenge(channel);
      (void)snprintf(response, sizeof(response), "ACTION OK ANGLE CHAL=%08lX\r\n", authState->lastChallenge);
      ServoControl_SendText(channel, response);
      ServoControl_DebugPrint("DBG angle accepted=%u\r\n", parsed->angle);
      break;

    default:
      ServoControl_SendText(channel, "ERROR COMMAND\r\n");
      break;
  }
}

static void ServoControl_SendStatus(ServoUartChannel *channel)
{
  char response[96];
  ServoAuthState *authState;
  uint8_t authActive;
  uint8_t provisioned = ServoControl_IsProvisioned();
  uint32_t nowTick = HAL_GetTick();
  uint32_t lockoutSeconds = 0U;

  authState = ServoControl_GetAuthState(channel);
  authActive = ServoControl_IsAuthorized(authState);
  ServoControl_AppendChallenge(channel);

  if (ServoControl_IsLockoutActive(authState, nowTick, &lockoutSeconds) != 0U)
  {
    (void)snprintf(response,
                   sizeof(response),
                   "STATUS %s AUTH=%u LOCKOUT=%lu ANGLE=%u REL=%u PROV=%u CHAL=%08lX\r\n",
                   (servoLockIsUnlocked != 0U) ? "UNLOCK" : "LOCK",
                   authActive,
                   lockoutSeconds,
                   servoCurrentAngle,
                   servoConfig.relockSeconds,
                   provisioned,
                   authState->lastChallenge);
    ServoControl_SendText(channel, response);
    return;
  }

  if (authActive != 0U)
  {
    uint32_t authSeconds = 0U;
    if ((int32_t)(authState->expiresTick - nowTick) > 0)
    {
      authSeconds = (authState->expiresTick - nowTick + 999U) / 1000U;
    }

    (void)snprintf(response,
                   sizeof(response),
                   "STATUS %s AUTH=%u WINDOW=%lu ANGLE=%u REL=%u PROV=%u CHAL=%08lX\r\n",
                   (servoLockIsUnlocked != 0U) ? "UNLOCK" : "LOCK",
                   authActive,
                   authSeconds,
                   servoCurrentAngle,
                   servoConfig.relockSeconds,
                   provisioned,
                   authState->lastChallenge);
  }
  else
  {
    (void)snprintf(response,
                   sizeof(response),
                   "STATUS %s AUTH=%u ANGLE=%u REL=%u PROV=%u CHAL=%08lX\r\n",
                   (servoLockIsUnlocked != 0U) ? "UNLOCK" : "LOCK",
                   authActive,
                   servoCurrentAngle,
                   servoConfig.relockSeconds,
                   provisioned,
                   authState->lastChallenge);
  }

  ServoControl_SendText(channel, response);
}

static void ServoControl_SetLockedState(uint8_t unlockRequested)
{
  if (unlockRequested != 0U)
  {
    servoLockIsUnlocked = 1U;
    ServoControl_SetAngle(SERVO_UNLOCK_ANGLE);
  }
  else
  {
    servoLockIsUnlocked = 0U;
    ServoControl_SetAngle(SERVO_LOCK_ANGLE);
  }
}

static void ServoControl_DrainQueuedErrors(ServoUartChannel *channel)
{
  uint8_t sendError = 0U;

  __disable_irq();
  if (channel->queuedErrorCount > 0U)
  {
    channel->queuedErrorCount--;
    sendError = 1U;
  }
  __enable_irq();

  if (sendError != 0U)
  {
    ServoControl_SendText(channel, "ERROR COMMAND\r\n");
  }
}

static void ServoControl_SendText(ServoUartChannel *channel, const char *text)
{
  uint16_t length;
  uint32_t timeoutMs;

  if ((channel == NULL) || (channel->huart == NULL) || (text == NULL))
  {
    return;
  }

  length = (uint16_t)strlen(text);
  timeoutMs = ServoControl_GetTxTimeoutMs(channel->huart, length, SERVO_UART_TX_TIMEOUT_MS);
  (void)HAL_UART_Transmit(channel->huart, (const uint8_t *)text, length, timeoutMs);
}

static void ServoControl_StartReception(ServoUartChannel *channel)
{
  if (HAL_UART_Receive_IT(channel->huart, &channel->rxByte, 1U) != HAL_OK)
  {
    Error_Handler();
  }
}

static void ServoControl_DebugPrint(const char *format, ...)
{
#if (SERVO_DEBUG_LOGGING_ENABLED != 0U)
  char buffer[128];
  va_list args;
  int length;
  uint32_t timeoutMs;

  if (servoDebugUart == NULL)
  {
    return;
  }

  va_start(args, format);
  length = vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);

  if (length <= 0)
  {
    return;
  }

  if ((size_t)length >= sizeof(buffer))
  {
    length = (int)(sizeof(buffer) - 1U);
  }

  timeoutMs = ServoControl_GetTxTimeoutMs(servoDebugUart, (uint16_t)length, SERVO_DEBUG_UART_TX_TIMEOUT_MS);
  (void)HAL_UART_Transmit(servoDebugUart, (const uint8_t *)buffer, (uint16_t)length, timeoutMs);
#else
  (void)format;
#endif
}

static uint8_t ServoControl_TryParseAngle(const char *command, ServoParsedCommand *parsed)
{
  uint16_t value = 0U;
  uint8_t hasDigit = 0U;
  const char *cursor;

  if (parsed == NULL)
  {
    return 0U;
  }

  cursor = command;

  while ((*cursor == ' ') || (*cursor == '\t'))
  {
    cursor++;
  }

  if (*cursor != 'A')
  {
    return 0U;
  }

  cursor++;

  while ((*cursor >= '0') && (*cursor <= '9'))
  {
    value = (uint16_t)((value * 10U) + (uint16_t)(*cursor - '0'));
    if (value > 180U)
    {
      return 0U;
    }
    cursor++;
    hasDigit = 1U;
  }

  while ((*cursor == ' ') || (*cursor == '\t'))
  {
    cursor++;
  }

  if (hasDigit == 0U)
  {
    return 0U;
  }

  if (*cursor != '\0')
  {
    const char *macCursor = cursor;
    if ((ServoControl_ReadToken(&macCursor, parsed->mac, sizeof(parsed->mac)) == 0U) ||
        (ServoControl_ReadToken(&macCursor, parsed->clientId, sizeof(parsed->clientId)) != 0U))
    {
      return 0U;
    }
  }

  parsed->type = SERVO_COMMAND_ANGLE;
  parsed->angle = (uint8_t)value;
  return 1U;
}

static void ServoControl_SetAngle(uint8_t angle)
{
  uint16_t pulse;

  if (angle > 180U)
  {
    angle = 180U;
  }

  servoCurrentAngle = angle;
  pulse = 50U + ((uint16_t)angle * 200U) / 180U;
  ServoControl_DebugPrint("DBG set angle=%u pulse=%u\r\n", angle, pulse);
  if (servoServoPulseActive == 0U)
  {
    if (HAL_TIM_PWM_Start(servoTim, servoTimChannel) == HAL_OK)
    {
      servoServoPulseActive = 1U;
    }
  }
  __HAL_TIM_SET_COMPARE(servoTim, servoTimChannel, pulse);
  servoServoPulseReleaseTick = HAL_GetTick() + SERVO_SERVO_HOLD_MS;
}

static void ServoControl_ArmRelock(uint8_t seconds)
{
  servoRelockArmed = 1U;
  servoRelockDeadlineTick = HAL_GetTick() + ((uint32_t)seconds * 1000UL);
}

static void ServoControl_CancelRelock(void)
{
  servoRelockArmed = 0U;
  servoRelockDeadlineTick = 0U;
}

static void ServoControl_SkipWhitespace(const char **cursor)
{
  while ((cursor != NULL) && (*cursor != NULL) &&
         ((**cursor == ' ') || (**cursor == '\t')))
  {
    (*cursor)++;
  }
}

static uint8_t ServoControl_ReadToken(const char **cursor, char *destination, uint32_t capacity)
{
  uint32_t length = 0U;
  const char *localCursor;

  if ((cursor == NULL) || (*cursor == NULL) || (destination == NULL) || (capacity == 0U))
  {
    return 0U;
  }

  localCursor = *cursor;
  ServoControl_SkipWhitespace(&localCursor);

  while ((*localCursor != '\0') && (*localCursor != ' ') && (*localCursor != '\t'))
  {
    if (length >= (capacity - 1U))
    {
      return 0U;
    }
    destination[length++] = *localCursor++;
  }

  if (length == 0U)
  {
    return 0U;
  }

  destination[length] = '\0';
  *cursor = localCursor;
  ServoControl_SkipWhitespace(cursor);
  return 1U;
}

static uint8_t ServoControl_IsRelockSecondsAllowed(uint8_t seconds)
{
  if ((seconds == 3U) || (seconds == 5U) || (seconds == 8U) || (seconds == 10U))
  {
    return 1U;
  }
  return 0U;
}

static uint8_t ServoControl_IsTrustedFieldSafe(const char *value)
{
  const char *cursor;

  if (value == NULL)
  {
    return 0U;
  }

  cursor = value;
  while (*cursor != '\0')
  {
    if ((*cursor == '|') ||
        (*cursor == ';') ||
        (*cursor == '\r') ||
        (*cursor == '\n'))
    {
      return 0U;
    }
    cursor++;
  }

  return 1U;
}

static uint8_t ServoControl_SanitizeTrustedRecords(void)
{
  uint8_t index;
  uint8_t changed = 0U;

  for (index = 0U; index < LOCK_MAX_TRUSTED_PHONES; index++)
  {
    if (servoConfig.phones[index].enabled == 0U)
    {
      continue;
    }

    if ((ServoControl_IsTrustedFieldSafe(servoConfig.phones[index].clientId) == 0U) ||
        (ServoControl_IsTrustedFieldSafe(servoConfig.phones[index].nickname) == 0U))
    {
      memset(&servoConfig.phones[index], 0, sizeof(servoConfig.phones[index]));
      changed = 1U;
    }
  }

  return changed;
}
