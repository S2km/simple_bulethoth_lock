import { abToHex, hexToAb, splitPackage, check02Model } from '@utils/index'
import { TextDecoder, TextEncoder } from '@libs/encoding'
import { HC02CharacteristicNotifyUUID } from '@configs/index'
const gbkDecoder = new TextDecoder('gbk')
const gbkEncoder = new TextEncoder('gbk', { NONSTANDARD_allowLegacyEncoding: true })

Page({

  data: {
    deviceName: '设备名称',
    recData: '',
    recTotal: 0,
    sendData: '',
    sendTotal: 0,
    isCyclicSend: false,
    interval: 1000,
    is02Model: false, // HC-02的写和读特征值是分开的，需要特殊处理
    checkboxOptions: [
      { label: '接收Hex', value: false },
      { label: '发送Hex', value: false }
    ]
  },

  _timer: null,
  _device: null,
  _recedBuffer: null,
  _origin: 'deviceList',

  /**
   * 向特征值写数据
   */
  async writeDatas(subPackages, index = 0) {
    if (!subPackages) return
    const { deviceId, serviceId, characteristicId } = this._device
    const count = subPackages.length

    while(index < count) {
      const { errno } = await wx.writeBLECharacteristicValue({ deviceId, serviceId, characteristicId, value: subPackages[index] })
      if (!errno) {
        this.setData({
          sendTotal: this.data.sendTotal + subPackages[index++].byteLength
        })
      }
    }
  },

  /**
   * 从特征值读取数据
   */
  readDatas(res) {
    const { value } = res
    const isHexMode = this.data.checkboxOptions[0].value
    if (this._recedBuffer) {
      let newArray = new Uint8Array(this._recedBuffer.byteLength + value.byteLength)
      newArray.set(this._recedBuffer)
      newArray.set(new Uint8Array(value), this._recedBuffer.byteLength)
      this._recedBuffer = newArray
      newArray = null
    } else {
      this._recedBuffer = new Uint8Array(value)
    }
    this.setData({
      recTotal: this.data.recTotal + value.byteLength
    })
    setTimeout(() => {
      const recData = isHexMode
        ? abToHex(this._recedBuffer.buffer.slice(this.data.recTotal > 4000 ? -4000 : 0))
        : gbkDecoder.decode(this._recedBuffer).slice(this.data.recTotal > 4000 ? -4000 : 0)
      this.setData({ recData })
    }, 200)
  },

  /**
   * 更改发送框内容
   */
  handleSendDataChange(e) {
    this.setData({sendData: e.detail.value})
  },

  /**
   * 更改循环发送的时间间隔
   */
  handleDelayChange(e) {
    this.setData({ interval: Number(e.detail.value) })
  },

  /**
   * 切换循环发送
   */
  handleCycleSwitchChange(e) {
    const value = e.detail
    const { sendData, checkboxOptions, interval } = this.data
    this.setData({ isCyclicSend: value })
    if (value && sendData) {
      this._timer = setInterval(() => {
        const dataPackage = checkboxOptions[1].value
          ? hexToAb(sendData)
          : gbkEncoder.encode(sendData).buffer
        const subPackages = splitPackage(dataPackage, 20) // 数据分包，每20个字节一个数据包数组
        if (wx.getStorageSync('connectedDeviceId') && this._device.write) {
          this.writeDatas(subPackages)
        }
      }, interval)
    } else {
      clearInterval(this._timer)
    }
  },

  /**
   * 切换 Hex发送 或 Hex接收
   */
  handleModeChange(e) {
    const { index } = e.currentTarget.dataset
    switch(index) {
      case 0: // Hex接收
        this.setData({ 'checkboxOptions[0].value': e.detail })
        break
      case 1: // Hex发送
        this.setData({ 'checkboxOptions[1].value': e.detail })
        break
    }
  },

  /**
   * 清除接收框内容、收发计数
   */
  cleanReceived() {
    this.setData({
      recData: '',
      recTotal: 0,
      sendTotal: 0
    })
    this._recedBuffer = null
  },

  /**
   * 清除发送框内容
   */
  cleanSent() {
    this.setData({
      sendData: '',
      sendTotal: 0
    })
  },

  /**
   * 点击发送
   */
  handleSendTap() {
    if (!this._device.write || !wx.getStorageSync('connectedDeviceId')) return
    const { sendData, checkboxOptions } = this.data
    const ab = checkboxOptions[1].value // 判断是否Hex发送
      ? hexToAb(sendData)
      : gbkEncoder.encode(sendData).buffer
    const abs = splitPackage(ab, 20) // 数据分包，每20个字符串一个包
    this.writeDatas(abs)
  },

  async onLoad(options) {
    const { origin, deviceId, deviceName, serviceId, characteristicId, write, read, notify, indicate } = options
    const is02Model = check02Model(serviceId, characteristicId)
    this.setData({ deviceName })
    this._origin = origin
    this._device = {
      deviceId,
      deviceName,
      serviceId,
      characteristicId,
      write: write === 'true' ? true : false,
      read: read === 'true' ? true : false,
      notify: notify === 'true' ? true : false,
      indicate: indicate === 'true' ? true : false
    }
    if (is02Model) {
      await wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId,
        characteristicId: HC02CharacteristicNotifyUUID,
        state: true
      })
      /** 监听蓝牙设备的特征值变化 */
      wx.onBLECharacteristicValueChange(this.readDatas)
    }
    if (notify === 'true' || indicate === 'true') {
      await wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId,
        characteristicId,
        state: true
      })
      /** 监听蓝牙设备的特征值变化 */
      wx.onBLECharacteristicValueChange(this.readDatas)
    }
  },

  onUnload() {
    if (this._origin === 'deviceList' && wx.getStorageSync('bluetoothAdapterState')) {
      wx.closeBLEConnection({ deviceId: this._device.deviceId })
      wx.removeStorageSync('connectedDeviceId')
    }
    wx.offBLECharacteristicValueChange(this.readDatas)
    clearInterval(this._timer)
    this._recedBuffer = null
    this.setData({
      recData: '',
      recTotal: 0,
      sendData: '',
      sendTotal: 0,
      interval: 1000,
    })
  }
})