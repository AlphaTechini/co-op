class Theme {
  current = $state<'light' | 'dark'>('light');

  init() {
    const attr = document.documentElement.getAttribute('data-theme');
    this.current = attr === 'dark' ? 'dark' : 'light';
  }

  toggle() {
    this.current = this.current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.current);
    try {
      localStorage.setItem('coop-theme', this.current);
    } catch {
      /* storage can be blocked; the choice then lasts for this page only */
    }
  }
}

export const theme = new Theme();
