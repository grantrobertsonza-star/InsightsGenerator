import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fail:false, calls:[] as Record<string,unknown>[] }));
vi.mock("../dataSetup", () => ({
  loadDataSetupWithStatus: async () => state.fail ? {ok:false,error:"Synthetic saved-layout outage"} : {ok:true,setup:{layout:"columns_are_cases"}},
  loadDataSetup: async () => ({layout:state.fail ? "rows_are_cases" : "columns_are_cases"}),
}));
vi.mock("../crosstabs", () => ({loadDocumentFile:async()=>({storage_path:"synthetic",source_filename:"flipped.csv",selected_sheet:null}),overlayFor:async()=>null}));
vi.mock("../parseStatsFile", () => ({runStatsTool:async (_action:string,_path:string,_name:string,args:Record<string,unknown>)=>{state.calls.push(args);throw new Error("Controlled engine boundary reached");}}));
vi.mock("../db",()=>({withTenant:vi.fn()}));
vi.mock("../findingProvenance",()=>({recordHumanReview:vi.fn()}));
beforeEach(()=>{state.fail=false;state.calls=[];});
describe("driver saved layout boundary",()=>{
  const request={outcome:"q1",outcomeType:"continuous" as const,predictors:["q2","q3"]};
  it("sends the saved canonical orientation and refuses unavailable layout before engine; retry recovers",async()=>{
    const {runDriverAnalysisFor}=await import("../drivers");
    state.fail=true;
    await expect(runDriverAnalysisFor("tenant","run","doc",request)).rejects.toThrow("Synthetic saved-layout outage");
    expect(state.calls).toHaveLength(0);
    state.fail=false;
    await expect(runDriverAnalysisFor("tenant","run","doc",request)).rejects.toThrow("Controlled engine boundary reached");
    expect(state.calls).toEqual([expect.objectContaining({layout:"columns_are_cases",outcome:"q1",predictors:["q2","q3"]})]);
  });
});
