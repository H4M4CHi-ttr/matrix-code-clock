(() => {
  const root = document.documentElement;
  const button = document.querySelector("#settings-button");
  const drawer = document.querySelector("#settings-drawer");
  const close = document.querySelector("#settings-close");
  const choices = [...drawer.querySelectorAll('input[name="dot-style"]')];
  const status = document.querySelector("#settings-status");
  const storageKey = "matrix-code-clock-style";
  let hideTimer;

  function setStyle(value) {
    const style = value === "square" ? "square" : "round";
    for (const choice of choices) choice.checked = choice.value === style;
    if (root.dataset.dotStyle === style) return;
    root.dataset.dotStyle = style;
    document.dispatchEvent(new Event("clockstylechange"));
  }

  function scheduleHide(force = false) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!force && document.hasFocus() && button.matches(":focus-visible")) return;
      button.classList.remove("is-visible");
    }, 3000);
  }

  function reveal(event) {
    if (event?.type === "pointermove" && !document.hasFocus()) return;
    button.classList.add("is-visible");
    scheduleHide();
  }

  let saved = "round";
  try {
    saved = localStorage.getItem(storageKey);
  } catch {
    status.hidden = false;
  }
  setStyle(saved);

  drawer.addEventListener("change", (event) => {
    if (!choices.includes(event.target)) return;
    setStyle(event.target.value);
    try {
      localStorage.setItem(storageKey, root.dataset.dotStyle);
      status.hidden = true;
    } catch {
      status.hidden = false;
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) setStyle(event.newValue);
  });
  document.addEventListener("pointermove", reveal, { passive: true });
  document.addEventListener("pointerdown", reveal, { passive: true });
  document.addEventListener("keydown", reveal);
  button.addEventListener("focus", reveal);
  button.addEventListener("blur", () => scheduleHide());
  window.addEventListener("focus", reveal);
  window.addEventListener("blur", () => scheduleHide(true));

  button.addEventListener("click", () => {
    drawer.showModal();
    button.setAttribute("aria-expanded", "true");
  });
  close.addEventListener("click", () => drawer.close());
  drawer.addEventListener("close", () => {
    button.setAttribute("aria-expanded", "false");
    reveal();
  });
  drawer.addEventListener("click", (event) => {
    if (event.target !== drawer) return;
    const bounds = drawer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      drawer.close();
    }
  });
})();
