// Bind trusted handlers from the application bundle. Printable HTML contains
// neither inline scripts nor event attributes and inherits the parent's CSP.
export function preparePrintWindow(win, { autoPrint = false } = {}) {
    if (!win) return;
    const doc = win.document;
    const hideBrokenImage = image => {
        const target = image.dataset.hideOnError === 'parent' ? image.parentElement : image;
        if (target) target.style.display = 'none';
    };
    const images = [...doc.images].filter(image => image.getAttribute('src'));
    for (const image of images) {
        image.addEventListener('error', () => hideBrokenImage(image), { once: true });
        if (image.complete && image.naturalWidth === 0) hideBrokenImage(image);
    }
    doc.querySelector('.print-btn')?.addEventListener('click', () => win.print());
    const toggle = doc.querySelector('.side-toggle');
    toggle?.addEventListener('click', () => {
        doc.body.classList.toggle('side-closed');
        toggle.textContent = doc.body.classList.contains('side-closed') ? '현황 열기' : '현황 닫기';
    });
    const modal = doc.getElementById('mpResultModal'), modalImage = doc.getElementById('mpResultModalImg');
    const close = () => {
        modal?.classList.remove('is-open');
        modal?.setAttribute('aria-hidden', 'true');
        modalImage?.removeAttribute('src');
    };
    doc.addEventListener('click', event => {
        if (event.target?.classList?.contains('mp-result-img') && modal && modalImage) {
            modalImage.src = event.target.getAttribute('src');
            modal.classList.add('is-open');
            modal.setAttribute('aria-hidden', 'false');
        }
        if (event.target === modal) close();
    });
    modal?.querySelector('.mp-result-modal__close')?.addEventListener('click', close);
    doc.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    if (autoPrint) {
        const loaded = images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        }));
        loaded.push(doc.fonts?.ready || Promise.resolve());
        Promise.race([Promise.all(loaded), new Promise(resolve => win.setTimeout(resolve, 3000))])
            .then(() => { if (!win.closed) { win.focus(); win.print(); } });
    }
}
