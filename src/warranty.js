// 质保尾款：纯计算与状态流转，不碰 DOM 和 localStorage。

export const WARRANTY_DAYS = 30; // 质保期：完工后三十天
export const RETAIN_RATIO = 0.2; // 尾款比例：实付款留两成

// 列表中展示的尾款状态
export const warrantyStates = {
  pending: "待放款",
  frozen: "冻结",
  deducted: "扣减",
  settled: "结清"
};

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// 从实付金额中预留两成尾款
export function calcRetain(paidAmount) {
  const amount = Math.max(0, Number(paidAmount) || 0);
  return round2(amount * RETAIN_RATIO);
}

// 完工时生成质保尾款记录
export function createWarranty(paidAmount, worker, completedAt = Date.now()) {
  const retain = calcRetain(paidAmount);
  return {
    worker: String(worker || "").trim(),
    paid: round2(paidAmount),
    retain,
    state: "pending",
    completedAt,
    dueAt: completedAt + WARRANTY_DAYS * 24 * 60 * 60 * 1000,
    reworkId: "",
    deducted: 0,
    settledAt: 0
  };
}

export function hasWarranty(repair) {
  return Boolean(repair && repair.warranty);
}

export function daysLeft(warranty, now = Date.now()) {
  return Math.max(0, Math.ceil((warranty.dueAt - now) / (24 * 60 * 60 * 1000)));
}

export function isDue(warranty, now = Date.now()) {
  return now >= warranty.dueAt;
}

// 质保期内（含到期当天）同位置是否有生效中的质保，用于识别返修
export function findActiveWarranty(repairs, location, now = Date.now()) {
  const place = String(location || "").trim();
  if (!place) return null;
  return (
    repairs.find((repair) => {
      const w = repair.warranty;
      if (!w || w.state === "settled" || w.state === "deducted") return false;
      return repair.location === place && now >= w.completedAt && now <= w.dueAt;
    })?.warranty || null
  );
}

// 质保期内同位置再报修：原尾款冻结并转到返修
export function freezeForRework(warranty, reworkId) {
  if (warranty.state !== "pending") return warranty;
  return { ...warranty, state: "frozen", reworkId };
}

// 返修处理完：解除冻结，尾款继续等到期结清
export function resolveRework(warranty) {
  if (warranty.state !== "frozen") return warranty;
  return { ...warranty, state: "pending", reworkId: "" };
}

// 到期无复发：直接放款结清
export function canRelease(warranty, now = Date.now()) {
  return warranty.state === "pending" && isDue(warranty, now);
}

export function settle(warranty, now = Date.now()) {
  if (warranty.state !== "pending") return warranty;
  return { ...warranty, state: "settled", settledAt: now };
}

// 师傅放弃返修：按返修支出扣减尾款，余额结清（支出≥尾款时全额抵扣）
export function deductForAbandon(warranty, reworkCost, now = Date.now()) {
  if (warranty.state !== "frozen") return warranty;
  const cost = Math.max(0, round2(reworkCost));
  const deducted = round2(Math.min(warranty.retain, cost));
  return {
    ...warranty,
    state: "deducted",
    deducted,
    settledAt: now,
    released: round2(warranty.retain - deducted)
  };
}

// 汇总四类尾款金额
export function summarizeWarranties(repairs) {
  const summary = { pending: 0, frozen: 0, deducted: 0, settled: 0 };
  repairs.forEach((repair) => {
    const w = repair.warranty;
    if (!w) return;
    if (w.state === "deducted") {
      summary.deducted += w.deducted || 0;
      return;
    }
    summary[w.state] += w.retain || 0;
  });
  return {
    pending: round2(summary.pending),
    frozen: round2(summary.frozen),
    deducted: round2(summary.deducted),
    settled: round2(summary.settled)
  };
}
