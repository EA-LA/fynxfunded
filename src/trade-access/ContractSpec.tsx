import { Info, LockKeyhole } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { GatewayStatus } from '@/engine/gateway';
import type { QuoteBook } from '@/engine/types';
import { CONTRACT_SIZE, pairName, type ForexPair } from './instruments';
import { orderCosts, weekdayName } from './costs';
import { pipValuePerLot } from './sizing';
import { localTime, openHours, sessionRows, spreadOf, weekHours } from './contract-spec';
import { untilLabel, type PairMarket } from './market-hours';

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NOT_CONNECTED = 'Shown once trading is connected';

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 text-sm last:border-0"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-mono text-[13px] tabular-nums" data-testid={testId}>{value}</dd></div>;
}

/**
 * Per-pair contract specification: contract, spread, the trading server's
 * conditions and the trading hours for the coming week in the trader's own time.
 */
export default function ContractSpec({ pair, status, quotes, market, now, open, onOpenChange, trigger = true }: {
  pair: ForexPair; status: GatewayStatus | null; quotes?: QuoteBook | null; market: PairMarket; now: number;
  /** Controlled mode (e.g. Market Watch opens one sheet for the tapped row); leave out to use the built-in button. */
  open?: boolean; onOpenChange?: (open: boolean) => void; trigger?: boolean;
}) {
  const conditions = status?.instruments?.[pair.symbol] ?? null;
  const pv = pipValuePerLot(pair, quotes);
  const spread = spreadOf(pair, quotes?.[pair.symbol], quotes);
  const oneLot = orderCosts({ pair, lots: 1, conditions, quotes });
  const hours = weekHours(status, pair.symbol, now, market.open);
  const rows = sessionRows(hours.sessions, now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <Dialog {...(open !== undefined ? { open, onOpenChange } : {})}>
    {trigger && <DialogTrigger asChild>
      <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Contract specification for ${pair.symbol}`} data-testid="spec-button"><Info size={12} aria-hidden="true" />Specification</button>
    </DialogTrigger>}
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="contract-spec">
      <DialogHeader>
        <DialogTitle className="font-mono">{pair.symbol} <span className="font-sans text-sm font-normal text-muted-foreground">· contract specification</span></DialogTitle>
        <DialogDescription>{pairName(pair)} · {pair.group}</DialogDescription>
      </DialogHeader>

      <section aria-labelledby="spec-contract">
        <h3 id="spec-contract" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contract</h3>
        <dl className="mt-1">
          <Row label="Base / quote currency" value={`${pair.base} / ${pair.quote}`} />
          <Row label="Contract size (1.00 lot)" value={`${(conditions?.contractSize ?? CONTRACT_SIZE).toLocaleString()} ${pair.base}${conditions ? '' : ' (standard)'}`} />
          <Row label="Pip / price digits" value={`${pair.pipSize} / ${pair.digits} decimals`} />
          <Row label="Pip value (1.00 lot)" testId="spec-pip-value" value={pv ? `${usd(pv.perLot)}${pv.source === 'server' ? ' at the server’s price now' : ''}` : 'Needs a live server price'} />
          <Row label="Spread now" testId="spec-spread" value={spread ? `${spread.pips.toFixed(1)} pips${spread.usdPerLot !== null ? ` · ${usd(spread.usdPerLot)} per lot` : ''}` : 'From the trading server’s live prices'} />
        </dl>
      </section>

      <section aria-labelledby="spec-conditions">
        <h3 id="spec-conditions" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trading conditions</h3>
        {conditions ? <dl className="mt-1" data-testid="spec-conditions">
          <Row label="Leverage" value={`1:${conditions.leverage}`} />
          <Row label="Volume" value={`${conditions.minLots} to ${conditions.maxLots} lots, step ${conditions.lotStep}`} />
          <Row label="Margin for 1.00 lot" value={oneLot.margin !== null ? usd(oneLot.margin) : 'Needs a live server price'} />
          <Row label="Commission" value={`${usd(conditions.commissionPerLotPerSide)} per lot per side (${usd(conditions.commissionPerLotPerSide * 2)} round turn)`} />
          <Row label="Swap per lot per night" value={conditions.swap ? `Buy ${usd(conditions.swap.longPerLot)} · Sell ${usd(conditions.swap.shortPerLot)}` : 'No swap'} />
          {conditions.swap && <Row label="Triple swap" value={`${weekdayName(conditions.swap.tripleWeekday)} (covers the weekend)`} />}
        </dl> : <p className="mt-1 rounded-md bg-secondary/60 p-2 text-sm text-muted-foreground" data-testid="spec-conditions-missing">{NOT_CONNECTED}: leverage, volume limits, margin, commission and swap come from the trading server’s own settings and are never guessed.</p>}
      </section>

      <section aria-labelledby="spec-hours">
        <h3 id="spec-hours" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trading hours · next 7 days</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm" data-testid="spec-state">
          {market.open ? <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /> : <LockKeyhole size={13} aria-hidden="true" />}
          {market.open ? `Open now${market.nextChange ? `, closes ${localTime(market.nextChange)} (in ${untilLabel(market.nextChange - now)})` : ''}` : `Closed${market.reason && market.reason !== 'Outside trading hours' ? ` (${market.reason})` : ''}${market.nextChange ? `, opens ${localTime(market.nextChange)} (in ${untilLabel(market.nextChange - now)})` : ''}`}
        </p>
        {rows.length ? <table className="mt-2 w-full text-sm" data-testid="spec-sessions">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1 font-medium">Opens</th><th className="py-1 font-medium">Closes</th><th className="py-1 text-right font-medium">UTC</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.utc} className={`border-t border-border/50 ${r.openNow ? 'font-medium' : ''}`}><td className="py-1.5">{r.opens}</td><td className="py-1.5">{r.closes}</td><td className="py-1.5 text-right font-mono text-[11px] text-muted-foreground">{r.utc}</td></tr>)}</tbody>
        </table> : <p className="mt-2 text-sm text-muted-foreground" data-testid="spec-sessions-none">No trading in the next 7 days.</p>}
        {hours.closures.length > 0 && <ul className="mt-2 space-y-1 text-sm" data-testid="spec-closures">{hours.closures.map(c => <li key={`${c.from}-${c.reason}`} className="rounded-md bg-amber-500/10 px-2 py-1"><LockKeyhole size={11} className="mr-1 inline" aria-hidden="true" />{c.reason}: closed {localTime(c.from)} – {localTime(c.to)}</li>)}</ul>}
        <p className="mt-2 text-[11px] text-muted-foreground" data-testid="spec-hours-source">
          {openHours(hours.sessions, now)} trading hours ahead. Times in your time zone ({zone}). {hours.source === 'server' ? 'From the trading server’s own hours, including its holiday and maintenance closures.' : 'The standard forex week (Sunday 17:00 to Friday 17:00 New York time). The trading server’s own hours and holiday closures replace this once trading is connected.'}
        </p>
      </section>
    </DialogContent>
  </Dialog>;
}
