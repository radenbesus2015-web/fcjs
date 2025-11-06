// utils/toast.js (JS biasa)
import { toast as $sonner } from 'vue-sonner'

// mapping tipe lama -> metode sonner
const TYPE_METHOD = {
  success: 'success',
  error: 'error',
  warn: 'warning', // sonner pakai "warning"
  info: 'info',
}

const DEFAULTS = {
  type: 'info',
  title: '',
  message: '',
  delay: 0,
  duration: 3200,
  dismissible: true, // di sonner: tampilkan closeButton (global). per-toast kita biarin aja.
  actionText: '',
  onAction: null,
}

/**
 * show(options | string)
 * - string => message
 * - options: { type, title, message, delay, duration, dismissible, actionText, onAction }
 */
export function show(options = {}) {
  const opts = typeof options === 'string' ? { message: options } : options
  const o = { ...DEFAULTS, ...opts }

  const fnName = TYPE_METHOD[o.type] || 'info'
  const run = () => {
    const id = $sonner[fnName]
      ? $sonner[fnName](o.title || fallbackTitle(o.type), {
          description: o.message || '',
          duration: o.duration, // Infinity utk persistent
          // action button
          ...(o.actionText && o.onAction
            ? { action: { label: o.actionText, onClick: () => o.onAction?.() } }
            : {}),
          // callback kalau auto close/di-dismiss
          onDismiss: () => {},
          onAutoClose: () => {},
        })
      // kalau misal metode gak ada, fallback ke default toast()
      : $sonner(o.title || fallbackTitle(o.type), {
          description: o.message || '',
          duration: o.duration,
          ...(o.actionText && o.onAction
            ? { action: { label: o.actionText, onClick: () => o.onAction?.() } }
            : {}),
        })

    return id
  }

  if (o.delay > 0) {
    const t = setTimeout(run, o.delay)
    return { id: null, cancel: () => clearTimeout(t) }
  }
  return run()
}

function fallbackTitle(type) {
  return (
    {
      success: 'Berhasil',
      error: 'Gagal',
      warn: 'Perhatian',
      info: 'Info',
    }[type] || 'Info'
  )
}

export const toast = {
  show,
  success(message, extra) {
    return show({ type: 'success', message, ...(extra || {}) })
  },
  error(message, extra) {
    return show({ type: 'error', message, ...(extra || {}) })
  },
  warn(message, extra) {
    return show({ type: 'warn', message, ...(extra || {}) })
  },
  info(message, extra) {
    return show({ type: 'info', message, ...(extra || {}) })
  },
  // optional: dismiss by id / all
  dismiss(id) {
    return $sonner.dismiss(id) // tanpa id = dismiss semua
  },
}
