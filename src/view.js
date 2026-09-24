// 页面展示：只负责把 state 渲染成 HTML 字符串
// 尾款规则见 warranty.js，数据升级见 migrate.js，三者分开维护。

import {
  warrantyStatuses,
  warrantyViews,
  daysLeft,
  canRelease,
  canReportRework,
  formatMoney
} from "./warranty.js";

const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

export { statuses, priorities, warrantyStatuses };

export function renderApp(state, ledger, today) {
  const repairs = visibleRepairs(state.repairs, state.filter, state.warrantyFilter, today);

  return `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${countUnfinished(state.repairs)}</strong></div>
          <div class="stat"><span>处理中</span><strong>${countDoing(state.repairs)}</strong></div>
          <div class="stat"><span>预计费用</span><strong>${formatMoney(sumUnfinishedCost(state.repairs))}</strong></div>
        </section>
      </header>

      ${renderLedger(ledger)}

      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
            <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) =>
              `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`
            ).join("")}
          </div>
          <div class="toolbar warranty-bar">
            ${Object.entries(warrantyViews).map(([value, label]) =>
              `<button class="seg wseg ${state.warrantyFilter === value ? "active" : ""}" data-warranty-filter="${value}">${label}</button>`
            ).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map((repair) => renderRepair(repair, today)).join("") : `<div class="empty">当前筛选下没有维修事项</div>`}
          </div>
        </section>
      </section>
    </main>
  `;
}

function renderLedger(ledger) {
  const items = [
    { label: "待放款尾款", value: formatMoney(ledger.pendingAmount), sub: `${ledger.pendingCount} 笔`, cls: "pending" },
    { label: "冻结中尾款", value: formatMoney(ledger.frozenAmount), sub: `${ledger.frozenCount} 笔`, cls: "frozen" },
    { label: "累计扣减", value: formatMoney(ledger.deductedAmount), sub: `${ledger.deductedCount} 笔`, cls: "deducted" },
    { label: "累计结清", value: formatMoney(ledger.settledAmount), sub: `${ledger.settledCount} 笔`, cls: "settled" }
  ];
  return `
    <section class="ledger">
      ${items.map((item) => `
        <div class="ledger-item ${item.cls}">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <em>${item.sub}</em>
        </div>
      `).join("")}
    </section>
  `;
}

function renderRepair(repair, today) {
  const reworkSource = repair.isRework ? repair : null;
  return `
    <article class="repair ${repair.isRework ? "rework" : ""}">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          ${repair.isRework ? `<span class="rework-tag">返修单</span>` : ""}
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ${formatMoney(repair.cost)}</span>
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
          ${reworkSource ? `<span class="chip rework-link" data-goto="${escapeHtml(reworkSource.sourceId || "")}">↩ 查看原维修</span>` : ""}
        </div>
        ${renderWarranty(repair, today)}
        <div class="actions">
          ${renderStatusControl(repair)}
          ${repair.warranty && repair.warranty.status === "pending" ? `<button class="ghost" data-edit-warranty="${repair.id}">编辑完工信息</button>` : ""}
          <button class="ghost danger" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderStatusControl(repair) {
  if (repair.warranty && ["settled", "deducted"].includes(repair.warranty.status)) {
    return `<span class="chip locked">已完工归档</span>`;
  }
  return `<select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>`;
}

function renderWarranty(repair, today) {
  const w = repair.warranty;
  if (!w) {
    return repair.status === "done"
      ? `<div class="warranty none"><span class="wbadge none">无质保</span><span class="wtext">旧记录，未留尾款</span></div>`
      : "";
  }

  const left = daysLeft(w, today);
  const head = `
    <div class="warranty-head">
      <span class="wbadge ${w.status}">${warrantyStatuses[w.status]}</span>
      <span class="wmeta">师傅：${escapeHtml(w.worker || "未登记")} ｜ 实付 ${formatMoney(w.paidAmount)} ｜ 尾款 ${formatMoney(w.retainAmount)}</span>
    </div>`;

  let detail = "";
  let actions = "";

  if (w.status === "pending") {
    const dueText = left > 0
      ? `质保期内，还剩 ${left} 天到期（${w.dueOn}）`
      : `已到期待结清（${w.dueOn}）`;
    detail = `<div class="wtext">${dueText}</div>`;
    actions = `
      <button class="mini release" data-release="${repair.id}" ${canRelease(w, today) ? "" : "disabled"}>放款结清</button>
      <button class="mini" data-report-rework="${repair.id}" ${canReportRework(w, today) ? "" : "disabled"}>登记同位置返修</button>
    `;
  } else if (w.status === "frozen") {
    detail = `<div class="wtext">尾款已冻结并转到返修，返修未结前不能放款</div>
      <span class="chip rework-link" data-goto="${escapeHtml(w.reworkId || "")}">前往返修单处理</span>`;
  } else if (w.status === "deducted") {
    detail = `<div class="wtext">师傅放弃，按返修支出扣减 ${formatMoney(w.deductedAmount)}，余额 ${formatMoney(w.settledAmount)} 已结清</div>`;
  } else if (w.status === "settled") {
    detail = `<div class="wtext">到期无复发，尾款 ${formatMoney(w.settledAmount)} 已结清给师傅</div>`;
  }

  return `
    <div class="warranty ${w.status}">
      ${head}
      ${detail}
      ${actions ? `<div class="wactions">${actions}</div>` : ""}
      ${renderLogs(w)}
    </div>
  `;
}

function renderLogs(w) {
  if (!w.logs || !w.logs.length) return "";
  return `
    <details class="wlogs">
      <summary>尾款流水（${w.logs.length}）</summary>
      <ul>
        ${w.logs.map((log) => `<li><span class="log-on">${log.on}</span> ${escapeHtml(log.text)}</li>`).join("")}
      </ul>
    </details>
  `;
}

export function visibleRepairs(repairs, filter, warrantyFilter, today) {
  let list = repairs;
  if (filter !== "all") list = list.filter((repair) => repair.status === filter);
  if (warrantyFilter && warrantyFilter !== "all") {
    list = list.filter((repair) => {
      if (warrantyFilter === "none") return !repair.warranty;
      return repair.warranty && repair.warranty.status === warrantyFilter;
    });
  }
  return list;
}

function countUnfinished(repairs) {
  return repairs.filter((repair) => repair.status !== "done").length;
}

function countDoing(repairs) {
  return repairs.filter((repair) => repair.status === "doing").length;
}

function sumUnfinishedCost(repairs) {
  return repairs
    .filter((repair) => repair.status !== "done")
    .reduce((total, repair) => total + Number(repair.cost || 0), 0);
}

export function renderStatusOptions(selected) {
  return Object.entries(statuses)
    .filter(([value]) => value !== "all")
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
