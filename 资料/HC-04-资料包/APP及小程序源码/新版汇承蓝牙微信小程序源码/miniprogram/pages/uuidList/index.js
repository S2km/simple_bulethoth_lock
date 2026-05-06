import { transToQuery, handleErrno } from '@utils/index'

Page({

  data: {
    deviceId: '',
    deviceName: '设备名称',
    deviceServices: []
  },
  _deviceName: '',

  async onLoad(options) {
    const { deviceId, deviceName } = options
    try {
      const { services } = await wx.getBLEDeviceServices({ deviceId })
      for (let service of services) {
        const suuid = service.uuid
        const { characteristics } = await wx.getBLEDeviceCharacteristics({ deviceId, serviceId: suuid })
        service['characteristics'] = characteristics
      }
      this.setData({
        deviceId,
        deviceName,
        deviceServices: services
      }, () => {
        wx.setNavigationBarTitle({ title: deviceName })
      })
    } catch (err) {
      if (err.errno) {
        handleErrno(err.errno)
      } else {
        console.error(err)
      }
    }
  },

  onUnload() {
    wx.closeBLEConnection({ deviceId: this.data.deviceId })
  },

  handleCharacteristicTap(e) {
    const { serviceId, characteristic } = e.mark
    const { deviceId, deviceName } = this.data
    const query = transToQuery({
      origin: 'uuidList',
      deviceId,
      deviceName,
      serviceId,
      characteristicId: characteristic.uuid,
      ...characteristic.properties
    })
    wx.navigateTo({
      url: `/pages/comm/index?${query}`
    })
  }
})