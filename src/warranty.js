// 质保尾款：纯计算与状态流转规则
// 只处理数据，不碰 DOM / localStorage，方便单独测试与维护。

export const WARRANTY_DAYS = 30;
export const RETAIN_RATE = 0.2;

export const warrantyStatuses = {
  pending: "待放款",
  frozen: "冻结中",
  deducted: "已扣减",
  settled: "已结清"
};

// 列表筛选用到的质保视图
export const warrantyViews = {
  all: "全部尾款",
  pending: "待放款",
  frozen: "冻结",
  deducted: "扣减",
  settled: "结清",
  none: "无质保"
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUS = ["pending", "frozen"];

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function addDays(date, days) {
  const target = new Date(date);
  target.setDate(target.getDate() + days);
  return target.toISOString().slice(0, 10);
}

// 尾款金额：实付款的两成
export function calcRetain(paidAmount) {
  return round2(Number(paidAmount || 0) * RETAIN_RATE);
}

// 完工时生成质保尾款记录
export function createWarranty(paidAmount, worker, doneDate = new Date()) {
  const paid = round2(paidAmount);
  const doneOn = dateOnly(doneDate);
  return {
    paidAmount: paid,
    worker: String(worker || "").trim(),
    retainAmount: calcRetain(paid),
    doneOn,
    dueOn: addDays(doneOn, WARRANTY_DAYS),
    status: "pending",
    reworkId: null,
    deductedAmount: 0,
    settledAmount: 0,
    logs: [{ on: todayText(), action: "create", text: `完工留保 ¥${calcRetain(paid)}，${WARRANTY_DAYS} 天后结清` }]
  };
}

function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function todayText() {
  return new Date().toISOString().slice(0, 10);
}

// 距结清到期还剩几天（负数表示已逾期）
export function daysLeft(warranty, today = todayText()) {
  if (!warranty) return null;
  const due = new Date(`${warranty.dueOn}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((due - now) / DAY_MS);
}

// 是否仍在 30 天质保期内（到期当天即可结清，故按未到期计）
export function inWarrantyPeriod(warranty, today = todayText()) {
  if (!warranty) return false;
  return daysLeft(warranty, today) > 0;
}

// 到期且无冻结，才能直接放款
export function canRelease(warranty, today = todayText()) {
  return Boolean(warranty) && warranty.status === "pending" && daysLeft(warranty, today) <= 0;
}

// 质保期内、且还没挂返修，才能登记同位置返修
export function canReportRework(warranty, today = todayText()) {
  return Boolean(warranty) && warranty.status === "pending" && inWarrantyPeriod(warranty, today);
}

function appendLog(warranty, action, text) {
  warranty.logs = warranty.logs || [];
  warranty.logs.push({ on: todayText(), action, text });
}

// 到期无复发：尾款直接结清给师傅
export function settleWarranty(repairs, repairId, today = todayText()) {
  const repair = findRepair(repairs, repairId);
  const w = repair.warranty;
  if (!canRelease(w, today)) return { ok: false, message: "尾款未到期或已被冻结，暂不能放款" };
  w.settledAmount = w.retainAmount;
  w.deductedAmount = 0;
  w.status = "settled";
  appendLog(w, "release", `到期无复发，放款 ¥${w.retainAmount}`);
  return { ok: true };
}

// 质保期内同位置再报修：原尾款冻结并转到返修
export function reportRework(repairs, sourceId, reworkInput, today = todayText()) {
  const source = findRepair(repairs, sourceId);
  const w = source.warranty;
  if (!canReportRework(w, today)) return { ok: false, message: "仅质保期内的待放款尾款可以登记返修" };

  const rework = {
    id: crypto.randomUUID(),
    location: source.location,
    title: reworkInput.title || `返修：${source.title}`,
    priority: reworkInput.priority || source.priority,
    cost: Number(reworkInput.cost || 0),
    status: "doing",
    photo: reworkInput.photo || "",
    note: (reworkInput.note || "").trim() || `质保返修，关联原维修：${source.title}`,
    isRework: true,
    sourceId: source.id,
    warranty: null,
    createdAt: new Date().toISOString()
  };

  w.status = "frozen";
  w.reworkId = rework.id;
  appendLog(w, "freeze", `同位置再报修，尾款 ¥${w.retainAmount} 冻结并转到返修`);

  repairs.unshift(rework);
  return { ok: true, reworkId: rework.id };
}

// 返修修好：解冻，重新计 30 天质保观察期
export function resolveRework(repairs, reworkId, today = todayText()) {
  const rework = findRepair(repairs, reworkId);
  if (!rework || !rework.isRework) return { ok: false, message: "未找到返修记录" };
  const source = findRepair(repairs, rework.sourceId);
  if (!source || !source.warranty) return { ok: false, message: "原尾款记录缺失" };

  const w = source.warranty;
  if (w.status !== "frozen") return { ok: false, message: "尾款未冻结，无需按返修完成处理" };

  rework.status = "done";
  w.status = "pending";
  w.reworkId = null;
  w.dueOn = addDays(today, WARRANTY_DAYS);
  appendLog(w, "unfreeze", `返修完成，尾款解冻，${WARRANTY_DAYS} 天后重新结清`);
  return { ok: true };
}

// 师傅放弃：按返修支出扣减，余额才结清
export function abandonRework(repairs, reworkId, spentAmount, today = todayText()) {
  const rework = findRepair(repairs, reworkId);
  if (!rework || !rework.isRework) return { ok: false, message: "未找到返修记录" };
  const source = findRepair(repairs, rework.sourceId);
  if (!source || !source.warranty) return { ok: false, message: "原尾款记录缺失" };

  const w = source.warranty;
  if (w.status !== "frozen") return { ok: false, message: "只有冻结中的尾款可以按返修扣减" };

  const spent = Math.min(round2(spentAmount), w.retainAmount);
  if (spent < 0) return { ok: false, message: "返修支出不能为负数" };

  w.deductedAmount = spent;
  w.settledAmount = round2(w.retainAmount - spent);
  w.status = "deducted";
  w.reworkId = null;
  rework.status = "done";
  appendLog(w, "deduct", `师傅放弃，扣返修支出 ¥${spent}，余额 ¥${w.settledAmount} 结清`);
  return { ok: true };
}

// 返修单被删除：尾款解冻回到待放款（不重置到期日）
export function detachRework(repairs, reworkId) {
  const rework = findRepair(repairs, reworkId);
  if (!rework || !rework.isRework) return;
  const source = findRepair(repairs, rework.sourceId);
  if (source && source.warranty && source.warranty.reworkId === rework.id) {
    const w = source.warranty;
    w.status = "pending";
    w.reworkId = null;
    appendLog(w, "unfreeze", "返修单已删除，尾款解冻");
  }
}

// 找该位置仍在承担质保（待放款/冻结）的原维修
export function findActiveWarranty(repairs, location, today = todayText()) {
  return repairs.find((repair) => {
    const w = repair.warranty;
    if (!w || !ACTIVE_STATUS.includes(w.status)) return false;
    return repair.location.trim() === String(location || "").trim() && inWarrantyPeriod(w, today);
  }) || null;
}

// 质保台账统计
export function warrantyLedger(repairs, today = todayText()) {
  const ledger = {
    pendingAmount: 0,
    frozenAmount: 0,
    deductedAmount: 0,
    settledAmount: 0,
    pendingCount: 0,
    frozenCount: 0,
    deductedCount: 0,
    settledCount: 0,
    noWarrantyCount: 0
  };
  for (const repair of repairs) {
    const w = repair.warranty;
    if (!w) {
      if (repair.status === "done") ledger.noWarrantyCount += 1;
      continue;
    }
    if (w.status === "pending") {
      ledger.pendingAmount += w.retainAmount;
      ledger.pendingCount += 1;
    } else if (w.status === "frozen") {
      ledger.frozenAmount += w.retainAmount;
      ledger.frozenCount += 1;
    } else if (w.status === "deducted") {
      ledger.deductedAmount += w.deductedAmount;
      ledger.settledAmount += w.settledAmount;
      ledger.deductedCount += 1;
    } else if (w.status === "settled") {
      ledger.settledAmount += w.settledAmount;
      ledger.settledCount += 1;
    }
  }
  ledger.pendingAmount = round2(ledger.pendingAmount);
  ledger.frozenAmount = round2(ledger.frozenAmount);
  ledger.deductedAmount = round2(ledger.deductedAmount);
  ledger.settledAmount = round2(ledger.settledAmount);
  return ledger;
}

export function formatMoney(value) {
  return `¥${round2(value).toFixed(2)}`;
}

function findRepair(repairs, id) {
  return repairs.find((repair) => repair.id === id);
}
