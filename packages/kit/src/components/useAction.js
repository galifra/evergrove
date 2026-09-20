import { useCallback, useState } from 'react'
import { useApp } from '../AppContext'

// Runs an app action on the user's behalf (their click is the approval) and
// keeps the latest error/summary for the form to show.
export function useAction() {
  const { run } = useApp()
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const act = useCallback(
    async (name, args) => {
      setBusy(true)
      setError('')
      setNote('')
      try {
        const r = await run(name, args)
        if (r.status === 'error') {
          setError(r.error)
          return false
        }
        setNote(r.summary ?? '')
        return true
      } finally {
        setBusy(false)
      }
    },
    [run]
  )
  return { act, error, note, busy, clear: () => { setError(''); setNote('') } }
}
