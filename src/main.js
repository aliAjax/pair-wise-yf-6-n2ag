import "./styles.css";
import { loadState, saveState, openWarranty } from "./migrate.js";
import {
  warrantyStates,
  findActiveWarranty,
  freezeForRework,
  resolveRework,
  canRelease,
  settle,
  deductForAbandon,
  daysLeft,
  summarizeWarranties
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

let state = loadState();
// 仅页面使用的临时面板状态（完工登记、师傅放弃），不入库
state.ui = state.ui || {};

const app = document.querySelector("#app");

function persist() {
  const { ui, ...data } = state;
  saveState(data);
}

function findRepair(id) {
  return state.repairs.find((repair) => repair.id === id);
}

// 找出冻结到该返修单上的原维修
function findReworkOwner(reworkId) {
  return state.repairs.find((repair) => repair.warranty?.reworkId === reworkId);
}

function yuan(value) {
  return `¥${Math.round((Number(value) + Number.EPSILON) * 100) / 100}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

function render() {
  const repairs = filteredRepairs();
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;
  const money = summarizeWarranties(state.repairs);

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${unfinished.length}</strong></div>
          <div class="stat"><span>处理中</span><strong>${doing}</strong></div>
          <div class="stat"><span>预计费用</span><strong>${yuan(totalCost)}</strong></div>
        </section>
      </header>

      <section class="warranty-board">
        <div class="wstat pending"><span>待放款尾款</span><strong>${yuan(money.pending)}</strong></div>
        <div class="wstat frozen"><span>冻结尾款</span><strong>${yuan(money.frozen)}</strong></div>
        <div class="wstat deducted"><span>累计扣减</span><strong>${yuan(money.deducted)}</strong></div>
        <div class="wstat settled"><span>已结清尾款</span><strong>${yuan(money.settled)}</strong></div>
      </section>

      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
            <label>处理状态<select name="status">${renderStatusOptions("todo", false)}</select></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
          <p class="hint">同位置在质保期内再报修，原维修尾款自动冻结并挂到返修单。</p>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
          </div>
          <div class="toolbar warranty-filter">
            <span class="toolbar-label">尾款</span>
            ${renderWarrantyFilter("all", "全部尾款")}
            ${Object.entries(warrantyStates).map(([value, label]) => renderWarrantyFilter(value, label)).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前筛选下没有维修事项</div>`}
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderWarrantyFilter(value, label) {
  const active = (state.warrantyFilter || "all") === value ? "active" : "";
  return `<button class="seg ${active}" data-warranty-filter="${value}">${label}</button>`;
}

function renderRepair(repair) {
  const owner = findReworkOwner(repair.id);
  return `
    <article class="repair${owner ? " is-rework" : ""}">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
          ${owner ? `<span class="rework-tag">返修单 · 冻结原尾款</span>` : ""}
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ${yuan(repair.cost)}</span>
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        ${renderWarranty(repair)}
        ${state.ui.completingId === repair.id ? renderCompletionForm(repair) : ""}
        <div class="actions">
          <select data-status="${repair.id}">${renderStatusOptions(repair.status, Boolean(owner))}</select>
          ${repair.status !== "done" && !owner ? `<button class="ghost" data-complete="${repair.id}">完工登记</button>` : ""}
          ${repair.status === "done" && !repair.warranty && !owner ? `<button class="ghost" data-complete="${repair.id}">补录实付（开启质保）</button>` : ""}
          ${owner ? `<button class="ghost" data-unfreeze-action="${repair.id}">返修完成，解冻原尾款</button>` : ""}
          <button class="ghost danger" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderWarranty(repair) {
  const w = repair.warranty;
  if (!w) {
    return repair.status === "done" ? `<div class="warranty none">旧记录 · 无质保尾款</div>` : "";
  }

  const head = `
    <div class="warranty-head">
      <span class="wstate ${w.state}">${warrantyStates[w.state]}</span>
      <span class="chip">师傅：${escapeHtml(w.worker || "未填写")}</span>
      <span class="chip">实付 ${yuan(w.paid)} · 预留两成尾款 ${yuan(w.retain)}</span>
      <span class="chip">完工 ${formatDate(w.completedAt)} · 到期 ${formatDate(w.dueAt)}</span>
    </div>`;

  let body = "";
  if (w.state === "pending") {
    const due = canRelease(w);
    body = `
      <div class="warranty-body">
        <span>${due ? "质保到期无复发，可放款" : `质保期剩余 ${daysLeft(w)} 天`}</span>
        <button class="mini primary" data-release="${repair.id}" ${due ? "" : "disabled"}>放款结清</button>
      </div>`;
  } else if (w.state === "frozen") {
    const rework = findRepair(w.reworkId);
    body = `
      <div class="warranty-body">
        <span>同位置返修处理中，返修未结前不能放款。返修单：${rework ? `${escapeHtml(rework.location)} · ${escapeHtml(rework.title)}` : "已删除"}</span>
        ${rework ? `<button class="mini ghost" data-unfreeze="${repair.id}">返修完成，解冻</button>` : ""}
        <button class="mini ghost danger" data-abandon="${repair.id}">师傅放弃，按支出扣减</button>
      </div>
      ${state.ui.abandonId === repair.id ? renderAbandonForm(repair) : ""}`;
  } else if (w.state === "deducted") {
    body = `
      <div class="warranty-body">
        <span>返修支出扣减 ${yuan(w.deducted)}，尾款余额 ${yuan(w.released)} 已结清</span>
      </div>`;
  } else {
    body = `
      <div class="warranty-body">
        <span>尾款 ${yuan(w.retain)} 已结清${w.settledAt ? `（${formatDate(w.settledAt)}）` : ""}</span>
      </div>`;
  }

  return `<div class="warranty ${w.state}">${head}${body}</div>`;
}

function renderAbandonForm(repair) {
  const rework = findRepair(repair.warranty.reworkId);
  return `
    <form class="inline-form" data-abandon-form="${repair.id}">
      <label>返修支出（师傅放弃返修，另请他人的花费）
        <input name="reworkCost" type="number" min="0" step="1" value="${rework?.cost || 0}" required>
      </label>
      <button class="mini primary" type="submit">确认扣减并结清余额</button>
      <button class="mini ghost" type="button" data-cancel-abandon>取消</button>
    </form>`;
}

function renderCompletionForm(repair) {
  return `
    <form class="inline-form completion" data-complete-form="${repair.id}">
      <label>实付金额<input name="paid" type="number" min="0" step="1" value="${repair.cost || 0}" required></label>
      <label>师傅<input name="worker" required placeholder="师傅姓名或联系方式"></label>
      <div class="inline-actions">
        <button class="mini primary" type="submit">确认完工（留两成尾款，30天后结清）</button>
        <button class="mini ghost" type="button" data-cancel-complete>取消</button>
      </div>
    </form>`;
}

function renderStatusOptions(selected, allowDone) {
  return Object.entries(statuses)
    .filter(([value]) => value !== "all")
    .filter(([value]) => allowDone || value !== "done")
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const repair = {
      id: crypto.randomUUID(),
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      cost: Number(data.cost || 0),
      status: data.status,
      photo: data.photo.trim(),
      note: data.note.trim(),
      warranty: null
    };
    state.repairs.unshift(repair);

    // 同位置质保期内再报修：原尾款冻结并转到返修单
    const active = findActiveWarranty(state.repairs, repair.location);
    if (active) {
      const owner = state.repairs.find((item) => item.warranty === active);
      owner.warranty = freezeForRework(active, repair.id);
    }

    persist();
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-warranty-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.warrantyFilter = button.dataset.warrantyFilter;
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = findRepair(select.dataset.status);
      if (select.value === "done" && findReworkOwner(repair.id)) {
        // 返修单结案：原尾款解除冻结，回到待放款
        repair.status = "done";
        const owner = findReworkOwner(repair.id);
        owner.warranty = resolveRework(owner.warranty);
      } else {
        repair.status = select.value;
      }
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-complete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.completingId = button.dataset.complete;
      render();
    });
  });

  document.querySelectorAll("[data-complete-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = findRepair(form.dataset.completeForm);
      const data = new FormData(form);
      openWarranty(repair, Number(data.get("paid") || 0), data.get("worker"));
      state.ui.completingId = null;
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-cancel-complete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.completingId = null;
      render();
    });
  });

  document.querySelectorAll("[data-release]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = findRepair(button.dataset.release);
      repair.warranty = settle(repair.warranty);
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-unfreeze]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = findRepair(button.dataset.unfreeze);
      repair.warranty = resolveRework(repair.warranty);
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-unfreeze-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const rework = findRepair(button.dataset.unfreezeAction);
      const owner = findReworkOwner(rework.id);
      rework.status = "done";
      owner.warranty = resolveRework(owner.warranty);
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-abandon]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.abandonId = button.dataset.abandon;
      render();
    });
  });

  document.querySelectorAll("[data-abandon-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = findRepair(form.dataset.abandonForm);
      const cost = Number(new FormData(form).get("reworkCost") || 0);
      repair.warranty = deductForAbandon(repair.warranty, cost);
      state.ui.abandonId = null;
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-cancel-abandon]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.abandonId = null;
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.repairs = state.repairs.filter((repair) => repair.id !== button.dataset.delete);
      persist();
      render();
    });
  });
}

function filteredRepairs() {
  let list = state.repairs;
  if (state.filter !== "all") {
    list = list.filter((repair) => repair.status === state.filter);
  }
  const warrantyFilter = state.warrantyFilter || "all";
  if (warrantyFilter !== "all") {
    list = list.filter((repair) => repair.warranty?.state === warrantyFilter);
  }
  return list;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
