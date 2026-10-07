import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as server from "../src/apiRuleEngine";
import * as browser from "../../src/services/api-rule-engine";
import * as serverPolicy from "../src/fundedPolicy";
import * as browserPolicy from "../../src/services/funded-policy";

describe("generated policy parity",()=>{
  it("keeps server and browser engine sources identical",()=>{
    expect(readFileSync("functions/src/apiRuleEngine.ts","utf8")).toBe(readFileSync("src/services/api-rule-engine.ts","utf8"));
    expect(readFileSync("functions/src/fundedPolicy.ts","utf8").replace("'./apiRuleEngine'","'./api-rule-engine'")).toBe(readFileSync("src/services/funded-policy.ts","utf8"));
  });
  it.each(["1-phase","2-phase","3-phase"])("keeps %s purchased rules identical",program=>{
    const context={program,phase:1,starting_balance:"10000",currency:"USD"};
    expect(browserPolicy.ruleSnapshot(context)).toEqual(serverPolicy.ruleSnapshot(context));
  });
  it("calculates a conservative position using the same decimal engine",()=>{
    const input={instrument_type:"forex",symbol:"EURUSD",account_currency:"USD",contract_size:"100000",quote_to_account_rate:"1",entry_price:"1.1000",stop_loss_price:"1.0990",direction:"long",risk_amount:"100",lot_step:"0.01",minimum_lot:"0.01"};
    const result=server.risk("position-size",input);
    expect(result.position_size).toBe("1");expect(browser.risk("position-size",input)).toEqual(result);
  });
  it("rejects unreviewed purchased agreements on both platforms",()=>{
    expect(()=>serverPolicy.evaluate({},[])).toThrow();expect(()=>browserPolicy.evaluate({},[])).toThrow();
  });
});
