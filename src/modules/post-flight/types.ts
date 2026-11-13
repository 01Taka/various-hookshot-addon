export interface PostFlightOptions {
  /** 慣性飛行の最大維持時間 (ticks, 未指定または Infinity で無制限) */
  maxTicks?: number;
  /** 慣性飛行における水平速度保持率 (デフォルト: 0.992) */
  retentionXZ?: number;
  /** 慣性飛行を開始する最小水平速度 (blocks/tick, デフォルト: 0.20) */
  minStartSpeed?: number;
  /** 慣性飛行を終了する最小水平速度 (blocks/tick, デフォルト: 0.25) */
  minMaintainSpeed?: number;
  /** 空中ストレイフ（視線・移動入力による方向微調整）を有効にするか (デフォルト: true) */
  enableAirStrafe?: boolean;
  /** 空中ストレイフの目標最大速度 (blocks/tick, デフォルト: 0.3) */
  airWishSpeed?: number;
  /** 空中ストレイフの加速度 (blocks/tick², デフォルト: 0.035) */
  airAccel?: number;
}

export interface PostFlightState {
  detachedTick: number;
  lastProcessedTick: number;
  chestplateId: string;
  activeFlightTicks: number;
  options?: PostFlightOptions;
}
