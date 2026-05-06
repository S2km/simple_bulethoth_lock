import { HC02ServiceUUID, HC02CharacteristicWriteUUID } from '@configs/index'

/**
 * 校验UUID格式
 * @param {String} uuid 
 */
export function checkUUID(uuid) {
  uuid = uuid.trim()
  return /^[0-9a-zA-Z]{4}$/.test(uuid)
  || /^[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}$/.test(uuid)
}

/**
 * 检查是否为beacon设备
 * @param {Device} device
 */
export function checkBeacon(device) {
  const { advertisData } = device
  if (!advertisData) return false
  const uint8Array = new Uint8Array(advertisData)
  return uint8Array[2] === 0x02 && uint8Array[3] === 0x15
}

/**
 * ArrayBuffer 转 Hex字符串
 * @param {ArrayBuffer} buffer 
 */
export function abToHex(buffer) {
  const hexArr = Array.prototype.map.call(
    new Uint8Array(buffer),
    function(bit) {
      return ('00' + bit.toString(16)).slice(-2)
    }
  )
  return hexArr.join('')
}

/**
 * Hex字符串 转 ArrayBuffer
 * @param {String} hex 
 */
export function hexToAb(hex) {
  if (/[^0-9a-fA-F]/g.test(hex)) return // 判断Hex字符串
  const byteLength = Math.floor(hex.length / 2)
  const ab = new ArrayBuffer(byteLength)
  const dv = new DataView(ab)
  let i = 0
  while( i < byteLength ) {
    dv.setUint8(i, Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16))
    i++
  }
  return ab
}

/**
 * 数据分包
 * @param {Buffer} buffer
 * @param {Numer} size 分包Buffer长度，默认 20
 */
export function splitPackage(buffer, size = 20) {
  const packageArray = []
  for(let i = 0; i < buffer.byteLength; i += size){
    packageArray.push(buffer.slice(i, i + size))
  }
  return packageArray
}

/**
 * 将对象转换为query参数
 */
export function transToQuery(obj) {
  const querys = []
  for (let key in obj) {
    querys.push(`${key}=${obj[key]}`)
  }
  return querys.join('&')
}

/** 检查连接模块是否为HC-02型号模块 */
export function check02Model(serviceUUID, writeUUID) {
  return serviceUUID === HC02ServiceUUID && writeUUID === HC02CharacteristicWriteUUID
}

export * from './sysInfo'
export * from './updater'
export * from './error'