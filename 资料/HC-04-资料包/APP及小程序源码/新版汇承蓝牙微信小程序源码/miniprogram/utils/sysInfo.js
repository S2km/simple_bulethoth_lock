/**
 * 版本比较
 * @param {String} ver1
 * @param {String} ver2
 */
function versionCompare (ver1, ver2) {
  const version1pre = parseFloat(ver1)
  const version2pre = parseFloat(ver2)
  const version1next = parseInt(ver1.replace(version1pre + '.', ''))
  const version2next = parseInt(ver2.replace(version2pre + '.', ''))
  return version1pre === version2pre ? version1next > version2next : version1pre > version2pre
}

/**
 * 获取系统信息
 */
export function initSysInfo() {
  try {
    const sysInfo = wx.getSystemInfoSync()
    wx.setStorageSync('sysInfo', sysInfo)
  } catch (e) {
    console.error(e)
  }
}

/**
 * 检查微信版本
 */
export function checkWxVerison() {
  const sysInfo = wx.getStorageSync('sysInfo') || {}
  const { platform, version } = sysInfo
  if ((platform === 'android' && versionCompare('6.5.7', version))
  || (platform === 'ios' && versionCompare('6.5.6', version))) {
    wx.showModal({
      title: '提示',
      content: '当前微信版本过低，请更新至最新版本',
      showCancel: false
    })
  }
}

/**
 * 检查手机GPS状态
 * 部分安卓手机搜索蓝牙设备需要
 */
export function checkGPSState() {
  const sysInfo = wx.getStorageSync('sysInfo') || {}
  const { platform, locationEnabled } = sysInfo
  if (platform === 'android' && !locationEnabled) {
    wx.showModal({
      content: "请打开手机定位功能",
      showCancel:false
    })
  }
}