const {
  getLockRuntime,
  initLockRuntime,
  subscribeLockRuntime,
  getLockRuntimeSnapshot,
} = require('./utils/lock_runtime')

App({
  onLaunch() {
    this.refreshLockRuntimeApi()
    initLockRuntime().catch(() => {})
  },

  getLockRuntime() {
    return this.lockRuntime || getLockRuntime()
  },

  refreshLockRuntimeApi() {
    this.lockRuntime = getLockRuntime()
    this.lockRuntimeApi = {
      initLockRuntime,
      subscribeLockRuntime,
      getLockRuntimeSnapshot,
      get actions() {
        return getLockRuntime().actions
      },
    }
    this.globalData.lockRuntimeApi = this.lockRuntimeApi
    return this.lockRuntimeApi
  },

  globalData: {
    userInfo: null,
  },
})
