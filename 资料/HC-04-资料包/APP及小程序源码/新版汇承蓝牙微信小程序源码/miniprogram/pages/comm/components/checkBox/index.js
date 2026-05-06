Component({

  externalClasses: ['wrap-class'],
  
  properties: {
    
    label: {
      type: String,
      default: '选择标签文本',
      observer(value) {
        this.setData({ checkDes: value })
      }
    },

    checkValue: {
      type: Boolean,
      default: false,
      observer(value) {
        this.setData({ checked: value })
      }
    }
  },

  data: {
    checked: false,
    checkDes: '选择标签文本'
  },

  methods: {
    onTapCheck() {
      const { checked } = this.data
      const nextActived = !checked
      this.setData(
        { checked: nextActived },
        () => {
          this.triggerEvent('change', nextActived)
        }
      )
    }
  }
})
