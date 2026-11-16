(async () => {
  const entry = document.getElementById("promoEntry");
  if (!entry) return;

  // Статика может обновиться раньше API и миграции. До их готовности работает обычная оплата.
  try {
    const response = await fetch(PAY_ENDPOINT + "/promo/status", { cache: "no-store" });
    if (!response.ok || (await response.json()).enabled !== true) return;
  } catch {
    return;
  }

  const byId = id => document.getElementById(id);
  const toggle = byId("promoToggle");
  const panel = byId("promoPanel");
  const input = byId("promoInput");
  const apply = byId("promoApply");
  const remove = byId("promoRemove");
  const message = byId("promoMessage");
  const trial = byId("promoTrial");
  const activate = byId("promoRedeem");
  const paidSection = byId("ceny");
  const success = byId("promoSuccess");
  if (/Telegram/i.test(navigator.userAgent) || document.referrer.startsWith("https://app.youandme-app.ru/") ||
      !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
    byId("promoReturn").href = "https://t.me/youandmeapp_bot?startapp";
  }
  const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  const formats = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const messages = {
    PROMO_NOT_FOUND: "Промокод не найден. Проверьте написание.",
    PROMO_SCHEDULED: "Акция ещё не началась.",
    PROMO_PAUSED: "Акция на паузе. Попробуйте позже.",
    PROMO_EXPIRED: "Срок действия промокода закончился.",
    PROMO_ENDED: "Акция завершилась.",
    PROMO_EXHAUSTED: "Лимит промокода исчерпан.",
    PROMO_ALREADY_USED: "Вы уже использовали это предложение.",
    PROMO_PREMIUM_ACTIVE: "У вашей пары уже активен премиум.",
    PROMO_FIRST_PURCHASE: "Промокод действует только на первую покупку премиума.",
    PROMO_PLAN: "Этот тариф не участвует в акции.",
    PROMO_PRICE_CHANGED: "Условия изменились. Проверьте промокод ещё раз.",
    PROMO_PAIR_CODE: "Проверьте, что верно ввели код пары из приложения.",
    PROMO_PAYMENT_PENDING: "У вас уже есть начатая оплата по этому промокоду.",
    PROMO_PAYMENT_CANCELED: "Оплата отменена. Можно попробовать снова.",
    PROMO_RATE_LIMIT: "Слишком много попыток. Попробуйте через минуту.",
    PROMO_PAYMENT_UNAVAILABLE: "Оплата пока не открылась. Повторите попытку с теми же данными.",
  };
  const rubles = kopecks => formats.format(kopecks / 100) + " ₽";
  const normalized = () => input.value.trim().toUpperCase();
  const plans = [...plansBox.querySelectorAll(".plan")].map(plan => {
    const price = plan.querySelector(".plan-price");
    const unit = plan.querySelector(".plan-per");
    const note = plan.querySelector(".plan-note");
    const wrapper = document.createElement("span");
    wrapper.className = "plan-offer-price";
    price.replaceWith(wrapper);
    const old = document.createElement("s");
    old.className = "plan-old-price";
    old.hidden = true;
    wrapper.append(old, price);
    return { price, old, unit, note, baseUnit: unit.textContent, plan: plan.dataset.plan, priceText: price.textContent };
  });

  let offer = null;
  let confirmedPair = "";
  let waiting = false;
  let blocked = false;
  let generation = 0;
  let activeCode = "";
  let checkout = null;
  let trialAttempt = null;
  let activating = false;

  function notice(text, error = false) {
    message.textContent = text;
    message.hidden = !text;
    message.dataset.error = String(error);
  }

  function paint() {
    const prices = offer?.prices || {};
    for (const item of plans) {
      const quote = prices[item.plan];
      item.price.textContent = quote ? rubles(quote.discounted) : item.priceText;
      item.old.hidden = !quote;
      if (item.note) item.note.hidden = Boolean(quote);
      if (quote) item.old.textContent = item.priceText;
      const months = { m1: 1, m3: 3, m12: 12 }[item.plan];
      item.unit.textContent = quote && months ? rubles(Math.round(quote.discounted / months)) + " в месяц" : item.baseUnit;
    }
    trial.hidden = offer?.kind !== "trial" || !success.hidden;
    paidSection.hidden = offer?.kind === "trial" || !success.hidden;
    activate.disabled = waiting || blocked || activating || !confirmedPair || confirmedPair !== code();
    if (!trial.hidden) {
      const days = new Intl.NumberFormat("ru-RU", { style: "unit", unit: "day", unitDisplay: "long" }).format(offer.days);
      byId("promoTrialTitle").textContent = days + " премиума";
      byId("promoTrialRules").textContent = "Премиум откроется на двоих. Карта не нужна. Доступ закончится сам.";
      byId("promoTrialHint").textContent = confirmedPair ? "" : "Введите код пары из You&Me, чтобы активировать.";
      activate.textContent = activating ? "Активируем…" : "Активировать " + days;
    }
    apply.disabled = waiting || activating;
    input.disabled = activating || submitting;
    remove.disabled = activating || submitting;
    apply.hidden = Boolean(offer) && !blocked;
    remove.hidden = !activeCode;
    updatePayLabel();
    payAgreed();
  }

  async function request(path, data) {
    const response = await fetch(PAY_ENDPOINT + "/promo/" + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }

  function open() {
    if (submitting) return;
    if (typeof showManualCode === "function" && (linkToken !== null || verifiedLink)) showManualCode();
    toggle.setAttribute("aria-expanded", "true");
    toggle.hidden = true;
    panel.hidden = false;
  }

  async function check() {
    if (submitting || activating) return;
    const promo = normalized();
    if (!promo) {
      notice("Введите промокод.", true);
      return;
    }
    const version = ++generation;
    activeCode = promo;
    input.value = promo;
    const pair = !codeRejected && CODE_FORMAT.test(code()) ? code() : "";
    waiting = true;
    blocked = false;
    notice("Проверяем промокод…");
    paint();
    try {
      const result = await request("quote", { promo, ...(pair ? { code: pair } : {}) });
      if (version !== generation) return;
      offer = result;
      confirmedPair = pair;
      notice(result.kind === "trial" ? "Промокод применён. Активируйте бесплатные дни." :
        "Промокод применён к участвующим тарифам.");
    } catch (error) {
      if (version !== generation) return;
      blocked = true;
      confirmedPair = "";
      notice(messages[error.message] || "Не получилось проверить промокод. Попробуйте ещё раз.", true);
    }
    if (version === generation) {
      waiting = false;
      paint();
    }
  }

  function clear() {
    generation++;
    offer = null;
    waiting = blocked = false;
    confirmedPair = activeCode = input.value = "";
    trialAttempt = checkout = null;
    notice("");
    const url = new URL(location.href);
    url.searchParams.delete("promo");
    history.replaceState(null, "", url);
    panel.hidden = true;
    toggle.hidden = false;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
    paint();
  }

  window.checkoutPromo = {
    pairChanged() {
      confirmedPair = "";
      if (activeCode && normalized() === activeCode && !activating && !submitting) void check();
      else paint();
    },
    planChanged() {
      if (offer?.kind === "discount" && !blocked) {
        const eligible = Boolean(offer.prices[selected.dataset.plan]);
        notice(eligible ? "Скидка применена к выбранному тарифу." : messages.PROMO_PLAN, !eligible);
      }
      paint();
    },
    price: plan => offer?.prices?.[plan]?.discounted,
    blocksPayment: () => Boolean(activeCode && (waiting || blocked || !confirmedPair || confirmedPair !== code() ||
      offer?.kind !== "discount" || !offer.prices[selected.dataset.plan])),
    paymentFields(plan, method, email) {
      if (!offer?.prices?.[plan]) return {};
      const signature = JSON.stringify([confirmedPair, activeCode, plan, method, email]);
      if (checkout?.signature !== signature) checkout = { signature, id: crypto.randomUUID() };
      return { promo: activeCode, promoAmount: offer.prices[plan].discounted, requestId: checkout.id };
    },
    showPaymentError(error) {
      if (!activeCode || !messages[error]) return false;
      if (error === "PROMO_PAYMENT_CANCELED") checkout = null;
      blocked = !["PROMO_PAYMENT_CANCELED", "PROMO_PAYMENT_UNAVAILABLE", "PROMO_PAYMENT_PENDING"].includes(error);
      notice(messages[error], true);
      paint();
      return true;
    },
  };

  toggle.addEventListener("click", () => { open(); input.focus(); });
  apply.addEventListener("click", () => void check());
  remove.addEventListener("click", clear);
  input.addEventListener("input", () => {
    if (!activeCode || normalized() === activeCode) return;
    generation++;
    waiting = false;
    blocked = true;
    confirmedPair = "";
    notice("Примените новый промокод или уберите его.");
    paint();
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") void check();
  });

  activate.addEventListener("click", async () => {
    if (activate.disabled) return;
    const signature = JSON.stringify([confirmedPair, activeCode]);
    if (trialAttempt?.signature !== signature) trialAttempt = { signature, id: crypto.randomUUID() };
    activating = true;
    for (const input of cells) input.disabled = true;
    paint();
    try {
      const result = await request("redeem", { promo: activeCode, code: confirmedPair, requestId: trialAttempt.id });
      byId("promoSuccessUntil").textContent = "Доступ на двоих до " + date.format(new Date(result.until)) + " (МСК).";
      success.hidden = false;
      entry.hidden = true;
      success.scrollIntoView({ block: "start" });
    } catch (error) {
      notice(messages[error.message] || "Не получилось активировать премиум. Попробуйте ещё раз.", true);
    } finally {
      activating = false;
      for (const input of cells) input.disabled = false;
      paint();
    }
  });

  entry.hidden = false;
  const fromLink = new URLSearchParams(location.search).get("promo");
  if (fromLink) {
    open();
    input.value = fromLink.slice(0, input.maxLength);
    void check();
  }
})();
