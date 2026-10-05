/**
 * Central engineering layout constants for CAD_RENDER_ENGINE=v2.
 * All placement / routing snaps to these values — no scattered magic numbers.
 */

export interface LayoutConfig {
  gridSize: number;
  nodeSpacingX: number;
  nodeSpacingY: number;
  routeClearance: number;
  labelClearance: number;
  horizontalLaneSpacing: number;
  verticalLaneSpacing: number;
  pageMargin: number;
  minimumNodeGap: number;
  branchSpacing: number;
  portSpacing: number;
  minBlockWidth: number;
  minBlockHeight: number;
  bendPenalty: number;
  crossingPenalty: number;
  congestionPenalty: number;
  charWidth: number;
  titleBand: number;
  footerBand: number;
}

export const LAYOUT_CONFIG: LayoutConfig = {
  gridSize: 8,
  nodeSpacingX: 180,
  nodeSpacingY: 64,
  routeClearance: 8,
  labelClearance: 6,
  horizontalLaneSpacing: 12,
  verticalLaneSpacing: 14,
  pageMargin: 48,
  minimumNodeGap: 28,
  branchSpacing: 72,
  portSpacing: 14,
  minBlockWidth: 72,
  minBlockHeight: 36,
  bendPenalty: 18,
  crossingPenalty: 40,
  congestionPenalty: 4,
  charWidth: 7.2,
  titleBand: 56,
  footerBand: 36,
};

export function snap(v: number, grid = LAYOUT_CONFIG.gridSize): number {
  return Math.round(v / grid) * grid;
}
