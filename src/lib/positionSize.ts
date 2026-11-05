import { DEFAULT_PRESET, PROGRAMS, type ProgramId } from "@/lib/ruleCalculator";
import { challengeConfigs } from "@/lib/challengeConfig";
import { REWARD_RATIOS, type RiskMode } from "@/lib/riskPlanner";

/**
 * Position-size (lot-size) arithmetic for the Rules page. It uses common
 * contract conventions only (a standard forex lot is 100,000 units of the base
 * currency, a gold lot is 100 troy ounces). It never uses market prices: when a
 * conversion needs a price, the trader types the price they see on their own
 * platform. Brokers can use different contract sizes, so results are labelled
 * as planning estimates.
 */

export type InstrumentKind = "xxxusd" | "usdxxx" | "usdjpy" | "xauusd" | "custom";

export interface InstrumentConvention {
  id: InstrumentKind;
  label: string;
  examples: string;
  /** Name of one step of the stop distance, singular and plural. */
  unit: [string, string];
  /** Price change that one unit represents, for display. */
  unitSize?: number;
  /** Units of the underlying in one 1.00 lot. */
  contractSize?: number;
  contractUnit?: string;
  /** The trader must type a price to convert the pip value into US dollars. */
  needsPrice: boolean;
  priceLabel?: string;
  /** The trader types the dollar value of one unit per lot. */
  needsUnitValue: boolean;
}

export const INSTRUMENTS: InstrumentConvention[] = [
  {
    id: "xxxusd",
    label: "Forex, US dollar quoted",
    examples: "EUR/USD, GBP/USD, AUD/USD, NZD/USD",
    unit: ["pip", "pips"],
    unitSize: 0.0001,
    contractSize: 100_000,
    contractUnit: "units of the base currency",
    needsPrice: false,
    needsUnitValue: false,
  },
  {
    id: "usdxxx",
    label: "Forex, US dollar based",
    examples: "USD/CAD, USD/CHF",
    unit: ["pip", "pips"],
    unitSize: 0.0001,
    contractSize: 100_000,
    contractUnit: "US dollars",
    needsPrice: true,
    priceLabel: "Current price on your platform (for example 1.3650 for USD/CAD)",
    needsUnitValue: false,
  },
  {
    id: "usdjpy",
    label: "USD/JPY",
    examples: "US dollar / Japanese yen",
    unit: ["pip", "pips"],
    unitSize: 0.01,
    contractSize: 100_000,
    contractUnit: "US dollars",
    needsPrice: true,
    priceLabel: "Current USD/JPY price on your platform (for example 150.25)",
    needsUnitValue: false,
  },
  {
    id: "xauusd",
    label: "Gold (XAU/USD)",
    examples: "Stop measured in dollars of gold price",
    unit: ["dollar of price", "dollars of price"],
    unitSize: 1,
    contractSize: 100,
    contractUnit: "troy ounces",
    needsPrice: false,
    needsUnitValue: false,
  },
  {
    id: "custom",
    label: "Other instrument",
    examples: "Index, crypto or a cross pair: use your platform's contract details",
    unit: ["point", "points"],
    needsPrice: false,
    needsUnitValue: true,
  },
];

export const instrumentById = (id: InstrumentKind) => INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];

export const LOT_STEP = 0.01;

const round2 = (n: number) => Math.round(n * 100) / 100;
const valid = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0;

/** US-dollar value of one stop unit (pip, price dollar, point) for a 1.00 lot. */
export function unitValuePerLot(kind: InstrumentKind, price?: number, customValue?: number): number {
  switch (kind) {
    case "xxxusd":
      return 10; // 100,000 × 0.0001 USD
    case "usdxxx":
      if (!valid(price)) throw new Error("Enter the current price");
      return 10 / price; // 10 units of the quote currency, converted to USD
    case "usdjpy":
      if (!valid(price)) throw new Error("Enter the current price");
      return 1000 / price; // 100,000 × 0.01 JPY, converted to USD
    case "xauusd":
      return 100; // 100 oz × $1.00
    case "custom":
      if (!valid(customValue)) throw new Error("Enter the value of one point per lot");
      return customValue;
  }
}

export interface PositionSizeInput {
  /** Dollar amount the trader is willing to lose if the stop is hit. */
  riskAmount: number;
  kind: InstrumentKind;
  /** Stop distance in the instrument's unit (pips, price dollars, points). */
  stopDistance: number;
  price?: number;
  customValue?: number;
  /** Round-turn trading charge per 1.00 lot in USD (0 if none). */
  commissionPerLot: number;
  /** Planned reward as a multiple of the stop distance. */
  rewardRatio: number;
  /** Daily loss allowance of the chosen plan, for context. */
  dailyAllowance: number;
  accountSize: number;
  lotStep?: number;
}

export interface PositionSizeResult {
  unitValuePerLot: number;
  /** Loss per 1.00 lot when the stop is hit, including the round-turn charge. */
  lossPerLot: number;
  exactLots: number;
  /** Rounded down to the lot step so the loss never exceeds the chosen risk. */
  lots: number;
  /** The chosen risk is smaller than one minimum lot. */
  belowMinimumLot: boolean;
  minimumLotLoss: number;
  /** Units of the underlying at the rounded size, when the contract size is known. */
  units?: number;
  valuePerUnitAtSize: number;
  stopLoss: number;
  commission: number;
  /** Stop-loss amount plus the charge, at the rounded size. */
  totalLoss: number;
  /** Part of the chosen risk left unused by rounding down. */
  unusedRisk: number;
  lossPercentOfAccount: number;
  lossPercentOfDaily: number;
  lossesToDailyFloor: number;
  targetDistance: number;
  /** Net profit at the target (after the charge), at the rounded size. */
  targetProfit: number;
}

// Guards floor() against binary rounding (e.g. 0.29 / 0.01 = 28.999…).
const floorToStep = (n: number, step: number) => round2(Math.floor(n / step + 1e-9) * step);

export function sizePosition(input: PositionSizeInput): PositionSizeResult {
  if (!valid(input.riskAmount)) throw new Error("Risk must be a positive number");
  if (!valid(input.stopDistance)) throw new Error("Stop distance must be a positive number");
  if (!(Number.isFinite(input.commissionPerLot) && input.commissionPerLot >= 0)) throw new Error("Charge cannot be negative");
  if (!valid(input.rewardRatio)) throw new Error("Reward ratio must be a positive number");
  const step = input.lotStep ?? LOT_STEP;
  const convention = instrumentById(input.kind);
  const value = unitValuePerLot(input.kind, input.price, input.customValue);
  const stopPerLot = input.stopDistance * value;
  const lossPerLot = stopPerLot + input.commissionPerLot;
  const exactLots = input.riskAmount / lossPerLot;
  const lots = floorToStep(exactLots, step);
  const stopLoss = round2(lots * stopPerLot);
  const commission = round2(lots * input.commissionPerLot);
  const totalLoss = round2(stopLoss + commission);
  const targetDistance = Math.round(input.stopDistance * input.rewardRatio * 1e6) / 1e6;
  return {
    unitValuePerLot: round2(value * 1e4) / 1e4,
    lossPerLot: round2(lossPerLot),
    exactLots: Math.round(exactLots * 1e4) / 1e4,
    lots,
    belowMinimumLot: lots < step,
    minimumLotLoss: round2(step * lossPerLot),
    units: convention.contractSize ? Math.round(lots * convention.contractSize * 100) / 100 : undefined,
    valuePerUnitAtSize: round2(lots * value),
    stopLoss,
    commission,
    totalLoss,
    unusedRisk: round2(Math.max(0, input.riskAmount - totalLoss)),
    lossPercentOfAccount: round2((totalLoss / input.accountSize) * 100),
    lossPercentOfDaily: round2((totalLoss / input.dailyAllowance) * 100),
    lossesToDailyFloor: totalLoss > 0 ? Math.floor(input.dailyAllowance / totalLoss + 1e-9) : 0,
    targetDistance,
    targetProfit: round2(lots * targetDistance * value - commission),
  };
}

export interface PositionPreset {
  accountSize: number;
  program: ProgramId;
  riskMode: RiskMode;
  riskInput: string;
  kind: InstrumentKind;
  stopInput: string;
  priceInput: string;
  valueInput: string;
  commissionInput: string;
  rewardRatio: number;
}

export const DEFAULT_POSITION_PRESET: PositionPreset = {
  accountSize: DEFAULT_PRESET.accountSize,
  program: DEFAULT_PRESET.program,
  riskMode: "percent",
  riskInput: "0.5",
  kind: "xxxusd",
  stopInput: "20",
  priceInput: "",
  valueInput: "",
  commissionInput: "0",
  rewardRatio: 2,
};

const positiveText = (raw: string | null, max: number) => {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= max ? String(n) : null;
};

/**
 * Reads a shared address such as
 * /rules?size=50000&program=1-phase&risk=250&unit=usd&inst=usdjpy&stop=15&px=150.25&comm=7&rr=2#position-size.
 * Shares size, program, risk, unit and rr with the risk planner, so a planner
 * link opens the sizer on the same account and risk.
 */
export function parsePositionPreset(params: URLSearchParams): PositionPreset {
  const d = DEFAULT_POSITION_PRESET;
  const size = Number(params.get("size"));
  const accountSize = challengeConfigs.some((c) => c.accountSize === size) ? size : d.accountSize;
  const program = PROGRAMS.find((p) => p === params.get("program")) ?? d.program;
  const riskMode: RiskMode = params.get("unit") === "usd" ? "dollars" : "percent";
  const risk = positiveText(params.get("risk"), riskMode === "dollars" ? 10_000_000 : 100);
  const kind = INSTRUMENTS.find((i) => i.id === params.get("inst"))?.id ?? d.kind;
  const rawComm = params.get("comm");
  const comm = rawComm !== null && rawComm.trim() !== "" && Number.isFinite(Number(rawComm)) && Number(rawComm) >= 0 && Number(rawComm) <= 1000 ? String(Number(rawComm)) : null;
  const rr = Number(params.get("rr"));
  return {
    accountSize,
    program,
    riskMode: risk ? riskMode : d.riskMode,
    riskInput: risk ?? d.riskInput,
    kind,
    stopInput: positiveText(params.get("stop"), 1_000_000) ?? d.stopInput,
    priceInput: positiveText(params.get("px"), 1_000_000) ?? d.priceInput,
    valueInput: positiveText(params.get("pv"), 1_000_000) ?? d.valueInput,
    commissionInput: comm ?? d.commissionInput,
    rewardRatio: (REWARD_RATIOS as readonly number[]).includes(rr) ? rr : d.rewardRatio,
  };
}

export interface PositionLinkInput {
  accountSize: number;
  program?: ProgramId;
  riskMode?: RiskMode;
  riskValue?: number;
  kind?: InstrumentKind;
  stop?: number;
  price?: number;
  customValue?: number;
  commission?: number;
  rewardRatio?: number;
}

/** Relative path to the Rules page position-size calculator preloaded with these choices. */
export function positionSizeLink(input: PositionLinkInput): string {
  const params = new URLSearchParams({ size: String(input.accountSize) });
  if (input.program) params.set("program", input.program);
  if (valid(input.riskValue)) {
    params.set("risk", String(round2(input.riskValue)));
    if (input.riskMode === "dollars") params.set("unit", "usd");
  }
  if (input.kind) params.set("inst", input.kind);
  if (valid(input.stop)) params.set("stop", String(input.stop));
  const convention = input.kind ? instrumentById(input.kind) : undefined;
  if (convention?.needsPrice && valid(input.price)) params.set("px", String(input.price));
  if (convention?.needsUnitValue && valid(input.customValue)) params.set("pv", String(input.customValue));
  if (input.commission !== undefined && Number.isFinite(input.commission) && input.commission > 0) params.set("comm", String(input.commission));
  if (input.rewardRatio !== undefined) params.set("rr", String(input.rewardRatio));
  return `/rules?${params.toString()}#position-size`;
}
