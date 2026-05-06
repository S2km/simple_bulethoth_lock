function normalizeRssiThresholdDraft(value) {
  const text = String(value || '')
  const stripped = text.replace(/[^\d-]/g, '')

  if (!stripped) {
    return ''
  }

  if (stripped === '-') {
    return '-'
  }

  const negative = stripped.startsWith('-')
  const digits = stripped.replace(/-/g, '').slice(0, 2)

  if (!digits) {
    return negative ? '-' : ''
  }

  return `${negative ? '-' : ''}${digits}`
}

function normalizeRssiThresholdValue(value, fallback = -60) {
  const numeric = Number.parseInt(String(value || '').trim(), 10)
  const baseline = Number.isFinite(Number(fallback)) ? Number(fallback) : -60

  if (!Number.isFinite(numeric)) {
    return Math.max(-95, Math.min(-35, Math.round(baseline)))
  }

  return Math.max(-95, Math.min(-35, Math.round(numeric)))
}

module.exports = {
  normalizeRssiThresholdDraft,
  normalizeRssiThresholdValue,
}
