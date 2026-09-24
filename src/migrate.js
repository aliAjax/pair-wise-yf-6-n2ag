// 数据升级：旧版本地数据按无质保处理，只负责结构迁移，不含页面逻辑。

import { createWarranty } from "./warranty.js";

const STORAGE_KEY = "zfl-14-repairs";
const DATA_VERSION = 2;

const defaultState = () => ({
  version: DATA_VERSION,
  filter: "all",
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
});

function ensureRepair(repair) {
  return {
    id: repair.id || crypto.randomUUID(),
    location: repair.location || "",
    title: repair.title || "",
    priority: repair.priority || "medium",
    cost: Number(repair.cost || 0),
    status: repair.status || "todo",
    photo: repair.photo || "",
    note: repair.note || "",
    // 旧记录与未完工记录统一按无质保处理
    warranty: repair.warranty || null
  };
}

export function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultState();

  try {
    const parsed = JSON.parse(saved);
    const repairs = Array.isArray(parsed.repairs) ? parsed.repairs.map(ensureRepair) : [];
    return {
      version: DATA_VERSION,
      filter: parsed.filter || "all",
      repairs
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, version: DATA_VERSION })
  );
}

// 完工补录实付信息时开启质保（旧记录补录后同样适用）
export function openWarranty(repair, paidAmount, worker, completedAt = Date.now()) {
  repair.status = "done";
  repair.warranty = createWarranty(paidAmount, worker, completedAt);
  return repair;
}
