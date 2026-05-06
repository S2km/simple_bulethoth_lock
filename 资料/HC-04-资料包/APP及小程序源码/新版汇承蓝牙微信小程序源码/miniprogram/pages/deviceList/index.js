import {
  transToQuery,
  checkWxVerison,
  checkGPSState,
  checkBeacon,
  handleErrno } from '@utils/index'
import {
  GeneralServiceUUID,
  GeneralCharacteristicUUID,
  HC02ServiceUUID,
  HC02CharacteristicWriteUUID } from '@configs/index'

Page({

  data: {
    refreshing: false,
    devicesList: [],
    services: [],
    loadingProps: { size: '50rpx' }
  },
  _deviceIdsList: [],
  _discoveryTimer: null,
  _discoveryTimeout: 30000, // 搜索设备超时时间，单位ms

  /** 开启搜索附近设备 */
  onDevicesDiscovery() {
    // console.log('【开始搜索附近设备...】')
    if (wx.getStorageSync('bluetoothAdapterState')) {
      wx.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: true, // 重复上报发现设备
        powerLevel: 'height',
        interval: 1000,
        success: () => {
          this._deviceIdsList = []
          this.setData({ devicesList: [] })
          /** 发现设备 */
          wx.onBluetoothDeviceFound(this.handleFoundBluetoothDevices)
          /** 超时关闭搜索 */
          this._discoveryTimer = setTimeout(() => {
            this.offDevicesDiscovery()
          }, this._discoveryTimeout)
        },
        fail: err => {
          console.error(err)
        }
      })
    }
  },

  onLoad() {
    /** 检查微信版本 */
    checkWxVerison()
    /** 判断手机GPS状态 */
    checkGPSState()
  },

  async onShow() {
    /** 初始化小程序蓝牙 */
    wx.openBluetoothAdapter({
      success: () => {
        wx.setStorageSync('bluetoothAdapterState', true)
      },
      fail: err => {
        wx.setStorageSync('bluetoothAdapterState', false)
        handleErrno(err.errno)
      },
      complete: () => {
        /** 监听蓝牙适配器 */
        // console.log('【监听蓝牙适配器...】')
        wx.offBluetoothAdapterStateChange()
        wx.onBluetoothAdapterStateChange(this.handleBluetoothAdapterStateChange)

        /** 监听蓝牙连接 */
        // console.log('【监听蓝牙连接...】')
        wx.offBLEConnectionStateChange()
        wx.onBLEConnectionStateChange(this.handleBLEConnectionStateChange)

        /** 开始搜索附近设备 */
        this.onDevicesDiscovery()
      }
    })
  },

  onHide() {
    // console.log('【页面卸载】')
    clearTimeout(this._discoveryTimer)
    wx.offBluetoothDeviceFound()
    wx.stopBluetoothDevicesDiscovery()
  },

  /** 下拉刷新 */
  handlePullDownRefresh() {
    // console.log('【下拉刷新...】')
    this.setData({ refreshing: true })
    setTimeout(() => {
      this.setData({ refreshing: false })
      // console.log('【下拉刷新完毕】')
    }, 1500)
    this.offDevicesDiscovery()
    this.onDevicesDiscovery()
  },

  /**
   * 蓝牙适配器状态改变
   */
  handleBluetoothAdapterStateChange(res) {
    // console.log('触发【监听蓝牙适配器】回调', res)
    wx.hideLoading()
    const { available } = res
    const originState = wx.getStorageSync('bluetoothAdapterState')
    wx.setStorageSync('bluetoothAdapterState', available)
    if(!available) {
      this.offDevicesDiscovery()
      wx.showLoading({title: "请打开手机蓝牙", mask: true})
    } else if(!originState) {
      this.onDevicesDiscovery()
    }
  },

  /**
   * BLE蓝牙连接状态改变
   */
  async handleBLEConnectionStateChange(res) {
    const { connected, deviceId } = res
    if (connected) {
      await wx.showToast({ title: '连接成功', icon: 'success' })
      wx.setStorageSync('connectedDeviceId', deviceId)
    } else {
      await wx.showToast({ title: '已断开连接', icon: 'none' })
      wx.removeStorageSync('connectedDeviceId')
    }
  },

  filterDevices(devices) {
    return devices.filter(d => {
      checkBeacon(d) && (d.beacon = true)
      return d.name && d.localName
    })
  },

  /**
   * 搜索附近设备回调
   */
  handleFoundBluetoothDevices({ devices }) {
    const devicesList = [...this.data.devicesList]
    const { _deviceIdsList=[] } = this
    devices = this.filterDevices(devices)
    for (let device of devices) {
      const { deviceId } = device
      const index = _deviceIdsList.indexOf(deviceId)
      if (index < 0) {
        _deviceIdsList.push(deviceId)
        devicesList.push(device)
      } else {
        devicesList.splice(index, 1, device)
      }      
    }
    this.setData({ devicesList })
  },

  /**
   * 关闭搜索附近设备
   */
  offDevicesDiscovery() {
    clearTimeout(this._discoveryTimer)
    wx.offBluetoothDeviceFound()
    wx.stopBluetoothDevicesDiscovery()
    // console.log('【结束搜索附近设备】')
  },

  /** 点击设备配对连接 */
  async onTapDevice(e) {
    const device = e.detail
    const {deviceId, name: localName, beacon, connectable} = device
    if (beacon || !connectable || !wx.getStorageSync('bluetoothAdapterState')) return
    try {
      wx.showLoading({ title: '正在连接...' })
      /** 创建BLE连接 */
      await wx.createBLEConnection({
        deviceId,
        timeout: 10000
      })
      /** 连接成功后，读取服务列表 */
      const { services } = await wx.getBLEDeviceServices({ deviceId })
      /** HC系列蓝牙设备直接进入串口收发页面 */
      for (let service of services.filter(({ uuid }) => [GeneralServiceUUID, HC02ServiceUUID].includes(uuid))) {
        const { characteristics } = await wx.getBLEDeviceCharacteristics({deviceId, serviceId: service.uuid})
        for (let characteristic of characteristics.filter(({ uuid }) => [GeneralCharacteristicUUID, HC02CharacteristicWriteUUID].includes(uuid))) {
          const query = transToQuery({
            origin: 'deviceList',
            deviceId,
            deviceName: localName,
            serviceId: service.uuid,
            characteristicId: characteristic.uuid,
            ...characteristic.properties
          })
          wx.hideLoading()
          return wx.navigateTo({
            url: `/pages/comm/index?${query}`
          })
        }
      }
      /** 非HC系列蓝牙设备进入UUID选择页面 */
      wx.hideLoading()
      const query = transToQuery({
        deviceId,
        deviceName: localName
      })
      wx.navigateTo({
        url: `/pages/uuidList/index?${query}`
      })
    } catch (err) {
      if (err.errno) {
        handleErrno(err.errno)
      } else {
        console.error(err)
      }
    }
  }
})