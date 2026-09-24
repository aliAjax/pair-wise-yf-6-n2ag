// 数据升级：localStorage 旧版本结构 -> 质保尾款版本
// 与尾款计算、页面展示分开维护；升级只做一次、保持幂等。

export const STORAGE_KEY = "zfl-14-repairs";
export const DATA_VERSION = 2;

export function migrate(rawState) {
  let state;
  try {
    state = typeof rawState === "string" ? JSON.parse(rawState) : rawState;
  } catch {
    state = null;
  }
  if (!state || typeof state !== "object") return null;

  // v1 -> v2：旧记录按无质保处理，只补结构，不补算尾款
  if (!state.version || state.version < 2) {
    state.version = 2;
    state.warrantyFilter = state.warrantyFilter || "all";
    state.repairs = Array.isArray(state.repairs)
      ? state.repairs.map((repair) => migrateRepair(repair))
      : [];
  }

  return state;
}

function migrateRepair(repair) {
  const migrated = {
    id: repair.id || crypto.randomUUID(),
    location: repair.location || "",
    title: repair.title || "",
    priority: repair.priority || "medium",
    cost: Number(repair.cost || 0),
    status: repair.status || "todo",
    photo: repair.photo || "",
    note: repair.note || "",
    // 旧记录没有实付/师傅信息，统一视为无质保
    warranty: null
  };
  if (repair.isRework) {
    migrated.isRework = true;
    migrated.sourceId = repair.sourceId || null;
  }
  return migrated;
}

// 全新用户的初始数据
export function defaultState() {
  return {
    version: DATA_VERSION,
    filter: "all",
    warrantyFilter: "all",
    repairs: [
      {
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        warranty: null
      }
    ]
  };
}

export function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultState();
  return migrate(saved) || defaultState();
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
