/**
 * MediaPipe pose landmark indices.
 *
 * Kept in its own module with no browser dependencies so the metrics layer can
 * be imported and exercised outside a browser, without dragging in the vision
 * WASM bundle.
 */

export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** The joints whose visibility actually determines whether gait metrics work. */
export const CORE_JOINTS = [
  LM.leftShoulder, LM.rightShoulder,
  LM.leftHip, LM.rightHip,
  LM.leftKnee, LM.rightKnee,
  LM.leftAnkle, LM.rightAnkle,
  LM.leftHeel, LM.rightHeel,
  LM.leftFootIndex, LM.rightFootIndex,
];
