export function handleErrno(errno) {
  switch(errno) {
    case 1500102:
      wx.showLoading({title: "请打开手机蓝牙", mask: true})
      break
    case 1509000:
      wx.showModal({ content: '未知错误' })
      break
    case 1509001:
      wx.showModal({ content: '连接失败' })
      break
    case 1509002:
      wx.showModal({ content: '获取特征值失败' })
      break
    case 1509003:
      wx.showModal({ content: '未连接设备' })
      break
    case 1509004:
      wx.showModal({ content: '特征值不支持该操作' })
      break
    case 1509005:
      wx.showModal({ content: '已超时' })
      break
    case 1509006:
      wx.showModal({ content: '未发现设备' })
      break
    case 1509007:
      wx.showModal({ content: '已连接' })
      break
    case 1509008:
      wx.showModal({ content: '请开启地理定位' }) // Android6.0以上
      break
    case 1509010:
      wx.showModal({ content: '蓝牙模块初始化超时' }) // IOS系统
      break
    default:
      break
  }
}