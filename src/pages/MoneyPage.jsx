import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { localDate } from '../core/events'
import { deriveMoney, formatCents } from '../modules/money'
import { Button, Card, Empty, ErrorNote, Field, PageHeader, ProgressBar, Select, TextInput } from '../components/ui'
import { useAction } from '../components/useAction'

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
      <div className="text-xs text-white/45">{label}</div>
      <div className={`text-xl font-medium mt-0.5 ${tone ?? ''}`}>{value}</div>
    </div>
  )
}

export default function MoneyPage() {
  const { events } = useApp()
  const m = useMemo(() => deriveMoney(events), [events])
  const buy = useAction()
  const bill = useAction()
  const budget = useAction()
  const goal = useAction()
  const bal = useAction()

  const [p, setP] = useState({ amount: '', category: '', merchant: '', date: localDate() })
  const [b, setB] = useState({ name: '', amount: '', cadence: 'monthly', due: '' })
  const [bud, setBud] = useState({ category: '', amount: '' })
  const [g, setG] = useState({ name: '', target: '' })
  const [contrib, setContrib] = useState({})
  const [a, setA] = useState({ name: '', kind: 'asset', balance: '' })

  return (
    <div className="grid gap-4">
      <PageHeader
        icon="wallet"
        title="Money"
        subtitle="A personal ledger and budget. Tracking only: no accounts are linked and no real money moves here."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={`Spent in ${m.month}`} value={formatCents(m.thisMonth.totalCents)} />
        <Stat label="Net worth" value={formatCents(m.netWorthCents)} tone={m.netWorthCents < 0 ? 'text-rose-300' : ''} />
        <Stat label="Bills per month" value={formatCents(m.subscriptionsMonthlyCents)} />
        <Stat label="Overdue bills" value={String(m.bills.filter((x) => x.overdue).length)} tone={m.bills.some((x) => x.overdue) ? 'text-rose-300' : ''} />
      </div>

      {m.recurring.length > 0 && (
        <Card title="Possible forgotten subscriptions">
          <ul className="text-sm space-y-1">
            {m.recurring.map((r) => (
              <li key={r.merchant}>{r.merchant}: about {formatCents(r.avgCents)} each month for {r.months} months. Still using it?</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Log a purchase">
        <form
          className="grid gap-3 sm:grid-cols-4 items-end"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await buy.act('money__log_purchase', { amount: p.amount, category: p.category, merchant: p.merchant || undefined, date: p.date })) setP({ ...p, amount: '', merchant: '' })
          }}
        >
          <Field label="Amount ($)"><TextInput type="number" step="0.01" min="0" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></Field>
          <Field label="Category"><TextInput value={p.category} onChange={(e) => setP({ ...p, category: e.target.value })} placeholder="groceries" list="cats" /></Field>
          <Field label="Where"><TextInput value={p.merchant} onChange={(e) => setP({ ...p, merchant: e.target.value })} /></Field>
          <Field label="Date"><TextInput type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
          <datalist id="cats">{[...new Set([...m.budgets.map((x) => x.category), 'groceries', 'dining', 'transport', 'fun', 'health'])].map((c) => <option key={c} value={c} />)}</datalist>
          <div className="sm:col-span-4"><Button type="submit" disabled={!p.amount || !p.category || buy.busy}>Log purchase</Button><ErrorNote>{buy.error}</ErrorNote></div>
        </form>
      </Card>

      <Card title="Budgets this month">
        {m.budgets.length === 0 && <Empty>No budgets yet.</Empty>}
        <div className="space-y-3">
          {m.budgets.map((x) => (
            <div key={x.category}>
              <div className="flex justify-between text-sm"><span className="capitalize">{x.category}</span><span className={x.over ? 'text-rose-300' : 'text-white/60'}>{formatCents(x.spentCents)} of {formatCents(x.monthlyCents)}</span></div>
              <ProgressBar value={x.monthlyCents ? x.spentCents / x.monthlyCents : 0} over={x.over} />
            </div>
          ))}
        </div>
        <form
          className="mt-4 flex flex-wrap gap-3 items-end"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await budget.act('money__set_budget', { category: bud.category, amount: bud.amount })) setBud({ category: '', amount: '' })
          }}
        >
          <Field label="Category"><TextInput value={bud.category} onChange={(e) => setBud({ ...bud, category: e.target.value })} /></Field>
          <Field label="Monthly ($)"><TextInput type="number" step="0.01" min="0" value={bud.amount} onChange={(e) => setBud({ ...bud, amount: e.target.value })} /></Field>
          <Button type="submit" disabled={!bud.category || !bud.amount}>Set budget</Button>
          <ErrorNote>{budget.error}</ErrorNote>
        </form>
      </Card>

      <Card title="Bills and subscriptions">
        <ul className="divide-y divide-white/5">
          {m.bills.length === 0 && <Empty>No bills tracked.</Empty>}
          {m.bills.map((x) => (
            <li key={x.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">{x.name} <span className="text-white/40">{formatCents(x.amountCents)} {x.cadence}</span></div>
                <div className={`text-xs ${x.overdue ? 'text-rose-300' : 'text-white/40'}`}>{x.overdue ? `overdue since ${x.dueOn}` : `due ${x.dueOn} (${x.daysUntil} days)`}</div>
              </div>
              <Button onClick={() => bill.act('money__pay_bill', { bill: x.id })}>Mark paid</Button>
            </li>
          ))}
        </ul>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-5 items-end"
          onSubmit={async (e) => {
            e.preventDefault()
            const args = { name: b.name, amount: b.amount, cadence: b.cadence }
            if (b.cadence === 'monthly') args.dueDay = Number(b.due)
            else args.dueDate = b.due
            if (await bill.act('money__add_bill', args)) setB({ name: '', amount: '', cadence: 'monthly', due: '' })
          }}
        >
          <Field label="Bill"><TextInput value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="Rent" /></Field>
          <Field label="Amount ($)"><TextInput type="number" step="0.01" min="0" value={b.amount} onChange={(e) => setB({ ...b, amount: e.target.value })} /></Field>
          <Field label="Repeats"><Select value={b.cadence} onChange={(e) => setB({ ...b, cadence: e.target.value, due: '' })} options={['monthly', 'yearly', 'once']} /></Field>
          <Field label={b.cadence === 'monthly' ? 'Day of month' : 'Due date'}>
            {b.cadence === 'monthly' ? <TextInput type="number" min="1" max="31" value={b.due} onChange={(e) => setB({ ...b, due: e.target.value })} /> : <TextInput type="date" value={b.due} onChange={(e) => setB({ ...b, due: e.target.value })} />}
          </Field>
          <Button type="submit" disabled={!b.name || !b.amount || !b.due}>Track bill</Button>
          <div className="sm:col-span-5"><ErrorNote>{bill.error}</ErrorNote></div>
        </form>
      </Card>

      <Card title="Savings goals">
        {m.goals.length === 0 && <Empty>No savings goals yet.</Empty>}
        <div className="space-y-3">
          {m.goals.map((x) => (
            <div key={x.id}>
              <div className="flex justify-between text-sm"><span>{x.name}</span><span className="text-white/60">{formatCents(x.savedCents)} of {formatCents(x.targetCents)}</span></div>
              <ProgressBar value={x.targetCents ? x.savedCents / x.targetCents : 0} />
              <div className="mt-1.5 flex gap-2 items-center">
                <TextInput className="max-w-28" type="number" step="0.01" min="0" placeholder="$" value={contrib[x.id] ?? ''} onChange={(e) => setContrib({ ...contrib, [x.id]: e.target.value })} />
                <Button variant="ghost" disabled={!contrib[x.id]} onClick={async () => { if (await goal.act('money__contribute_savings', { goal: x.id, amount: contrib[x.id] })) setContrib({ ...contrib, [x.id]: '' }) }}>Add</Button>
              </div>
            </div>
          ))}
        </div>
        <form
          className="mt-4 flex flex-wrap gap-3 items-end"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await goal.act('money__add_savings_goal', { name: g.name, target: g.target })) setG({ name: '', target: '' })
          }}
        >
          <Field label="Goal"><TextInput value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Emergency fund" /></Field>
          <Field label="Target ($)"><TextInput type="number" step="0.01" min="0" value={g.target} onChange={(e) => setG({ ...g, target: e.target.value })} /></Field>
          <Button type="submit" disabled={!g.name || !g.target}>Add goal</Button>
          <ErrorNote>{goal.error}</ErrorNote>
        </form>
      </Card>

      <Card title="Accounts and debts (balances you enter)">
        <ul className="divide-y divide-white/5 text-sm">
          {m.accounts.length === 0 && <Empty>Nothing recorded.</Empty>}
          {m.accounts.map((x) => (
            <li key={x.id} className="py-2 flex justify-between"><span>{x.name} <span className="text-white/40">({x.kind})</span></span><span className={x.kind === 'debt' ? 'text-rose-300' : ''}>{formatCents(x.balanceCents)}</span></li>
          ))}
        </ul>
        <form
          className="mt-4 flex flex-wrap gap-3 items-end"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await bal.act('money__set_balance', { name: a.name, kind: a.kind, balance: a.balance })) setA({ name: '', kind: 'asset', balance: '' })
          }}
        >
          <Field label="Name"><TextInput value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="Checking" /></Field>
          <Field label="Type"><Select value={a.kind} onChange={(e) => setA({ ...a, kind: e.target.value })} options={['asset', 'debt']} /></Field>
          <Field label="Balance ($)"><TextInput type="number" step="0.01" min="0" value={a.balance} onChange={(e) => setA({ ...a, balance: e.target.value })} /></Field>
          <Button type="submit" disabled={!a.name || a.balance === ''}>Save balance</Button>
          <ErrorNote>{bal.error}</ErrorNote>
        </form>
      </Card>

      <Card title="Recent purchases">
        <ul className="divide-y divide-white/5 text-sm">
          {m.purchases.length === 0 && <Empty>Nothing logged.</Empty>}
          {m.purchases.slice(0, 30).map((x) => (
            <li key={x.eventId} className="py-2 flex justify-between gap-3"><span className="truncate"><span className="capitalize">{x.category}</span>{x.merchant ? ` · ${x.merchant}` : ''} <span className="text-white/40">{x.date}</span></span><span>{formatCents(x.amountCents)}</span></li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-white/35">Private area: Jarvis doesn't see money summaries unless you share them in Settings. This page gives general tracking help, not personal financial advice.</p>
    </div>
  )
}
