Component({

  properties: {
    device: {
      type: Object,
      value: {}
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tapDeviceCard', this.data.device)
    }
  }
})
