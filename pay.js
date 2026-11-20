// Оплата по коду привязки — общая для страниц премиума (index.html) и места для альбома
// (space.html): клетки кода, выбор тарифа, почта для чека, согласие, создание платежа.
// Что покупается, страница говорит атрибутом `data-what` у блока тарифов. Обычный скрипт,
// а не модуль: его константы (`PAY_ENDPOINT`, `status`, `agree`, `emailOk`) видит скрипт
// страницы ниже — донат и сообщение после возврата с оплаты у каждой страницы свои.

// Адрес приёма оплаты. Четыре ветки — /check, /create, /donate, /webhook — живут по
// этому адресу с разными путями. Пусто — оплата не подключена, и страница говорит об
// этом честно, вместо того чтобы вести человека в никуда.
// С 04.10.2026 оплату принимает наш сервер в Яндекс Облаке. Первое переключение
// 19.09.2026 откатили в тот же час: коды привязки живых пар лежали только в Firestore,
// и сайт отвечал «такого кода нет» всем подряд. Теперь сервер ищет код в обеих базах.
// Адрес уведомлений ЮKassa (…/pay/webhook) меняется руками в её кабинете — вместе с этим.
const PAY_ENDPOINT = "https://api.youandme-app.ru/pay";

const cells = [...document.querySelectorAll("#cells input")];
const statusBox = document.getElementById("codeStatus");
const plansBox = document.getElementById("plans");
const sbpBtn = document.getElementById("paySbp");
const cardBtn = document.getElementById("payCard");
const payError = document.getElementById("payError");

let selected = plansBox.querySelector('[aria-pressed="true"]');

const code = () => cells.map(c => c.value).join("");
const CODE_FORMAT = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const CODE_CHAR = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]$/;
let codeRejected = false;
const linkBox = document.getElementById("linkCode");
const linkStatus = document.getElementById("linkStatus");
const manualButton = document.getElementById("manualCodeButton");
let linkToken = null;
let verifiedLink = false;
let submitting = false;
let targetRevision = 0;
let paymentRequest = null;

function resetPaymentTarget(nextToken) {
  targetRevision += 1;
  paymentRequest?.abort();
  paymentRequest = null;
  linkToken = nextToken;
  verifiedLink = false;
  codeRejected = false;
  for (const cell of cells) cell.value = "";
  statusBox.className = "code-status";
  payError.classList.remove("shown");
  window.checkoutPromo?.pairChanged();
  setSubmitting(false);
}

function showManualCode(message = "") {
  resetPaymentTarget(null);
  history.replaceState(null, "", location.pathname + location.search + "#kod");
  document.getElementById("manualCodeIntro").hidden = false;
  document.getElementById("manualCode").hidden = false;
  linkBox.hidden = !message;
  linkStatus.textContent = message;
  manualButton.hidden = true;
}

const invalidLinkMessage = "Ссылка больше не действует. Попросите новую ссылку или введите действующий код пары.";

async function checkLink(token, revision) {
  linkBox.hidden = false;
  document.getElementById("manualCodeIntro").hidden = true;
  document.getElementById("manualCode").hidden = true;
  linkStatus.textContent = "Проверяем ссылку…";
  manualButton.hidden = false;
  document.getElementById("kod").scrollIntoView();
  try {
    const response = await fetch(PAY_ENDPOINT + "/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentLink: token })
    });
    if (!response.ok) throw new Error("check failed");
    const data = await response.json();
    if (targetRevision !== revision || linkToken !== token) return;
    if (data.ok !== true) {
      showManualCode(invalidLinkMessage);
      return;
    }
    verifiedLink = true;
    linkStatus.textContent = "✓ Код подставлен автоматически";
    payAgreed();
  } catch {
    if (targetRevision === revision && linkToken === token) showManualCode("Не получилось проверить ссылку. Можно ввести код пары вручную.");
  }
}

function syncPaymentTarget() {
  const nextToken = new URLSearchParams(location.hash.slice(1)).get("pay");
  if (nextToken === linkToken) return;
  if (nextToken === null) {
    showManualCode();
    return;
  }
  resetPaymentTarget(nextToken);
  void checkLink(nextToken, targetRevision);
}

manualButton?.addEventListener("click", () => {
  if (submitting) return;
  showManualCode();
  payError.classList.remove("shown");
  cells[0].focus();
});

function invalidCode() { codeRejected = true; status("warn", "Проверьте код пары", "Нужны 6 букв или цифр из кода в приложении. Лишние символы не удаляются автоматически."); }

function status(kind, text, sub) {
  statusBox.className = "code-status shown " + kind;
  statusBox.querySelector(".icon").textContent = kind === "ok" ? "check_circle" : "info";
  const message = statusBox.querySelector(".code-status-text");
  message.textContent = text;
  if (sub) {
    const detail = document.createElement("small");
    detail.textContent = sub;
    message.append(detail);
  }
}

// Ввод: одна клетка — один символ, автопереход вперёд и назад по Backspace.
cells.forEach((cell, i) => {
  cell.addEventListener("input", () => {
    cell.value = cell.value.replace(/\s/g, "").toUpperCase();
    codeRejected = false;
    window.checkoutPromo?.pairChanged();
    if (cell.value && !CODE_CHAR.test(cell.value)) { invalidCode(); return; }
    if (cell.value && i < cells.length - 1) cells[i + 1].focus();
    if (code().length === 6) checkCode();
    else statusBox.className = "code-status";
  });
  cell.addEventListener("keydown", e => {
    if (e.key === "Backspace" && !cell.value && i > 0) cells[i - 1].focus();
    if (e.key === "ArrowLeft" && i > 0) cells[i - 1].focus();
    if (e.key === "ArrowRight" && i < cells.length - 1) cells[i + 1].focus();
  });
  // Вставка кода целиком раскладывается по клеткам, а не падает в одну.
  cell.addEventListener("paste", e => {
    e.preventDefault();
    const text = (e.clipboardData.getData("text") || "").replace(/\s/g, "").toUpperCase();
    const start = text.length === cells.length ? 0 : i;
    if (!text || [...text].some(ch => !CODE_CHAR.test(ch)) || text.length > cells.length - start) { invalidCode(); return; }
    codeRejected = false;
    [...text].forEach((ch, k) => cells[start + k].value = ch);
    window.checkoutPromo?.pairChanged();
    cells[Math.min(start + text.length, cells.length - 1)].focus();
    if (code().length === 6) checkCode();
  });
});

async function checkCode() {
  const checkingCode = code();
  const checkingRevision = targetRevision;
  if (!CODE_FORMAT.test(checkingCode)) { invalidCode(); return; }
  if (!PAY_ENDPOINT) {
    status("warn", "Приём оплаты подключается",
      "Код запомнится — вернитесь на страницу через пару дней.");
    return;
  }
  status("warn", "Проверяем код…");
  try {
    const r = await fetch(PAY_ENDPOINT + "/check?code=" + encodeURIComponent(checkingCode));
    const data = await r.json();
    if (targetRevision !== checkingRevision || codeRejected || code() !== checkingCode) return;
    if (data.ok && typeof data.names === "string" && data.names.trim()) status("ok", data.names, "пара найдена");
    else if (data.ok) status("ok", "Код подходит для оплаты", "Проверка кода не даёт доступа к аккаунту.");
    else status("warn", "Такого кода нет", "Проверьте, что переписали его из приложения без ошибок.");
  } catch {
    if (targetRevision !== checkingRevision || codeRejected || code() !== checkingCode) return;
    status("warn", "Не получилось проверить код", "Проверьте связь и попробуйте ещё раз.");
  }
}

// Выбор пакета: сумма едет в подпись главной кнопки.
plansBox.addEventListener("click", e => {
  const plan = e.target.closest(".plan");
  if (!plan) return;
  selected.setAttribute("aria-pressed", "false");
  plan.setAttribute("aria-pressed", "true");
  selected = plan;
  updatePayLabel();
  window.checkoutPromo?.planChanged();
});

function updatePayLabel() {
  const kopecks = window.checkoutPromo?.price(selected.dataset.plan);
  const amount = kopecks == null ? Number(selected.dataset.price) : kopecks / 100;
  sbpBtn.textContent = "Оплатить " + amount.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2
  }) + " ₽ через СБП";
}

// Почта для чека. По 54-ФЗ чек уходит покупателю, а ЮKassa сама её на своей форме
// не спрашивает. Проверка грубая — точнее проверит ЮKassa.
const payEmail = document.getElementById("payEmail");
const emailOk = input => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());

// Галочка согласия: кнопки активны, только пока она стоит. Возвращает ту же сверку —
// ею кнопки и включаются обратно после неудачной попытки оплаты.
function agree(box, ...buttons) {
  const sync = () => buttons.forEach(b => b.disabled = !box.checked);
  box.addEventListener("change", sync);
  sync();
  return sync;
}
const payConsent = document.getElementById("payAgree");
const syncPayConsent = agree(payConsent, sbpBtn, cardBtn);
function payAgreed() {
  syncPayConsent();
  if (submitting || (linkToken !== null && !verifiedLink) || window.checkoutPromo?.blocksPayment()) sbpBtn.disabled = cardBtn.disabled = true;
}
payConsent.addEventListener("change", payAgreed);

function setSubmitting(value) {
  submitting = value;
  for (const input of cells) input.disabled = value;
  for (const plan of plansBox.querySelectorAll("button")) plan.disabled = value;
  if (manualButton) manualButton.disabled = value;
  payAgreed();
}

async function pay(method) {
  if (submitting || window.checkoutPromo?.blocksPayment()) return;
  payError.classList.remove("shown");
  if (linkToken !== null && !verifiedLink) {
    payError.textContent = "Дождитесь проверки ссылки или введите код пары вручную.";
    payError.classList.add("shown");
    return;
  }
  if (!verifiedLink && (codeRejected || !CODE_FORMAT.test(code()))) {
    payError.textContent = "Сначала введите код пары из приложения — иначе " + (plansBox.dataset.what || "премиум") + " некуда зачислить.";
    payError.classList.add("shown");
    cells[0].focus();
    return;
  }
  if (!emailOk(payEmail)) {
    payError.textContent = "Укажите почту — на неё придёт чек.";
    payError.classList.add("shown");
    payEmail.focus();
    return;
  }
  if (!PAY_ENDPOINT) {
    payError.textContent = "Приём оплаты ещё подключается. Загляните через пару дней — постоянный код пары доступен в приложении.";
    payError.classList.add("shown");
    return;
  }
  const payingRevision = targetRevision;
  const controller = new AbortController();
  paymentRequest = controller;
  setSubmitting(true);
  let leavingForCheckout = false;
  try {
    const r = await fetch(PAY_ENDPOINT + "/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        ...(verifiedLink ? { paymentLink: linkToken } : { code: code() }),
        plan: selected.dataset.plan, method, email: payEmail.value.trim(),
        ...window.checkoutPromo?.paymentFields(selected.dataset.plan, method, payEmail.value.trim())
      })
    });
    const data = await r.json();
    if (targetRevision !== payingRevision) return;
    if (r.ok && data.confirmationUrl) {
      leavingForCheckout = true;
      location.href = data.confirmationUrl;
      return;
    }
    if (r.ok && data.paid) {
      leavingForCheckout = true;
      location.href = location.pathname + "?paid=1";
      return;
    }
    if (window.checkoutPromo?.showPaymentError(data.error)) {
      // Цена не меняется в момент ошибки. Пользователь явно обновит промокод или уберёт его.
    } else if (verifiedLink && data.error === "PAYMENT_LINK_INVALID") {
      showManualCode(invalidLinkMessage);
      cells[0].focus();
    } else {
      throw new Error(data.error || "no url");
    }
  } catch {
    if (targetRevision !== payingRevision) return;
    payError.textContent = "Не получилось начать оплату. Попробуйте ещё раз, а если повторится — напишите на почту из подвала.";
    payError.classList.add("shown");
  } finally {
    if (paymentRequest === controller && !leavingForCheckout) {
      paymentRequest = null;
      setSubmitting(false);
    }
  }
}

sbpBtn.addEventListener("click", () => pay("sbp"));
cardBtn.addEventListener("click", () => pay("card"));

if (linkBox) {
  window.addEventListener("hashchange", syncPaymentTarget);
  syncPaymentTarget();
}

window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  const token = linkBox ? new URLSearchParams(location.hash.slice(1)).get("pay") : null;
  if (token !== null) {
    resetPaymentTarget(token);
    void checkLink(token, targetRevision);
    return;
  }
  if (linkToken !== null) {
    showManualCode();
    return;
  }
  targetRevision += 1;
  paymentRequest?.abort();
  paymentRequest = null;
  setSubmitting(false);
  if (CODE_FORMAT.test(code())) void checkCode();
});
