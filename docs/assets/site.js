(() => {
  const root = document.documentElement;
  const picker = document.querySelector('[data-theme-picker]');
  const stored = localStorage.getItem('dramago-theme') || 'system';

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
    root.dataset.themePreference = theme;
    localStorage.setItem('dramago-theme', theme);
  }

  applyTheme(stored);
  if (picker) {
    picker.value = stored;
    picker.addEventListener('change', () => applyTheme(picker.value));
  }

  const menuButton = document.querySelector('[data-menu-button]');
  const nav = document.querySelector('[data-site-nav]');
  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = nav.dataset.open !== 'true';
      nav.dataset.open = String(open);
      menuButton.setAttribute('aria-expanded', String(open));
    });
  }

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;
      await navigator.clipboard.writeText(target.textContent.trim());
      const original = button.textContent;
      button.textContent = '已复制';
      setTimeout(() => { button.textContent = original; }, 1400);
    });
  });

  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
})();
