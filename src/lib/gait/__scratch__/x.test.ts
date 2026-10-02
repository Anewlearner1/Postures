import { it } from "vitest";
import { analyzeGait } from "../analyze";
import { buildTrack } from "../preprocess";
import { rejectMeasurements } from "../quality";
import { generateWalk } from "../testing/synthetic";
it("x", () => {
  for (const noisePx of [4, 8, 12]) for (const dist of [6, 8]) {
    const sim = generateWalk({ passes: 3, noisePx, cameraDistanceM: dist });
    const o = analyzeGait(sim.frames, sim.meta);
    const r = rejectMeasurements(buildTrack(sim.frames, sim.meta), sim.meta.durationSec);
    console.log("SIDE", noisePx, dist, o.status === "rejected" ? o.code : "ok " + o.result.confidence.overall, "jumps", r.identityJumps);
  }
  const sim = generateWalk({ width: 1080, height: 1920, walkwayYawDeg: 90, startDirection: 1, cameraDistanceM: 8, walkwayM: 4, passes: 3, noisePx: 8, noseVisibility: 0.2, jointVisibility: { near: { ear: 0.4 }, far: { ear: 0.4 } } });
  const o = analyzeGait(sim.frames, sim.meta);
  console.log("BACK noface", o.status === "rejected" ? o.code : "ok");
});
