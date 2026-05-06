#include "lock_config.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

typedef struct
{
  uint32_t magic;
  uint16_t version;
  uint32_t sequence;
  uint32_t checksum;
  LockConfigData data;
} LockConfigImage;

typedef struct
{
  uint8_t enabled;
  char clientId[LOCK_MAX_CLIENT_ID_LENGTH + 1U];
  char nickname[LOCK_MAX_NICKNAME_LENGTH + 1U];
} LockTrustedPhoneRecordV2;

typedef struct
{
  char pin[LOCK_MAX_PIN_LENGTH + 1U];
  uint8_t relockSeconds;
  LockTrustedPhoneRecordV2 phones[LOCK_MAX_TRUSTED_PHONES];
} LockConfigDataV2;

typedef struct
{
  uint32_t magic;
  uint16_t version;
  uint32_t sequence;
  uint32_t checksum;
  LockConfigDataV2 data;
} LockConfigImageV2;

static uint32_t LockConfig_ComputeChecksum(const LockConfigImage *image);
static uint8_t LockConfig_IsImageValid(const LockConfigImage *image);
static uint32_t LockConfig_ComputeChecksumV2(const LockConfigImageV2 *image);
static uint8_t LockConfig_IsImageValidV2(const LockConfigImageV2 *image);
static HAL_StatusTypeDef LockConfig_WritePage(uint32_t pageAddress, const LockConfigImage *image);
static const LockConfigImage *LockConfig_SelectImage(void);
static const LockConfigImageV2 *LockConfig_SelectImageV2(void);
static uint32_t LockConfig_GetNextSequence(void);
static uint8_t LockConfig_IsStoredStringValid(const char *value, uint32_t maxLength);
static uint8_t LockConfig_IsDataValid(const LockConfigData *config);
static uint8_t LockConfig_IsDataValidV2(const LockConfigDataV2 *config);
static uint8_t LockConfig_IsPinValid(const char *pin);
static uint8_t LockConfig_IsPinUnset(const char *pin);
static uint8_t LockConfig_IsRelockValueValid(uint8_t relockSeconds);
static uint8_t LockConfig_CopyString(char *destination, uint32_t capacity, const char *source);
static uint8_t LockConfig_MigrateFromV2(LockConfigData *destination, const LockConfigDataV2 *source);

void LockConfig_SetDefaults(LockConfigData *config)
{
  if (config == NULL)
  {
    return;
  }

  memset(config, 0, sizeof(*config));
  (void)LockConfig_CopyString(config->pin, sizeof(config->pin), "123456");
  config->relockSeconds = 5U;
}

uint8_t LockConfig_Load(LockConfigData *config)
{
  const LockConfigImage *selected;
  const LockConfigImageV2 *selectedV2;

  if (config == NULL)
  {
    return 0U;
  }

  selected = LockConfig_SelectImage();
  if (selected == NULL)
  {
    selectedV2 = LockConfig_SelectImageV2();
    if (selectedV2 == NULL)
    {
      LockConfig_SetDefaults(config);
      return 0U;
    }

    if (LockConfig_MigrateFromV2(config, &selectedV2->data) != 0U)
    {
      return 1U;
    }

    LockConfig_SetDefaults(config);
    return 0U;
  }

  memcpy(config, &selected->data, sizeof(*config));
  if (LockConfig_HasPin(config) == 0U)
  {
    (void)LockConfig_CopyString(config->pin, sizeof(config->pin), "123456");
  }
  return 1U;
}

HAL_StatusTypeDef LockConfig_Save(const LockConfigData *config)
{
  const LockConfigImage *selected;
  LockConfigImage image;
  uint32_t targetPageAddress;

  if (LockConfig_IsDataValid(config) == 0U)
  {
    return HAL_ERROR;
  }

  memset(&image, 0, sizeof(image));
  image.magic = LOCK_CONFIG_MAGIC;
  image.version = LOCK_CONFIG_VERSION;
  image.sequence = LockConfig_GetNextSequence();
  memcpy(&image.data, config, sizeof(image.data));
  image.checksum = LockConfig_ComputeChecksum(&image);

  selected = LockConfig_SelectImage();
  if (selected == (const LockConfigImage *)(uintptr_t)LOCK_CONFIG_PAGE_A_ADDRESS)
  {
    targetPageAddress = LOCK_CONFIG_PAGE_B_ADDRESS;
  }
  else
  {
    targetPageAddress = LOCK_CONFIG_PAGE_A_ADDRESS;
  }

  return LockConfig_WritePage(targetPageAddress, &image);
}

uint8_t LockConfig_HasPin(const LockConfigData *config)
{
  if (config == NULL)
  {
    return 0U;
  }

  return (LockConfig_IsPinUnset(config->pin) == 0U) ? 1U : 0U;
}

int8_t LockConfig_FindPhone(const LockConfigData *config, const char *clientId)
{
  uint8_t index;

  if ((config == NULL) || (clientId == NULL) || (clientId[0] == '\0'))
  {
    return -1;
  }

  for (index = 0U; index < LOCK_MAX_TRUSTED_PHONES; index++)
  {
    if ((config->phones[index].enabled != 0U) &&
        (strcmp(config->phones[index].clientId, clientId) == 0))
    {
      return (int8_t)index;
    }
  }

  return -1;
}

uint8_t LockConfig_UpsertPhone(LockConfigData *config,
                               const char *clientId,
                               const char *clientKey,
                               const char *nickname,
                               uint8_t *slotOut)
{
  int8_t existingIndex;
  int8_t freeIndex;
  uint8_t index;
  uint8_t selectedIndex;

  const char *safeClientKey;

  if ((config == NULL) || (clientId == NULL) || (clientId[0] == '\0'))
  {
    return 0U;
  }

  safeClientKey = clientKey;
  if (nickname == NULL)
  {
    nickname = "";
  }
  if (safeClientKey == NULL)
  {
    safeClientKey = "";
  }

  existingIndex = LockConfig_FindPhone(config, clientId);
  freeIndex = -1;

  for (index = 0U; index < LOCK_MAX_TRUSTED_PHONES; index++)
  {
    if (config->phones[index].enabled == 0U)
    {
      freeIndex = (int8_t)index;
      break;
    }
  }

  if (existingIndex >= 0)
  {
    selectedIndex = (uint8_t)existingIndex;
  }
  else if (freeIndex >= 0)
  {
    selectedIndex = (uint8_t)freeIndex;
  }
  else
  {
    return 0U;
  }

  if (LockConfig_CopyString(config->phones[selectedIndex].clientId,
                            sizeof(config->phones[selectedIndex].clientId),
                            clientId) == 0U)
  {
    return 0U;
  }

  if (LockConfig_CopyString(config->phones[selectedIndex].clientKey,
                            sizeof(config->phones[selectedIndex].clientKey),
                            safeClientKey) == 0U)
  {
    return 0U;
  }

  if (LockConfig_CopyString(config->phones[selectedIndex].nickname,
                            sizeof(config->phones[selectedIndex].nickname),
                            nickname) == 0U)
  {
    return 0U;
  }

  config->phones[selectedIndex].enabled = 1U;

  if (slotOut != NULL)
  {
    *slotOut = selectedIndex;
  }

  return 1U;
}

uint8_t LockConfig_RemovePhone(LockConfigData *config, const char *clientId)
{
  int8_t index;

  if (config == NULL)
  {
    return 0U;
  }

  index = LockConfig_FindPhone(config, clientId);
  if (index < 0)
  {
    return 0U;
  }

  memset(&config->phones[(uint8_t)index], 0, sizeof(config->phones[(uint8_t)index]));
  return 1U;
}

static uint32_t LockConfig_ComputeChecksum(const LockConfigImage *image)
{
  const uint8_t *bytes;
  uint32_t checksum;
  uint32_t index;
  uint32_t checksumOffset;

  bytes = (const uint8_t *)image;
  checksum = 2166136261UL;
  checksumOffset = (uint32_t)offsetof(LockConfigImage, checksum);

  for (index = 0U; index < sizeof(*image); index++)
  {
    if ((index >= checksumOffset) && (index < (checksumOffset + sizeof(image->checksum))))
    {
      continue;
    }

    checksum ^= bytes[index];
    checksum *= 16777619UL;
  }

  return checksum;
}

static uint32_t LockConfig_ComputeChecksumV2(const LockConfigImageV2 *image)
{
  const uint8_t *bytes;
  uint32_t checksum;
  uint32_t index;
  uint32_t checksumOffset;

  bytes = (const uint8_t *)image;
  checksum = 2166136261UL;
  checksumOffset = (uint32_t)offsetof(LockConfigImageV2, checksum);

  for (index = 0U; index < sizeof(*image); index++)
  {
    if ((index >= checksumOffset) && (index < (checksumOffset + sizeof(image->checksum))))
    {
      continue;
    }

    checksum ^= bytes[index];
    checksum *= 16777619UL;
  }

  return checksum;
}

static uint8_t LockConfig_IsImageValid(const LockConfigImage *image)
{
  if (image == NULL)
  {
    return 0U;
  }

  if ((image->magic != LOCK_CONFIG_MAGIC) || (image->version != LOCK_CONFIG_VERSION))
  {
    return 0U;
  }

  if (image->checksum != LockConfig_ComputeChecksum(image))
  {
    return 0U;
  }

  return LockConfig_IsDataValid(&image->data);
}

static uint8_t LockConfig_IsImageValidV2(const LockConfigImageV2 *image)
{
  if (image == NULL)
  {
    return 0U;
  }

  if ((image->magic != LOCK_CONFIG_MAGIC) || (image->version != LOCK_CONFIG_VERSION_V2))
  {
    return 0U;
  }

  if (image->checksum != LockConfig_ComputeChecksumV2(image))
  {
    return 0U;
  }

  return LockConfig_IsDataValidV2(&image->data);
}

static HAL_StatusTypeDef LockConfig_WritePage(uint32_t pageAddress, const LockConfigImage *image)
{
  HAL_StatusTypeDef status;
  FLASH_EraseInitTypeDef eraseInit;
  uint32_t pageError;
  const uint8_t *imageBytes;
  const LockConfigImage *writtenImage;
  uint32_t offset;
  uint32_t imageSize;
  uint32_t remaining;
  uint32_t copyLength;
  uint32_t wordValue;

  if (image == NULL)
  {
    return HAL_ERROR;
  }

  imageSize = sizeof(*image);
  if (imageSize > FLASH_PAGE_SIZE)
  {
    return HAL_ERROR;
  }

  status = HAL_FLASH_Unlock();
  if (status != HAL_OK)
  {
    return status;
  }

  eraseInit.TypeErase = FLASH_TYPEERASE_PAGES;
  eraseInit.PageAddress = pageAddress;
  eraseInit.NbPages = 1U;
  pageError = 0U;

  status = HAL_FLASHEx_Erase(&eraseInit, &pageError);
  if (status == HAL_OK)
  {
    imageBytes = (const uint8_t *)image;
    writtenImage = (const LockConfigImage *)(uintptr_t)pageAddress;

    for (offset = 0U; offset < imageSize; offset += sizeof(uint32_t))
    {
      wordValue = 0xFFFFFFFFUL;
      remaining = imageSize - offset;
      copyLength = (remaining < sizeof(uint32_t)) ? remaining : (uint32_t)sizeof(uint32_t);
      memcpy(&wordValue, &imageBytes[offset], copyLength);

      status = HAL_FLASH_Program(FLASH_TYPEPROGRAM_WORD, pageAddress + offset, wordValue);
      if (status != HAL_OK)
      {
        break;
      }
    }
  }

  (void)HAL_FLASH_Lock();
  if (status == HAL_OK)
  {
    if ((memcmp((const void *)writtenImage, image, imageSize) != 0) ||
        (LockConfig_IsImageValid(writtenImage) == 0U))
    {
      return HAL_ERROR;
    }
  }

  return status;
}

static const LockConfigImage *LockConfig_SelectImage(void)
{
  const LockConfigImage *pageA;
  const LockConfigImage *pageB;
  uint8_t pageAValid;
  uint8_t pageBValid;

  pageA = (const LockConfigImage *)(uintptr_t)LOCK_CONFIG_PAGE_A_ADDRESS;
  pageB = (const LockConfigImage *)(uintptr_t)LOCK_CONFIG_PAGE_B_ADDRESS;
  pageAValid = LockConfig_IsImageValid(pageA);
  pageBValid = LockConfig_IsImageValid(pageB);

  if ((pageAValid != 0U) && (pageBValid != 0U))
  {
    return (pageA->sequence >= pageB->sequence) ? pageA : pageB;
  }
  else if (pageAValid != 0U)
  {
    return pageA;
  }
  else if (pageBValid != 0U)
  {
    return pageB;
  }

  return NULL;
}

static const LockConfigImageV2 *LockConfig_SelectImageV2(void)
{
  const LockConfigImageV2 *pageA;
  const LockConfigImageV2 *pageB;
  uint8_t pageAValid;
  uint8_t pageBValid;

  pageA = (const LockConfigImageV2 *)(uintptr_t)LOCK_CONFIG_PAGE_A_ADDRESS;
  pageB = (const LockConfigImageV2 *)(uintptr_t)LOCK_CONFIG_PAGE_B_ADDRESS;
  pageAValid = LockConfig_IsImageValidV2(pageA);
  pageBValid = LockConfig_IsImageValidV2(pageB);

  if ((pageAValid != 0U) && (pageBValid != 0U))
  {
    return (pageA->sequence >= pageB->sequence) ? pageA : pageB;
  }
  else if (pageAValid != 0U)
  {
    return pageA;
  }
  else if (pageBValid != 0U)
  {
    return pageB;
  }

  return NULL;
}

static uint32_t LockConfig_GetNextSequence(void)
{
  const LockConfigImage *selected;

  selected = LockConfig_SelectImage();
  if (selected == NULL)
  {
    return 0U;
  }

  return selected->sequence + 1U;
}

static uint8_t LockConfig_IsStoredStringValid(const char *value, uint32_t maxLength)
{
  uint32_t index;

  if (value == NULL)
  {
    return 0U;
  }

  for (index = 0U; index <= maxLength; index++)
  {
    if (value[index] == '\0')
    {
      return 1U;
    }
  }

  return 0U;
}

static uint8_t LockConfig_IsDataValid(const LockConfigData *config)
{
  uint8_t index;

  if (config == NULL)
  {
    return 0U;
  }

  if ((LockConfig_IsPinValid(config->pin) == 0U) &&
      (LockConfig_IsPinUnset(config->pin) == 0U))
  {
    return 0U;
  }

  if (LockConfig_IsRelockValueValid(config->relockSeconds) == 0U)
  {
    return 0U;
  }

  for (index = 0U; index < LOCK_MAX_TRUSTED_PHONES; index++)
  {
    if ((config->phones[index].enabled != 0U) &&
        (config->phones[index].enabled != 1U))
    {
      return 0U;
    }

    if (config->phones[index].enabled != 0U)
    {
      if (config->phones[index].clientId[0] == '\0')
      {
        return 0U;
      }

      if (LockConfig_IsStoredStringValid(config->phones[index].clientId,
                                         LOCK_MAX_CLIENT_ID_LENGTH) == 0U)
      {
        return 0U;
      }

      if (LockConfig_IsStoredStringValid(config->phones[index].clientKey,
                                         LOCK_MAX_CLIENT_KEY_LENGTH) == 0U)
      {
        return 0U;
      }

      if (config->phones[index].clientKey[0] == '\0')
      {
        return 0U;
      }

      if (LockConfig_IsStoredStringValid(config->phones[index].nickname,
                                         LOCK_MAX_NICKNAME_LENGTH) == 0U)
      {
        return 0U;
      }
    }
  }

  return 1U;
}

static uint8_t LockConfig_IsDataValidV2(const LockConfigDataV2 *config)
{
  uint8_t index;

  if (config == NULL)
  {
    return 0U;
  }

  if ((LockConfig_IsPinValid(config->pin) == 0U) &&
      (LockConfig_IsPinUnset(config->pin) == 0U))
  {
    return 0U;
  }

  if (LockConfig_IsRelockValueValid(config->relockSeconds) == 0U)
  {
    return 0U;
  }

  for (index = 0U; index < LOCK_MAX_TRUSTED_PHONES; index++)
  {
    if ((config->phones[index].enabled != 0U) &&
        (config->phones[index].enabled != 1U))
    {
      return 0U;
    }

    if (config->phones[index].enabled != 0U)
    {
      if (config->phones[index].clientId[0] == '\0')
      {
        return 0U;
      }

      if (LockConfig_IsStoredStringValid(config->phones[index].clientId,
                                         LOCK_MAX_CLIENT_ID_LENGTH) == 0U)
      {
        return 0U;
      }

      if (LockConfig_IsStoredStringValid(config->phones[index].nickname,
                                         LOCK_MAX_NICKNAME_LENGTH) == 0U)
      {
        return 0U;
      }
    }
  }

  return 1U;
}

static uint8_t LockConfig_IsPinValid(const char *pin)
{
  uint32_t length;

  if (LockConfig_IsStoredStringValid(pin, LOCK_MAX_PIN_LENGTH) == 0U)
  {
    return 0U;
  }

  length = 0U;
  while (pin[length] != '\0')
  {
    if ((pin[length] < '0') || (pin[length] > '9'))
    {
      return 0U;
    }

    length++;
  }

  if ((length < 6U) || (length > LOCK_MAX_PIN_LENGTH))
  {
    return 0U;
  }

  return 1U;
}

static uint8_t LockConfig_IsPinUnset(const char *pin)
{
  if (LockConfig_IsStoredStringValid(pin, LOCK_MAX_PIN_LENGTH) == 0U)
  {
    return 0U;
  }

  return (pin[0] == '\0') ? 1U : 0U;
}

static uint8_t LockConfig_IsRelockValueValid(uint8_t relockSeconds)
{
  if ((relockSeconds == 3U) ||
      (relockSeconds == 5U) ||
      (relockSeconds == 8U) ||
      (relockSeconds == 10U))
  {
    return 1U;
  }

  return 0U;
}

static uint8_t LockConfig_CopyString(char *destination, uint32_t capacity, const char *source)
{
  size_t sourceLength;

  if ((destination == NULL) || (source == NULL) || (capacity == 0U))
  {
    return 0U;
  }

  sourceLength = strlen(source);
  if (sourceLength >= capacity)
  {
    return 0U;
  }

  memcpy(destination, source, sourceLength + 1U);
  return 1U;
}

static uint8_t LockConfig_MigrateFromV2(LockConfigData *destination, const LockConfigDataV2 *source)
{
  uint8_t index;

  if ((destination == NULL) || (source == NULL))
  {
    return 0U;
  }

  LockConfig_SetDefaults(destination);
  (void)LockConfig_CopyString(destination->pin, sizeof(destination->pin), source->pin);
  destination->relockSeconds = source->relockSeconds;

  for (index = 0U; index < LOCK_MAX_TRUSTED_PHONES; index++)
  {
    if (source->phones[index].enabled == 0U)
    {
      continue;
    }

    destination->phones[index].enabled = 1U;
    (void)LockConfig_CopyString(destination->phones[index].clientId,
                                sizeof(destination->phones[index].clientId),
                                source->phones[index].clientId);
    (void)LockConfig_CopyString(destination->phones[index].nickname,
                                sizeof(destination->phones[index].nickname),
                                source->phones[index].nickname);
    (void)LockConfig_CopyString(destination->phones[index].clientKey,
                                sizeof(destination->phones[index].clientKey),
                                "LEGACYKEY0000000");
  }

  return (LockConfig_IsDataValid(destination) != 0U) ? 1U : 0U;
}
