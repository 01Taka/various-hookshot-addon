import { Player } from "@minecraft/server";

export interface InertiaFlightOptions {
  /** 慣性飛行の最大維持時間 (ticks, 未指定または Infinity で無制限) */
  maxTicks?: number;
  /** 慣性飛行における水平速度保持率 (デフォルト: 0.988) */
  retentionXZ?: number;
  /** 慣性飛行を開始する最小水平速度 (blocks/tick, デフォルト: 0.20) */
  minStartSpeed?: number;
  /** 慣性飛行を終了する最小水平速度 (blocks/tick, デフォルト: 0.25) */
  minMaintainSpeed?: number;
  /** 空中ストレイフの目標最大速度 (blocks/tick, デフォルト: 0.3) */
  airWishSpeed?: number;
  /** 空中ストレイフの加速度 (blocks/tick², デフォルト: 0.035) */
  airAccel?: number;
}

export interface InertiaFlightState {
  startedTick: number;
  lastProcessedTick: number;
  providerId: string;
  activeFlightTicks: number;
  options?: InertiaFlightOptions;
}

export interface InertiaFlightProviderResult {
  providerId: string;
  options: InertiaFlightOptions;
  /** 慣性飛行が1Tick適用された後に呼ばれるコールバック */
  onTickActive?: (player: Player, activeFlightTicks: number) => void;
}

export type InertiaFlightProvider = (
  player: Player,
) => InertiaFlightProviderResult | null;
