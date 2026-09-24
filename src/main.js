import "./styles.css";
import { loadState, saveState } from "./migrate.js";
import { renderApp, escapeHtml } from "./view.js";
import {
  createWarranty,
  settleWarranty,
  reportRework,
  resolveRework,
  abandonRework,
  detachRework,
  findActiveWarranty,
  warrantyLedger,
  calcRetain,
  todayText
} from "./warranty.js";

let state = loadState();
const app = document.querySelector("#app");
const today = todayText();

function render() {
  const ledger = warrantyLedger(state.repairs, today);
  app.innerHTML = renderApp(state, ledger, today);
  bindEvents();
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", onSubmitRepair);

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      persist();
    });
  });

  document.querySelectorAll("[data-warranty-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.warrantyFilter = button.dataset.warrantyFilter;
      persist();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => onStatusChange(select));
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => onDelete(button.dataset.delete));
  });

  document.querySelectorAll("[data-release]").forEach((button) => {
    button.addEventListener("click", () => {
      const result = settleWarranty(state.repairs, button.dataset.release, today);
      afterAction(result);
    });
  });

  document.querySelectorAll("[data-report-rework]").forEach((button) => {
    button.addEventListener("click", () => onReportRework(button.dataset.reportRework));
  });

  document.querySelectorAll("[data-edit-warranty]").forEach((button) => {
    button.addEventListener("click", () => onEditWarranty(button.dataset.editWarranty));
  });

  document.querySelectorAll("[data-goto]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.filter = "all";
      state.warrantyFilter = "all";
      persist();
      requestAnimationFrame(() => {
        const target = document.querySelector(`[data-delete="${chip.dataset.goto}"]`)?.closest(".repair");
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.classList.add("flash");
        setTimeout(() => target?.classList.remove("flash"), 1600);
      });
    });
  });
}

async function onSubmitRepair(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const location = data.location.trim();
  const base = {
    id: crypto.randomUUID(),
    location,
    title: data.title.trim(),
    priority: data.priority,
    cost: Number(data.cost || 0),
    photo: data.photo.trim(),
    note: data.note.trim(),
    warranty: null
  };

  if (data.status === "done") {
    // 同位置还在质保期内：新报修应挂到原尾款上当返修，而不是直接完工
    const active = findActiveWarranty(state.repairs, location, today);
    if (active) {
      if (active.warranty.status === "frozen") {
        alert(`「${active.location}」已有一单返修在处理，原尾款冻结中；请先了结该返修再登记。`);
        return;
      }
      const confirmFreeze = await confirmModal(
        "该位置仍在质保期内",
        `「${active.location}」有一笔冻结/待放款尾款（原维修：${active.title}）。是否把这次报修登记为返修并冻结原尾款？`,
        "登记为返修",
        "仍然直接完工"
      );
      if (confirmFreeze) {
        const result = reportRework(state.repairs, active.id, {
          title: base.title,
          priority: base.priority,
          cost: base.cost,
          photo: base.photo,
          note: base.note
        }, today);
        afterAction(result);
        return;
      }
    }
    const input = await openCompletionModal({ cost: base.cost });
    if (!input) return;
    base.status = "done";
    base.warranty = createWarranty(input.paidAmount, input.worker, today);
  } else {
    base.status = data.status;
  }

  state.repairs.unshift(base);
  persist();
}

async function onStatusChange(select) {
  const repair = state.repairs.find((item) => item.id === select.dataset.status);
  const next = select.value;

  if (repair.isRework && repair.status !== "done" && next === "done") {
    const choice = await confirmModal(
      "返修如何了结？",
      "师傅已修好选「返修完成」（尾款解冻重计30天）；师傅放弃另请他人选「师傅放弃」（按返修支出扣减尾款）。",
      "返修完成",
      "师傅放弃"
    );
    if (choice === null) {
      select.value = repair.status;
      return;
    }
    if (choice) {
      afterAction(resolveRework(state.repairs, repair.id, today));
      return;
    }
    const spent = await openAbandonModal(repair);
    if (spent === null) {
      select.value = repair.status;
      return;
    }
    afterAction(abandonRework(state.repairs, repair.id, spent, today));
    return;
  }

  if (next === "done" && !repair.warranty) {
    const active = findActiveWarranty(state.repairs, repair.location, today);
    if (active && !repair.isRework) {
      const confirmFreeze = await confirmModal(
        "该位置仍在质保期内",
        `是否把该单作为「${active.title}」的返修单，并冻结原尾款？`,
        "登记为返修",
        "作为新完工处理"
      );
      if (confirmFreeze) {
        select.value = repair.status;
        const result = reportRework(state.repairs, active.id, {
          title: repair.title,
          priority: repair.priority,
          cost: repair.cost,
          photo: repair.photo,
          note: repair.note
        }, today);
        // 当前这条普通记录被返修单替代，移除避免重复
        state.repairs = state.repairs.filter((item) => item.id !== repair.id);
        afterAction(result);
        return;
      }
    }
    const input = await openCompletionModal({ cost: repair.cost, worker: "" });
    if (!input) {
      select.value = repair.status;
      return;
    }
    repair.status = "done";
    repair.warranty = createWarranty(input.paidAmount, input.worker, today);
    persist();
    return;
  }

  repair.status = next;
  persist();
}

async function onEditWarranty(id) {
  const repair = state.repairs.find((item) => item.id === id);
  if (!repair?.warranty) return;
  if (repair.warranty.status !== "pending") {
    alert("只有待放款的尾款可以修改完工信息；冻结中请先处理返修。");
    return;
  }
  const input = await openCompletionModal({
    cost: repair.warranty.paidAmount,
    worker: repair.warranty.worker
  });
  if (!input) return;
  // 只允许改实付与师傅；重新计算两成尾款，到期日沿用原完工日
  const previous = repair.warranty;
  const rebuilt = createWarranty(input.paidAmount, input.worker, previous.doneOn);
  rebuilt.dueOn = previous.dueOn;
  rebuilt.logs = previous.logs || rebuilt.logs;
  rebuilt.logs.push({ on: today, action: "edit", text: `修改完工信息：实付 ${rebuilt.paidAmount}，尾款重算为 ${rebuilt.retainAmount}` });
  repair.warranty = rebuilt;
  persist();
}

async function onReportRework(sourceId) {
  const source = state.repairs.find((item) => item.id === sourceId);
  if (!source) return;
  const input = await openReworkModal(source);
  if (!input) return;
  const result = reportRework(state.repairs, sourceId, input, today);
  afterAction(result);
}

function onDelete(id) {
  const repair = state.repairs.find((item) => item.id === id);
  if (!repair) return;
  // 删返修单：原尾款解冻
  if (repair.isRework) detachRework(state.repairs, id);
  // 删原维修：挂在它身上的返修单去掉关联标记
  state.repairs.forEach((item) => {
    if (item.isRework && item.sourceId === id) {
      item.isRework = false;
      delete item.sourceId;
    }
  });
  state.repairs = state.repairs.filter((item) => item.id !== id);
  persist();
}

function afterAction(result) {
  if (result && result.ok) {
    persist();
  } else if (result && result.message) {
    alert(result.message);
    render();
  }
}

function persist() {
  saveState(state);
  render();
}

// ---------- 弹窗 ----------

function modalShell(title, body, confirmText = "保存", onOpen) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button type="button" class="ghost" data-modal-cancel>取消</button>
          <button type="button" class="primary" data-modal-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    overlay.querySelector("[data-modal-cancel]").addEventListener("click", () => close(null));
    overlay.querySelector("[data-modal-confirm]").addEventListener("click", () => {
      const form = overlay.querySelector("form");
      if (form && !form.reportValidity()) return;
      close(form ? Object.fromEntries(new FormData(form)) : true);
    });
    overlay.querySelector("input,select,textarea")?.focus();
    if (typeof onOpen === "function") onOpen(overlay);
  });
}

function openCompletionModal({ cost = 0, worker = "" }) {
  return modalShell(
    "完工登记：留两成质保尾款",
    `
    <form id="completion-form" class="form">
      <p class="modal-hint">实付后自动扣留 <strong>20%</strong> 作质保尾款，30 天内同位置再报修将冻结该尾款。</p>
      <label>实付金额（元）<input name="paidAmount" type="number" min="0" step="0.01" value="${Number(cost || 0)}" required></label>
      <label>师傅姓名/电话<input name="worker" required placeholder="例如 张师傅 138****" value="${escapeHtml(worker)}"></label>
      <p class="modal-hint">本单尾款：<strong data-retain-preview>${calcRetain(cost)}</strong> 元</p>
    </form>`,
    "确认完工",
    (overlay) => {
      const input = overlay.querySelector("[name=paidAmount]");
      const preview = overlay.querySelector("[data-retain-preview]");
      input.addEventListener("input", () => {
        preview.textContent = calcRetain(input.value);
      });
    }
  ).then((data) => {
    if (!data) return null;
    return { paidAmount: Number(data.paidAmount || 0), worker: data.worker.trim() };
  });
}

function openReworkModal(source) {
  return modalShell(
    `登记返修：${source.location}`,
    `
    <form id="rework-form" class="form">
      <p class="modal-hint">原尾款 <strong>${Number(source.warranty?.retainAmount || 0)}</strong> 元将冻结并转到返修，返修未结前不能放款。</p>
      <label>返修问题<textarea name="title" required placeholder="例如同一位置仍然渗水">返修：${escapeHtml(source.title)}</textarea></label>
      <label>预估返修花费<input name="cost" type="number" min="0" step="0.01" value="0"></label>
      <label>备注<textarea name="note" placeholder="现象、联系人等"></textarea></label>
    </form>`,
    "冻结尾款并登记"
  ).then((data) => {
    if (!data) return null;
    return {
      title: data.title.trim(),
      cost: Number(data.cost || 0),
      note: data.note.trim(),
      photo: "",
      priority: source.priority
    };
  });
}

function openAbandonModal(repair) {
  return modalShell(
    "师傅放弃：按返修支出扣减尾款",
    `
    <form id="abandon-form" class="form">
      <p class="modal-hint">另请他人的实际花费从原尾款中扣减，尾款余额才结清；超过尾款部分最多扣完为止。</p>
      <label>返修实际支出（元）<input name="spent" type="number" min="0" step="0.01" value="0" required></label>
    </form>`,
    "确认扣减并结清余额"
  ).then((data) => (data ? Number(data.spent || 0) : null));
}

function confirmModal(title, message, okText, cancelText) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <div class="modal-body"><p class="modal-hint">${escapeHtml(message)}</p></div>
        <div class="modal-actions">
          <button type="button" class="ghost" data-choice="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="primary" data-choice="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    overlay.querySelector('[data-choice="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-choice="ok"]').addEventListener("click", () => close(true));
  });
}

render();
