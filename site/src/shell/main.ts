// Site shell script: navigation state and footer year only.
// The interactive demo is a separate module owned by the core task (site/src/demo/). It is not imported here.
import './styles.css';

function markCurrentNav(): void {
  const last = location.pathname.split('/').pop() ?? '';
  const current = last === '' ? 'index.html' : last;
  document.querySelectorAll<HTMLAnchorElement>('.wfn-nav a').forEach((a) => {
    const target = (a.getAttribute('href') ?? '').replace(/^\.\//, '');
    if (target === current) a.setAttribute('aria-current', 'page');
  });
}

function setYear(): void {
  const el = document.getElementById('wfn-year');
  if (el) el.textContent = String(new Date().getFullYear());
}

markCurrentNav();
setYear();
