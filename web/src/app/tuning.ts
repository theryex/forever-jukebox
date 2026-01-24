import type { AppContext } from "./context";

const MIN_RANDOM_BRANCH_DELTA = 0;
const MAX_RANDOM_BRANCH_DELTA = 0.2;
const TUNING_PARAM_KEYS = ["lb", "jb", "lg", "sq", "thresh", "bp"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mapPercentToRange(percent: number, min: number, max: number) {
  const safePercent = clamp(percent, 0, 100);
  return ((max - min) * safePercent) / 100 + min;
}

function mapValueToPercent(value: number, min: number, max: number) {
  const safeValue = clamp(value, min, max);
  return (100 * (safeValue - min)) / (max - min);
}

function filterTuningParams(params: URLSearchParams): URLSearchParams {
  const filtered = new URLSearchParams();
  for (const key of TUNING_PARAM_KEYS) {
    const value = params.get(key);
    if (value !== null) {
      filtered.set(key, value);
    }
  }
  return filtered;
}

export function getTuningParamsFromUrl(): URLSearchParams {
  return filterTuningParams(new URLSearchParams(window.location.search));
}

export function getTuningParamsStringFromUrl(): string | null {
  const params = getTuningParamsFromUrl();
  const result = params.toString();
  return result.length > 0 ? result : null;
}

export function hasTuningParamsInUrl(): boolean {
  return getTuningParamsFromUrl().toString().length > 0;
}

export function applyTuningParamsToEngine(
  context: AppContext,
  params: URLSearchParams,
): boolean {
  const hasTuningParam = TUNING_PARAM_KEYS.some((key) => params.has(key));
  if (!hasTuningParam) {
    return false;
  }
  const defaults = context.defaultConfig;
  const nextConfig = { ...defaults };
  if (params.has("lb")) {
    nextConfig.addLastEdge = params.get("lb") !== "0";
  }
  if (params.get("jb") === "1") {
    nextConfig.justBackwards = true;
  }
  if (params.get("lg") === "1") {
    nextConfig.justLongBranches = true;
  }
  if (params.get("sq") === "0") {
    nextConfig.removeSequentialBranches = true;
  }
  if (params.has("thresh")) {
    const raw = Number.parseInt(params.get("thresh") ?? "", 10);
    if (Number.isFinite(raw) && raw >= 0) {
      nextConfig.currentThreshold = raw;
    }
  }
  if (params.has("bp")) {
    const fields = (params.get("bp") ?? "").split(",");
    if (fields.length === 3) {
      const minPct = Number.parseInt(fields[0] ?? "", 10);
      const maxPct = Number.parseInt(fields[1] ?? "", 10);
      const deltaPct = Number.parseInt(fields[2] ?? "", 10);
      if (Number.isFinite(minPct)) {
        nextConfig.minRandomBranchChance = mapPercentToRange(minPct, 0, 1);
      }
      if (Number.isFinite(maxPct)) {
        nextConfig.maxRandomBranchChance = mapPercentToRange(maxPct, 0, 1);
      }
      if (Number.isFinite(deltaPct)) {
        nextConfig.randomBranchChanceDelta = mapPercentToRange(
          deltaPct,
          MIN_RANDOM_BRANCH_DELTA,
          MAX_RANDOM_BRANCH_DELTA,
        );
      }
    }
  }
  context.engine.updateConfig(nextConfig);
  return true;
}

export function applyTuningParamsFromUrl(context: AppContext): boolean {
  const params = getTuningParamsFromUrl();
  const applied = applyTuningParamsToEngine(context, params);
  if (applied) {
    syncTuningParamsState(context);
  }
  return applied;
}

export function getTuningParamsFromEngine(context: AppContext): URLSearchParams {
  const params = new URLSearchParams();
  const config = context.engine.getConfig();
  const defaults = context.defaultConfig;
  if (!config.addLastEdge) {
    params.set("lb", "0");
  }
  if (config.justBackwards) {
    params.set("jb", "1");
  }
  if (config.justLongBranches) {
    params.set("lg", "1");
  }
  if (config.removeSequentialBranches) {
    params.set("sq", "0");
  }
  if (config.currentThreshold !== 0) {
    params.set("thresh", `${Math.round(config.currentThreshold)}`);
  }
  const minChanged =
    config.minRandomBranchChance !== defaults.minRandomBranchChance;
  const maxChanged =
    config.maxRandomBranchChance !== defaults.maxRandomBranchChance;
  const deltaChanged =
    config.randomBranchChanceDelta !== defaults.randomBranchChanceDelta;
  if (minChanged || maxChanged || deltaChanged) {
    const minPct = Math.round(
      mapValueToPercent(config.minRandomBranchChance, 0, 1),
    );
    const maxPct = Math.round(
      mapValueToPercent(config.maxRandomBranchChance, 0, 1),
    );
    const deltaPct = Math.round(
      mapValueToPercent(
        config.randomBranchChanceDelta,
        MIN_RANDOM_BRANCH_DELTA,
        MAX_RANDOM_BRANCH_DELTA,
      ),
    );
    params.set("bp", `${minPct},${maxPct},${deltaPct}`);
  }
  return params;
}

export function syncTuningParamsState(context: AppContext): string | null {
  const params = getTuningParamsFromEngine(context);
  const result = params.toString();
  context.state.tuningParams = result.length > 0 ? result : null;
  return context.state.tuningParams;
}

export function writeTuningParamsToUrl(
  tuningParams: string | null,
  replace = true,
) {
  const url = new URL(window.location.href);
  for (const key of TUNING_PARAM_KEYS) {
    url.searchParams.delete(key);
  }
  if (tuningParams) {
    const params = new URLSearchParams(tuningParams);
    params.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function clearTuningParamsFromUrl(replace = true) {
  writeTuningParamsToUrl(null, replace);
}
