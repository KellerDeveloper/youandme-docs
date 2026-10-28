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

function status(kind, text, sub) {
  statusBox.className = "code-status shown " + kind;
  statusBox.querySelector(".icon").textContent = kind === "ok" ? "check_circle" : "info";
  statusBox.querySelector(".code-status-text").innerHTML =
    text + (sub ? '<small>' + sub + '</small>' : "");
}

// Ввод: одна клетка — один символ, автопереход вперёд и назад по Backspace.
cells.forEach((cell, i) => {
  cell.addEventListener("input", () => {
    cell.value = cell.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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
    const text = (e.clipboardData.getData("text") || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    [...text].slice(0, cells.length - i).forEach((ch, k) => cells[i + k].value = ch);
    cells[Math.min(i + text.length, cells.length - 1)].focus();
    if (code().length === 6) checkCode();
  });
});

async function checkCode() {
  if (!PAY_ENDPOINT) {
    status("warn", "Приём оплаты подключается",
      "Код запомнится — вернитесь на страницу через пару дней.");
    return;
  }
  status("warn", "Проверяем код…");
  try {
    const r = await fetch(PAY_ENDPOINT + "/check?code=" + encodeURIComponent(code()));
    const data = await r.json();
    if (data.ok) status("ok", data.names || "Пара найдена", "пара найдена");
    else status("warn", "Такого кода нет", "Проверьте, что переписали его из приложения без ошибок.");
  } catch {
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
  sbpBtn.textContent = "Оплатить " + Number(plan.dataset.price).toLocaleString("ru-RU") + " ₽ через СБП";
});

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
const payAgreed = agree(document.getElementById("payAgree"), sbpBtn, cardBtn);

async function pay(method) {
  payError.classList.remove("shown");
  if (code().length !== 6) {
    payError.textContent = "Сначала введите код привязки из приложения — иначе " + (plansBox.dataset.what || "премиум") + " некуда зачислить.";
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
    payError.textContent = "Приём оплаты ещё подключается. Загляните через пару дней — код привязки за это время не изменится.";
    payError.classList.add("shown");
    return;
  }
  sbpBtn.disabled = cardBtn.disabled = true;
  try {
    const r = await fetch(PAY_ENDPOINT + "/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code(), plan: selected.dataset.plan, method, email: payEmail.value.trim() })
    });
    const data = await r.json();
    if (data.confirmationUrl) location.href = data.confirmationUrl;
    else throw new Error(data.error || "no url");
  } catch {
    payError.textContent = "Не получилось начать оплату. Попробуйте ещё раз, а если повторится — напишите на почту из подвала.";
    payError.classList.add("shown");
    payAgreed();
  }
}

sbpBtn.addEventListener("click", () => pay("sbp"));
cardBtn.addEventListener("click", () => pay("card"));
