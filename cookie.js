// Баннер cookie при первом заходе на любую страницу — требование инструкции юриста
// для Роскомнадзора (16.10.2026). Текст — её, слово в слово. Ссылки на «Политику
// использования файлов cookie» пока нет: текста юрист не прислал. Придёт — страница
// и вторая ссылка добавляются сюда.
//
// Нажатие «Принять» запоминается в localStorage этого браузера. Нет хранилища
// (приватный режим, запрет сайта) — баннер просто покажется снова, страница работает.
(() => {
  const KEY = "cookieAccepted";
  try { if (localStorage.getItem(KEY)) return; } catch {}

  const en = document.documentElement.lang === "en";
  const box = document.createElement("div");
  box.className = "cookie";
  box.innerHTML = en
    ? '<p>We use cookies to improve the website. By continuing to use the website, you agree to our <a href="privacy-en.html">Personal Data Processing Policy</a>.</p><button type="button">Accept</button>'
    : '<p>Мы используем файлы cookie для улучшения работы сайта. Продолжая использовать сайт, вы соглашаетесь с нашей <a href="privacy-ru.html">Политикой обработки персональных данных</a>.</p><button type="button">Принять</button>';
  box.querySelector("button").addEventListener("click", () => {
    try { localStorage.setItem(KEY, "1"); } catch {}
    box.remove();
  });
  document.body.append(box);
})();
