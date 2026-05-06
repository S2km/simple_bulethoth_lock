// logs.js
const util = require('../../utils/util.js')

Page({
  data: {
    logs: [],
  },
  onLoad() {
    const rawLogs = wx.getStorageSync('logs')
    const normalizedLogs = Array.isArray(rawLogs) ? rawLogs : []

    this.setData({
      logs: normalizedLogs
        .filter((log) => Number.isFinite(Number(log)))
        .map((log) => {
        return {
          date: util.formatTime(new Date(log)),
          timeStamp: log,
        }
      }),
    })
  },
})
