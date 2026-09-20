import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Makes a panel behave like a real dialog for keyboards and screen readers:
// focus moves inside when it opens, Tab stays inside, Escape closes it, and
// focus goes back to whatever opened it. Attach the returned ref to the panel.
export function useDialog(active, onClose) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return undefined
    const opener = document.activeElement
    const panel = ref.current
    const focusables = () => [...(panel?.querySelectorAll(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null)
    // Wait a frame so the panel is laid out (and any enter animation has started).
    const raf = requestAnimationFrame(() => {
      const first = focusables()[0]
      if (first) first.focus()
      else panel?.focus()
    })
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey, true)
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [active])

  return ref
}
