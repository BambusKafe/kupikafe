// Auto-inject background beans on page load
(function() {
    const body = document.body;
    
    // Create 13 bean elements immediately
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= 13; i++) {
        const bean = document.createElement('span');
        bean.className = 'bg-bean-' + i;
        fragment.appendChild(bean);
    }
    body.insertBefore(fragment, body.firstChild);
})();
