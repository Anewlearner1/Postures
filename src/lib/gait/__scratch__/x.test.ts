import { it } from "vitest";
import { analyzeGait } from "../analyze";
import { generateWalk, type SyntheticOptions } from "../testing/synthetic";
const f = (name: string, o: SyntheticOptions) => {
  const sim = generateWalk({ noisePx: 2, ...o });
  const out = analyzeGait(sim.frames, sim.meta);
  if (out.status !== "ok") return console.log("R", name, out.code);
  const d = out.details!;
  const truthSteps = sim.truth.events.filter((e) => e.type === "heel_strike" && d.passes.some((p) => e.timeSec >= p.startSec && e.timeSec <= p.endSec)).length;
  const trunk = out.result.findings.find((x) => x.subtype === "trunk_forward_lean")!;
  console.log("R", name, "steps", out.result.walking.stepsAnalyzed, "truth-in-pass", truthSteps, "cycles", out.result.walking.validCyclesTotal, "trunk", trunk.severity, trunk.metrics.TRK, "persist", trunk.trunkLeanPersistent, JSON.stringify(trunk.userMetric));
};
it("x", () => {
  f("normal 3 passes", { passes: 3 });
  f("normal 4 passes", { passes: 4 });
  f("far occluded", { passes: 3, farVisibility: 0.3 });
  f("trunk 10", { passes: 3, gait: { trunkLeanDeg: 10 } });
  f("trunk 15", { passes: 3, gait: { trunkLeanDeg: 15 } });
  f("trunk 8 wobble 5", { passes: 3, gait: { trunkLeanDeg: 8 }, trunkWobbleDeg: 5 });
  f("trunk 7.5", { passes: 3, gait: { trunkLeanDeg: 7.5 } });
});
