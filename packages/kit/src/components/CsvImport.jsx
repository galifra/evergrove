import { useMemo, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { parseCsv, purchaseEvent, toPurchases } from '@evergrove/modules/csv.js'
import { formatCents } from '@evergrove/modules/money.js'
import { Button, Card, ErrorNote, Select } from '@evergrove/ui/components/ui.jsx'

// Reads a bank CSV on this device (nothing is uploaded), shows exactly what will
// be imported, and only writes after you confirm.
export default function CsvImport() {
  const { runtime } = useApp()
  const fileRef = useRef(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [sign, setSign] = useState('auto')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  const parsed = useMemo(() => (text ? toPurchases(parseCsv(text), { spendSign: sign }) : null), [text, sign])

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult('')
    setError('')
    if (file.size > 5_000_000) {
      setError('That file is over 5 MB. Export a shorter date range.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setFileName(file.name)
      setText(String(reader.result))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function doImport() {
    setError('')
    try {
      const events = parsed.purchases.map((p) => purchaseEvent(p))
      const added = await runtime.log.append(events)
      const dupes = events.length - added.length
      setResult(`Imported ${added.length} purchase${added.length === 1 ? '' : 's'}${dupes ? `, ${dupes} already there` : ''}.`)
      setText('')
      setFileName('')
    } catch (err) {
      setError(err.message)
    }
  }

  const total = parsed?.purchases.reduce((s, p) => s + p.amountCents, 0) ?? 0

  return (
    <Card title="Import from a bank CSV (optional)">
      <p className="text-xs text-white/55 mb-3">
        Download a CSV from your bank's website and choose it here. It's read on this device and never uploaded. Only money that
        went out becomes a purchase, and importing the same file twice won't double anything.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          Choose CSV file
        </Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} hidden />
        {fileName && <span className="text-xs text-white/50">{fileName}</span>}
      </div>

      {parsed && (
        <div className="mt-3 space-y-2 text-sm">
          {parsed.purchases.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  {parsed.purchases.length} purchase{parsed.purchases.length === 1 ? '' : 's'} totaling {formatCents(total)}
                </span>
                <label className="flex items-center gap-1.5 text-xs text-white/50">
                  Spending shows as
                  <Select
                    value={sign}
                    onChange={(e) => setSign(e.target.value)}
                    options={[
                      { value: 'auto', label: 'auto-detect' },
                      { value: 'negative', label: 'negative numbers' },
                      { value: 'positive', label: 'positive numbers' },
                    ]}
                  />
                </label>
              </div>
              <ul className="rounded-lg bg-white/[0.03] border border-white/10 divide-y divide-white/5 text-xs">
                {parsed.purchases.slice(0, 5).map((p) => (
                  <li key={p.id} className="px-3 py-1.5 flex justify-between gap-3">
                    <span className="truncate">
                      {p.date} · {p.merchant || 'no name'} · <span className="capitalize text-white/50">{p.category}</span>
                    </span>
                    <span>{formatCents(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
              {parsed.purchases.length > 5 && <p className="text-xs text-white/55">...and {parsed.purchases.length - 5} more.</p>}
              <Button onClick={doImport}>Import {parsed.purchases.length}</Button>
            </>
          ) : (
            <p className="text-white/60">Nothing importable in that file.</p>
          )}
          {parsed.skipped.length > 0 && (
            <p className="text-xs text-white/55">
              Skipped {parsed.skipped.length} row{parsed.skipped.length === 1 ? '' : 's'} (
              {[...new Set(parsed.skipped.map((s) => s.reason))].slice(0, 3).join('; ')}).
            </p>
          )}
        </div>
      )}
      {result && <p className="mt-3 text-sm text-emerald-300">{result}</p>}
      <ErrorNote>{error}</ErrorNote>
    </Card>
  )
}
