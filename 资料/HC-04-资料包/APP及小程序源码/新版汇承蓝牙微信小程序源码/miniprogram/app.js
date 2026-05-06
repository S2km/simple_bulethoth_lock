import { 
  checkForUpdate,
  initSysInfo
} from '@utils/index'

App({
  onLaunch() {
    /** 检查小程序版本更新 */
    checkForUpdate()
    /** 获取系统信息 */
    initSysInfo()
    
  },

  onHide() {
    /** App close */
  }
})
