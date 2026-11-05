import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Link2, Scale } from "lucide-react";
import { challengeConfigs } from "@/lib/challengeConfig";
import { getRulePlan, PROGRAMS as programs, type ProgramId } from "@/lib/ruleCalculator";
import { REWARD_RATIOS, type RiskMode } from "@/lib/riskPlanner";
import {
  INSTRUMENTS,
  instrumentById,
  LOT_STEP,
  parsePositionPreset,
  positionSizeLink,
  sizePosition,
  type InstrumentKind,
  type PositionPreset,
} from "@/lib/positionSize";
import GlossaryTip from "@/components/GlossaryTip";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number, digits = 2) => n.toLocaleString("en-US", { maximumFractionDigits: digits });

const chip = (active: boolean) =>
  `px-3 py-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const parsePositive = (text: string) => {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const plural = (n: number, [one, many]: [string, string]) => `${num(n, 5)} ${n === 1 ? one : many}`;

export default function PositionSizeCalculator() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [state, setState] = useState<PositionPreset>(() => parsePositionPreset(searchParams));
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">("idle");

  // A link such as "Turn this risk into a lot size" opens this section with new choices.
  useEffect(() => {
    if (navigationType === "PUSH" && location.hash === "#position-size") {
      setState(parsePositionPreset(new URLSearchParams(location.search)));
    }
    // Only a new navigation should reload the choices, not typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const set = <K extends keyof PositionPreset>(key: K, value: PositionPreset[K]) => setState((s) => ({ ...s, [key]: value }));

  const { accountSize, program, riskMode, riskInput, kind, stopInput, priceInput, valueInput, commissionInput, rewardRatio } = state;
  const plan = useMemo(() => getRulePlan(accountSize, program as ProgramId), [accountSize, program]);
  const dailyAllowance = Math.round(accountSize * plan.dailyLossPercent) / 100;
  const convention = instrumentById(kind);

  const riskValue = parsePositive(riskInput);
  const riskValid = riskValue !== undefined && (riskMode === "dollars" ? riskValue >= 0.01 : riskValue <= 100);
  const riskAmount = riskValid ? Math.round((riskMode === "percent" ? (accountSize * riskValue!) / 100 : riskValue!) * 100) / 100 : 0;
  const stop = parsePositive(stopInput);
  const price = parsePositive(priceInput);
  const customValue = parsePositive(valueInput);
  const commissionText = commissionInput.trim() === "" ? "0" : commissionInput;
  const commission = Number(commissionText);
  const commissionValid = Number.isFinite(commission) && commission >= 0 && commission <= 1000;
  const priceValid = !convention.needsPrice || price !== undefined;
  const valueValid = !convention.needsUnitValue || customValue !== undefined;

  const ready = riskValid && riskAmount > 0 && stop !== undefined && priceValid && valueValid && commissionValid;
  const result = ready
    ? sizePosition({ riskAmount, kind, stopDistance: stop!, price, customValue, commissionPerLot: commission, rewardRatio, dailyAllowance, accountSize })
    : null;

  const sharePath = positionSizeLink({
    accountSize,
    program: program as ProgramId,
    riskMode,
    riskValue: riskValid ? riskValue : undefined,
    kind,
    stop,
    price,
    customValue,
    commission: commissionValid ? commission : undefined,
    rewardRatio,
  });
  const shareUrl = typeof window === "undefined" ? sharePath : `${window.location.origin}${sharePath}`;
  useEffect(() => setShareState("idle"), [sharePath]);

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
    } catch {
      setShareState("manual");
    }
  };

  const switchMode = (mode: RiskMode) => {
    if (mode === riskMode) return;
    if (riskValid) {
      const next = mode === "dollars" ? (accountSize * riskValue!) / 100 : (riskValue! / accountSize) * 100;
      setState((s) => ({ ...s, riskMode: mode, riskInput: String(Math.round(next * 100) / 100) }));
    } else {
      set("riskMode", mode);
    }
  };

  const unitPlural = convention.unit[1];

  return (
    <section id="position-size" aria-labelledby="position-size-title" className="premium-card mb-8 scroll-mt-24">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
          <Scale size={18} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h2 id="position-size-title" className="text-lg font-semibold">Position size calculator</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn your risk per trade into a lot size: pick the instrument, enter how far away your stop loss is, and see the largest position that keeps a stopped-out trade inside your risk, and how much of today's loss allowance it would use.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium mb-2">Account size</legend>
          <div className="flex flex-wrap gap-2">
            {challengeConfigs.map((c) => (
              <button key={c.accountSize} type="button" aria-pressed={accountSize === c.accountSize} className={chip(accountSize === c.accountSize)} onClick={() => set("accountSize", c.accountSize)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Program">
            {programs.map((p) => (
              <button key={p} type="button" aria-pressed={program === p} className={chip(program === p)} onClick={() => set("program", p)}>
                {p}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <span className="text-sm font-medium" id="ps-risk-unit-label">Risk per trade</span> <GlossaryTip term="risk-per-trade" />
          <div className="mt-1 flex gap-2" role="group" aria-labelledby="ps-risk-unit-label">
            <button type="button" aria-pressed={riskMode === "percent"} className={chip(riskMode === "percent")} onClick={() => switchMode("percent")}>% of account</button>
            <button type="button" aria-pressed={riskMode === "dollars"} className={chip(riskMode === "dollars")} onClick={() => switchMode("dollars")}>Dollars</button>
          </div>
          <label htmlFor="ps-risk" className="sr-only">{riskMode === "percent" ? "Risk per trade (% of account)" : "Risk per trade (USD)"}</label>
          <input id="ps-risk" inputMode="decimal" className={`${inputClass} mt-2`} value={riskInput} onChange={(e) => set("riskInput", e.target.value)} aria-invalid={!riskValid} aria-describedby="ps-risk-help" />
          <p id="ps-risk-help" className={`mt-1 text-xs ${riskValid ? "text-muted-foreground" : "text-destructive"}`}>
            {riskValid
              ? riskMode === "percent"
                ? `${usd(riskAmount)} of a ${usd(accountSize)} account.`
                : `${Math.round((riskAmount / accountSize) * 10000) / 100}% of a ${usd(accountSize)} account.`
              : riskMode === "percent"
                ? "Enter a percentage above 0, for example 0.5."
                : "Enter a dollar amount above 0, for example 125."}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor="ps-instrument" className="block text-sm font-medium">Instrument</label>
        <select
          id="ps-instrument"
          className={`${inputClass} mt-1 md:max-w-md`}
          value={kind}
          onChange={(e) => set("kind", e.target.value as InstrumentKind)}
          aria-describedby="ps-instrument-help"
        >
          {INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>{i.label}</option>
          ))}
        </select>
        <p id="ps-instrument-help" className="mt-1 text-xs text-muted-foreground">
          {convention.examples}.
          {convention.contractSize
            ? ` Assumes 1.00 lot = ${num(convention.contractSize)} ${convention.contractUnit}${convention.unitSize ? ` and 1 ${convention.unit[0]} = ${convention.unitSize}` : ""}.`
            : " Use the value your platform shows for one point on 1.00 lot."}
        </p>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div>
          <label htmlFor="ps-stop" className="text-sm font-medium">Stop-loss distance ({unitPlural})</label> <GlossaryTip term="stop-loss" />
          <input id="ps-stop" inputMode="decimal" className={`${inputClass} mt-1`} value={stopInput} onChange={(e) => set("stopInput", e.target.value)} aria-invalid={stop === undefined} aria-describedby="ps-stop-help" />
          <p id="ps-stop-help" className={`mt-1 text-xs ${stop !== undefined ? "text-muted-foreground" : "text-destructive"}`}>
            {stop !== undefined ? "Distance from your entry to your stop." : `Enter the distance in ${unitPlural}, above 0.`}
          </p>
        </div>
        {convention.needsPrice && (
          <div>
            <label htmlFor="ps-price" className="text-sm font-medium">Current price</label>
            <input id="ps-price" inputMode="decimal" className={`${inputClass} mt-1`} value={priceInput} onChange={(e) => set("priceInput", e.target.value)} aria-invalid={!priceValid} aria-describedby="ps-price-help" />
            <p id="ps-price-help" className={`mt-1 text-xs ${priceValid ? "text-muted-foreground" : "text-destructive"}`}>
              {convention.priceLabel}. Needed to turn the pip value into US dollars; we never fill in prices for you.
            </p>
          </div>
        )}
        {convention.needsUnitValue && (
          <div>
            <label htmlFor="ps-value" className="text-sm font-medium">Value of 1 point on 1.00 lot (USD)</label> <GlossaryTip term="pip-value" />
            <input id="ps-value" inputMode="decimal" className={`${inputClass} mt-1`} value={valueInput} onChange={(e) => set("valueInput", e.target.value)} aria-invalid={!valueValid} aria-describedby="ps-value-help" />
            <p id="ps-value-help" className={`mt-1 text-xs ${valueValid ? "text-muted-foreground" : "text-destructive"}`}>
              From your platform's contract details (often called tick value or point value). For an instrument whose 1.00 lot is 1 unit priced in dollars, this is 1.
            </p>
          </div>
        )}
        <div>
          <label htmlFor="ps-commission" className="text-sm font-medium">Trading charge per 1.00 lot, round turn (USD)</label> <GlossaryTip term="commission" />
          <input id="ps-commission" inputMode="decimal" className={`${inputClass} mt-1`} value={commissionInput} onChange={(e) => set("commissionInput", e.target.value)} aria-invalid={!commissionValid} aria-describedby="ps-commission-help" />
          <p id="ps-commission-help" className={`mt-1 text-xs ${commissionValid ? "text-muted-foreground" : "text-destructive"}`}>
            {commissionValid ? "Opening plus closing charge. Leave 0 if you don't know it yet; the size then excludes charges." : "Enter 0 or a dollar amount up to 1,000."}
          </p>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Take profit at <GlossaryTip term="take-profit" /></legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {REWARD_RATIOS.map((r) => (
              <button key={r} type="button" aria-pressed={rewardRatio === r} className={chip(rewardRatio === r)} onClick={() => set("rewardRatio", r)}>
                {r}× stop
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {result && (
        <div className="mt-8 grid gap-6 md:grid-cols-2" aria-live="polite">
          <div className="rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold">Position size</h3>
            {result.belowMinimumLot ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-destructive" data-testid="ps-too-small">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {usd(riskAmount)} is less than the smallest position ({LOT_STEP} lot), which would lose {usd(result.minimumLotLoss)} at this stop. Use a closer stop, a bigger risk, or skip the trade.
                </span>
              </p>
            ) : (
              <>
                <p className="mt-3 text-3xl font-bold tabular-nums" data-testid="ps-lots">{result.lots.toFixed(2)} lots</p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {result.units !== undefined ? `${num(result.units)} ${convention.contractUnit} · ` : ""}
                  {usd(result.valuePerUnitAtSize)} per {convention.unit[0]} · exact size {num(result.exactLots, 4)}, rounded down to {LOT_STEP}
                </p>
              </>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">One 1.00 lot <GlossaryTip term="lot" /></dt>
                <dd className="font-semibold tabular-nums">{usd(result.unitValuePerLot)} per {convention.unit[0]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Loss per 1.00 lot at this stop <GlossaryTip term="pip-value" /></dt>
                <dd className="font-semibold tabular-nums">{usd(result.lossPerLot)}</dd>
              </div>
            </dl>
          </div>

          {!result.belowMinimumLot && (
            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold">If the trade hits the stop or the target</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Loss at the stop</dt>
                  <dd className="text-xl font-bold tabular-nums" data-testid="ps-loss">{usd(result.totalLoss)}</dd>
                  <dd className="text-xs text-muted-foreground tabular-nums">
                    {result.commission > 0 ? `${usd(result.stopLoss)} + ${usd(result.commission)} charges · ` : ""}
                    {result.lossPercentOfAccount}% of the account
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Share of today's loss allowance</dt>
                  <dd className="text-xl font-bold tabular-nums">{result.lossPercentOfDaily}%</dd>
                  <dd className="text-xs text-muted-foreground tabular-nums">
                    of {usd(dailyAllowance)} ({plan.dailyLossPercent}%) · {result.lossesToDailyFloor} such {result.lossesToDailyFloor === 1 ? "loss fits" : "losses fit"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Target distance</dt>
                  <dd className="text-xl font-bold tabular-nums">{plural(result.targetDistance, convention.unit)}</dd>
                  <dd className="text-xs text-muted-foreground">{rewardRatio}× your stop</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Profit at the target</dt>
                  <dd className="text-xl font-bold tabular-nums">{usd(result.targetProfit)}</dd>
                  <dd className="text-xs text-muted-foreground">after charges</dd>
                </div>
              </dl>
              {result.lossPercentOfDaily > 100 && (
                <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>One stopped-out trade at this size is bigger than the whole daily allowance and could record a breach.</span>
                </p>
              )}
              {result.unusedRisk > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">Rounding down to whole {LOT_STEP} lots leaves {usd(result.unusedRisk)} of your risk unused, so the loss never goes over what you chose.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copyLink} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {shareState === "copied" ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          {shareState === "copied" ? "Link copied" : "Copy a link to this calculation"}
        </button>
        <span className="text-xs text-muted-foreground" role="status">
          {shareState === "copied" ? "Anyone opening it sees the same account, risk, instrument and stop." : ""}
        </span>
      </div>
      {shareState === "manual" && (
        <div className="mt-3">
          <label htmlFor="ps-share-url" className="text-xs text-muted-foreground">Copying isn't available in this browser. Select and copy this address:</label>
          <input id="ps-share-url" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} mt-1`} />
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Planning arithmetic only, using common contract conventions. Contract sizes, minimum lot, charges and instrument availability on FYNX Funded accounts are pending broker verification, so always check the contract details on your trading platform before placing a trade. Slippage and gaps can make a real loss bigger than the stop. Not trading advice. Nothing here is saved or sent anywhere.
      </p>
    </section>
  );
}
