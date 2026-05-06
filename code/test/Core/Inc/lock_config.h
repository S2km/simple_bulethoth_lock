#ifndef __LOCK_CONFIG_H__
#define __LOCK_CONFIG_H__

#include "main.h"

#define LOCK_CONFIG_MAGIC                0x4C434647UL
#define LOCK_CONFIG_VERSION_V2           2U
#define LOCK_CONFIG_VERSION              3U
#define LOCK_CONFIG_PAGE_A_ADDRESS       0x0800F800UL
#define LOCK_CONFIG_PAGE_B_ADDRESS       0x0800FC00UL
#define LOCK_MAX_PIN_LENGTH              11U
#define LOCK_MAX_CLIENT_ID_LENGTH        32U
#define LOCK_MAX_CLIENT_KEY_LENGTH       32U
#define LOCK_MAX_NICKNAME_LENGTH         20U
#define LOCK_MAX_TRUSTED_PHONES          5U

typedef struct
{
  uint8_t enabled;
  char clientId[LOCK_MAX_CLIENT_ID_LENGTH + 1U];
  char clientKey[LOCK_MAX_CLIENT_KEY_LENGTH + 1U];
  char nickname[LOCK_MAX_NICKNAME_LENGTH + 1U];
} LockTrustedPhoneRecord;

typedef struct
{
  char pin[LOCK_MAX_PIN_LENGTH + 1U];
  uint8_t relockSeconds;
  LockTrustedPhoneRecord phones[LOCK_MAX_TRUSTED_PHONES];
} LockConfigData;

void LockConfig_SetDefaults(LockConfigData *config);
uint8_t LockConfig_Load(LockConfigData *config);
HAL_StatusTypeDef LockConfig_Save(const LockConfigData *config);
uint8_t LockConfig_HasPin(const LockConfigData *config);
int8_t LockConfig_FindPhone(const LockConfigData *config, const char *clientId);
uint8_t LockConfig_UpsertPhone(LockConfigData *config,
                               const char *clientId,
                               const char *clientKey,
                               const char *nickname,
                               uint8_t *slotOut);
uint8_t LockConfig_RemovePhone(LockConfigData *config, const char *clientId);

#endif
