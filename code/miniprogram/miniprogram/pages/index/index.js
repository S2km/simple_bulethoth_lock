Page({
  onLoad() {
    wx.switchTab({
      url: '/pages/home/home',
      fail: () => {
        wx.reLaunch({
          url: '/pages/home/home',
        })
      },
    })
  },
})
