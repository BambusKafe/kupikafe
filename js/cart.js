/**
 * 7 Ð“Ñ€Ð°Ð¼Ð° Ð¡Ñ‚ÑƒÐ´Ð¸Ð¾ ÐÐµÑ€Ð¾Ð´Ñ€Ð¾Ð¼ - Cart System
 * Production-ready, unified cart functionality
 */

const STORAGE_NAMESPACE = '7grama';
const LEGACY_CART_KEY = '7grama_cart';
const CONSENT_VERSION = '2026-03-13';
const AUTH_STATE_KEYS = ['isLoggedIn', 'loggedIn', 'auth:isAuthenticated', 'auth_logged_in'];
const PRODUCT_ID_ALIASES = {
    'lavazza-cremoso-16': 'lavazza-cremoso-18',
    'monin-vanilla-025': 'monin-vanilla'
};

let userContext = resolveUserContext();
let cart = loadCartFromStorage();
let consentUiState = null;

// DOM Elements cache
const elements = {
    cartItemsContainer: null,
    cartEmpty: null,
    cartSummary: null,
    cartTotalElement: null,
    orderItemsContainer: null,
    orderTotalElement: null,
    checkoutBtn: null,
    checkoutForm: null
};

function safeParseJSON(value, fallback) {
    if (typeof value !== 'string' || !value.length) return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function parsePriceValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    const rawValue = String(value || '').trim();
    if (!rawValue) return 0;

    const numericText = rawValue.replace(/[^\d.,-]/g, '');
    if (!numericText) return 0;

    const separators = numericText.match(/[.,]/g) || [];
    if (!separators.length) {
        const integerValue = Number(numericText);
        return Number.isFinite(integerValue) ? integerValue : 0;
    }

    if (separators.length > 1) {
        const normalizedThousands = numericText.replace(/[.,](?=\d{3}(?:[^\d]|$))/g, '');
        const decimalSeparator = Math.max(normalizedThousands.lastIndexOf('.'), normalizedThousands.lastIndexOf(','));

        if (decimalSeparator !== -1) {
            const decimalValue = normalizedThousands.slice(decimalSeparator + 1);
            if (decimalValue.length > 0 && decimalValue.length <= 2) {
                const normalizedDecimal = normalizedThousands.slice(0, decimalSeparator).replace(/[.,]/g, '') + '.' + decimalValue;
                const parsedDecimal = Number(normalizedDecimal);
                return Number.isFinite(parsedDecimal) ? parsedDecimal : 0;
            }
        }

        const parsedThousands = Number(numericText.replace(/[.,]/g, ''));
        return Number.isFinite(parsedThousands) ? parsedThousands : 0;
    }

    const separator = separators[0];
    const parts = numericText.split(separator);
    const fractionalPart = parts[1] || '';

    if (fractionalPart.length === 0 || fractionalPart.length === 3) {
        const parsedThousands = Number(parts.join(''));
        return Number.isFinite(parsedThousands) ? parsedThousands : 0;
    }

    const parsedDecimal = Number(parts[0] + '.' + fractionalPart);
    return Number.isFinite(parsedDecimal) ? parsedDecimal : 0;
}

function normalizeProductId(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return '';
    return PRODUCT_ID_ALIASES[normalizedValue] || normalizedValue;
}

function normalizeCartItems(items) {
    if (!Array.isArray(items)) return [];

    return items.reduce(function(normalized, item) {
        if (!item || typeof item !== 'object') return normalized;

        const quantity = Number.parseInt(item.quantity, 10);
        const price = parsePriceValue(item.price);

        if (!Number.isFinite(quantity) || quantity <= 0) return normalized;
        if (!Number.isFinite(price) || price < 0) return normalized;

        const normalizedId = normalizeProductId(item.id);
        const existingItem = normalized.find(function(existing) {
            return existing.id === normalizedId;
        });

        if (existingItem) {
            existingItem.quantity += quantity;
            existingItem.price = price;
            existingItem.weight = item.weight ? String(item.weight) : existingItem.weight;
            existingItem.image = item.image ? String(item.image) : existingItem.image;
            existingItem.name = String(item.name || existingItem.name || 'Product');
            return normalized;
        }

        normalized.push({
            id: normalizedId,
            name: String(item.name || 'Product'),
            price: price,
            weight: item.weight ? String(item.weight) : '',
            image: item.image ? String(item.image) : '',
            quantity: quantity
        });

        return normalized;
    }, []);
}

function normalizeIdentifier(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'guest';
}

function readStorageValue(storage, key) {
    try {
        return storage.getItem(key);
    } catch (error) {
        return null;
    }
}

function writeStorageValue(storage, key, value) {
    try {
        storage.setItem(key, value);
        return true;
    } catch (error) {
        return false;
    }
}

function removeStorageValue(storage, key) {
    try {
        storage.removeItem(key);
    } catch (error) {}
}

function isTruthyStorageValue(value) {
    return value === 'true' || value === '1' || value === 'yes';
}

function readCookie(name) {
    const encodedName = encodeURIComponent(name) + '=';
    const rawCookie = document.cookie || '';
    const parts = rawCookie.split(';');

    for (let index = 0; index < parts.length; index++) {
        const part = parts[index].trim();
        if (!part.startsWith(encodedName)) continue;
        return decodeURIComponent(part.slice(encodedName.length));
    }

    return null;
}

function writeCookie(name, value, options) {
    const config = options || {};
    let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value);
    cookie += '; path=' + (config.path || '/');
    cookie += '; max-age=' + (config.maxAge || 60 * 60 * 24 * 180);
    cookie += '; SameSite=' + (config.sameSite || 'Lax');

    if (window.location.protocol === 'https:') {
        cookie += '; Secure';
    }

    document.cookie = cookie;
}

function deleteCookie(name) {
    document.cookie = encodeURIComponent(name) + '=; path=/; max-age=0; SameSite=Lax';
}

function hasExplicitAuthState() {
    // Primary integration hook: set window.__7gramaAuth = { isAuthenticated, userId } after login.
    if (window.__7gramaAuth && typeof window.__7gramaAuth.isAuthenticated === 'boolean') {
        return window.__7gramaAuth.isAuthenticated;
    }

    if (document.body && document.body.dataset && typeof document.body.dataset.authenticated !== 'undefined') {
        return document.body.dataset.authenticated === 'true';
    }

    for (let index = 0; index < AUTH_STATE_KEYS.length; index++) {
        const key = AUTH_STATE_KEYS[index];
        const localValue = readStorageValue(localStorage, key);
        if (localValue !== null) return isTruthyStorageValue(localValue);
        const sessionValue = readStorageValue(sessionStorage, key);
        if (sessionValue !== null) return isTruthyStorageValue(sessionValue);
    }

    return false;
}

function resolveExplicitUserId() {
    if (window.__7gramaAuth) {
        const auth = window.__7gramaAuth;
        const authIdentifier = auth.userId || auth.id || auth.email || auth.username || auth.customerId;
        if (authIdentifier) return String(authIdentifier);
    }

    if (document.body && document.body.dataset) {
        const bodyIdentifier = document.body.dataset.userId || document.body.dataset.accountId || document.body.dataset.userEmail;
        if (bodyIdentifier) return String(bodyIdentifier);
    }

    return '';
}

function resolveUserContext() {
    const isAuthenticated = hasExplicitAuthState();
    const rawIdentifier = resolveExplicitUserId();
    const userKey = isAuthenticated
        ? normalizeIdentifier(rawIdentifier || 'authenticated')
        : 'guest';

    return {
        isAuthenticated: isAuthenticated,
        userKey: userKey,
        rawIdentifier: rawIdentifier || null
    };
}

function getScopedStorageKey(type, explicitUserKey) {
    const scopedUser = normalizeIdentifier(explicitUserKey || userContext.userKey);
    return STORAGE_NAMESPACE + ':' + type + ':' + scopedUser;
}

function getCartStorageKey() {
    return getScopedStorageKey('cart', userContext.userKey);
}

function getConsentStorageKey() {
    return getScopedStorageKey('consent', userContext.userKey);
}

function getSessionReferenceKey() {
    return getScopedStorageKey('session-ref', userContext.userKey);
}

function getConsentCookieName() {
    return '7grama_consent_' + normalizeIdentifier(userContext.userKey);
}

function loadCartFromStorage() {
    const scopedKey = getCartStorageKey();
    const scopedCart = safeParseJSON(readStorageValue(localStorage, scopedKey), null);

    if (Array.isArray(scopedCart)) {
        return normalizeCartItems(scopedCart);
    }

    const legacyCart = safeParseJSON(readStorageValue(localStorage, LEGACY_CART_KEY), null);
    if (Array.isArray(legacyCart)) {
        const normalizedLegacyCart = normalizeCartItems(legacyCart);
        writeStorageValue(localStorage, scopedKey, JSON.stringify(normalizedLegacyCart));
        return normalizedLegacyCart;
    }

    return [];
}

function persistSessionReference(extra) {
    const payload = Object.assign({
        userKey: userContext.userKey,
        isAuthenticated: userContext.isAuthenticated,
        path: window.location.pathname,
        updatedAt: new Date().toISOString()
    }, extra || {});

    writeStorageValue(sessionStorage, getSessionReferenceKey(), JSON.stringify(payload));
}

function readStoredConsent() {
    const stored = safeParseJSON(readStorageValue(localStorage, getConsentStorageKey()), null);
    if (!stored || typeof stored !== 'object') return null;
    if (stored.essential !== true) return null;
    return stored;
}

function saveConsent(preferences, method) {
    const normalized = {
        essential: true,
        analytics: Boolean(preferences && preferences.analytics),
        marketing: Boolean(preferences && preferences.marketing),
        personalization: Boolean(preferences && preferences.personalization),
        method: method || 'saved',
        version: CONSENT_VERSION,
        savedAt: new Date().toISOString()
    };

    writeStorageValue(localStorage, getConsentStorageKey(), JSON.stringify(normalized));
    writeCookie(getConsentCookieName(), 'accepted', { maxAge: 60 * 60 * 24 * 180 });
    persistSessionReference({ consentVersion: CONSENT_VERSION });
    return normalized;
}

function clearConsent() {
    removeStorageValue(localStorage, getConsentStorageKey());
    deleteCookie(getConsentCookieName());
}

function shouldShowConsentBanner() {
    if (readCookie(getConsentCookieName()) === 'accepted') {
        return !readStoredConsent();
    }
    return !readStoredConsent();
}

function refreshUserContextState() {
    const previousUserKey = userContext.userKey;
    const previousAuthState = userContext.isAuthenticated;

    userContext = resolveUserContext();
    if (userContext.userKey === previousUserKey && userContext.isAuthenticated === previousAuthState) {
        return;
    }

    cart = loadCartFromStorage();
    updateCartCount();
    renderCart();

    initConsentManager();

    persistSessionReference({ contextRefreshed: true });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    userContext = resolveUserContext();
    cart = loadCartFromStorage();

    cacheElements();
    initCart();
    initConsentManager();
    initContactForm();
    initMobileMenu();
    initScrollAnimations();
    initHeroVideoVisibility();
    optimizeProductImageDecoding();
    initDesktopScrollPerformanceMode();
    updateCartCount();
    initProductCards();
    syncCartPricesFromProductCards();
    initRippleEffects();
    persistSessionReference();

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            persistSessionReference({ visibilityState: 'hidden' });
        }
    });

    window.addEventListener('7grama:auth-changed', function() {
        refreshUserContextState();
    });

    window.addEventListener('storage', function(event) {
        if (!event || !event.key) return;
        if (AUTH_STATE_KEYS.indexOf(event.key) !== -1) {
            refreshUserContextState();
        }
    });
});

function createConsentUI() {
    if (consentUiState) return consentUiState;

    const banner = document.createElement('section');
    banner.className = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-labelledby', 'cookie-consent-title');
    banner.setAttribute('aria-describedby', 'cookie-consent-description');
    banner.innerHTML = '' +
        '<div class="cookie-consent-content">' +
            '<h2 id="cookie-consent-title">Поставки за колачиња</h2>' +
            '<p id="cookie-consent-description">Користиме задолжителни колачиња за најава и кошничка. Изберете дали дозволувате и аналитички, персонализациски и маркетинг колачиња.</p>' +
            '<div class="cookie-consent-actions">' +
                '<button type="button" class="btn btn-primary" data-consent-action="accept-all">Прифати сѐ</button>' +
                '<button type="button" class="btn btn-secondary" data-consent-action="reject-optional">Одбиј незадолжителни</button>' +
                '<button type="button" class="btn btn-secondary cookie-manage-trigger" data-consent-action="manage">Управувај поставки</button>' +
            '</div>' +
        '</div>';

    const modal = document.createElement('div');
    modal.className = 'cookie-preferences-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('aria-labelledby', 'cookie-modal-title');
    modal.innerHTML = '' +
        '<div class="cookie-preferences-backdrop" data-consent-action="close-modal"></div>' +
        '<div class="cookie-preferences-panel" tabindex="-1">' +
            '<h2 id="cookie-modal-title">Управување со колачиња</h2>' +
            '<p>Задолжителните колачиња се секогаш вклучени затоа што овозможуваат правилна работа на најавата и кошничката.</p>' +
            '<div class="cookie-pref-list">' +
                '<label class="cookie-pref-row cookie-pref-row-disabled">' +
                    '<span class="cookie-pref-text"><strong>Задолжителни</strong><small>Потребни за најава/сесија и кошничка</small></span>' +
                    '<input type="checkbox" checked disabled aria-label="Задолжителни колачиња се вклучени">' +
                '</label>' +
                '<label class="cookie-pref-row">' +
                    '<span class="cookie-pref-text"><strong>Аналитички</strong><small>Статистика за посетеност и перформанси</small></span>' +
                    '<input type="checkbox" id="cookie-pref-analytics">' +
                '</label>' +
                '<label class="cookie-pref-row">' +
                    '<span class="cookie-pref-text"><strong>Персонализација</strong><small>Подобрено корисничко искуство</small></span>' +
                    '<input type="checkbox" id="cookie-pref-personalization">' +
                '</label>' +
                '<label class="cookie-pref-row">' +
                    '<span class="cookie-pref-text"><strong>Маркетинг</strong><small>Следење на маркетинг кампањи</small></span>' +
                    '<input type="checkbox" id="cookie-pref-marketing">' +
                '</label>' +
            '</div>' +
            '<div class="cookie-preferences-actions">' +
                '<button type="button" class="btn btn-primary" data-consent-action="save-preferences">Зачувај поставки</button>' +
                '<button type="button" class="btn btn-secondary" data-consent-action="close-modal">Откажи</button>' +
                '<button type="button" class="btn btn-secondary cookie-revoke" data-consent-action="revoke-consent">Повлечи согласност</button>' +
            '</div>' +
        '</div>';

    const floatingManageButton = document.createElement('button');
    floatingManageButton.type = 'button';
    floatingManageButton.className = 'cookie-floating-manage';
    floatingManageButton.setAttribute('aria-label', 'Управувај со поставки за колачиња');
    floatingManageButton.innerHTML =
        '<span class="cookie-floating-icon" aria-hidden="true">' +
            '<svg class="cookie-svg" viewBox="0 0 64 64" focusable="false" aria-hidden="true">' +
                '<circle class="cookie-base" cx="32" cy="32" r="22"></circle>' +
                '<circle class="cookie-glow" cx="32" cy="32" r="18"></circle>' +
                '<circle class="cookie-bite bite-1" cx="46" cy="18" r="6"></circle>' +
                '<circle class="cookie-bite bite-2" cx="52" cy="26" r="5"></circle>' +
                '<circle class="cookie-bite bite-3" cx="40" cy="13" r="4"></circle>' +
                '<circle class="cookie-chip chip-1" cx="20" cy="22" r="3"></circle>' +
                '<circle class="cookie-chip chip-2" cx="34" cy="26" r="2.8"></circle>' +
                '<circle class="cookie-chip chip-3" cx="26" cy="36" r="2.6"></circle>' +
                '<circle class="cookie-chip chip-4" cx="38" cy="40" r="2.8"></circle>' +
                '<circle class="cookie-chip chip-5" cx="16" cy="33" r="2.4"></circle>' +
                '<circle class="cookie-chip chip-6" cx="30" cy="17" r="2.2"></circle>' +
                '<circle class="cookie-crumb crumb-1" cx="54" cy="35" r="1.8"></circle>' +
                '<circle class="cookie-crumb crumb-2" cx="12" cy="19" r="1.5"></circle>' +
                '<circle class="cookie-crumb crumb-3" cx="22" cy="51" r="1.6"></circle>' +
            '</svg>' +
        '</span>';

    document.body.appendChild(banner);
    document.body.appendChild(modal);
    document.body.appendChild(floatingManageButton);

    consentUiState = {
        banner: banner,
        modal: modal,
        panel: modal.querySelector('.cookie-preferences-panel'),
        floatingManageButton: floatingManageButton,
        analytics: modal.querySelector('#cookie-pref-analytics'),
        marketing: modal.querySelector('#cookie-pref-marketing'),
        personalization: modal.querySelector('#cookie-pref-personalization'),
        lastFocusedElement: null
    };

    bindConsentUIEvents();
    return consentUiState;
}

function getFocusableElements(container) {
    return Array.prototype.slice.call(container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function(element) {
        return !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true';
    });
}

function triggerPopAnimation(element) {
    if (!element) return;
    element.classList.remove('is-animated');
    element.offsetHeight;
    element.classList.add('is-animated');
}

function openPreferencesModal() {
    const ui = createConsentUI();
    const storedConsent = readStoredConsent() || { analytics: false, personalization: false, marketing: false };
    ui.analytics.checked = Boolean(storedConsent.analytics);
    ui.personalization.checked = Boolean(storedConsent.personalization);
    ui.marketing.checked = Boolean(storedConsent.marketing);

    ui.lastFocusedElement = document.activeElement;
    ui.modal.classList.add('is-visible');
    ui.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cookie-modal-open');
    triggerPopAnimation(ui.panel);

    const focusTargets = getFocusableElements(ui.panel);
    if (focusTargets.length) {
        focusTargets[0].focus();
    } else {
        ui.panel.focus();
    }
}

function closePreferencesModal() {
    if (!consentUiState) return;

    consentUiState.modal.classList.remove('is-visible');
    consentUiState.modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cookie-modal-open');

    if (consentUiState.lastFocusedElement && typeof consentUiState.lastFocusedElement.focus === 'function') {
        consentUiState.lastFocusedElement.focus();
    }
}

function showConsentBanner() {
    const ui = createConsentUI();
    ui.banner.classList.add('is-visible');
    ui.floatingManageButton.classList.add('is-visible');
    triggerPopAnimation(ui.banner);

    const focusTargets = getFocusableElements(ui.banner);
    if (focusTargets.length) {
        focusTargets[0].focus();
    }
}

function hideConsentBanner() {
    if (!consentUiState) return;
    consentUiState.banner.classList.remove('is-visible');
}

function applyConsentSelection(selection, method) {
    saveConsent(selection, method);
    hideConsentBanner();
    closePreferencesModal();
}

function onConsentAction(actionName) {
    if (actionName === 'accept-all') {
        applyConsentSelection({ analytics: true, personalization: true, marketing: true }, 'accept-all');
        return;
    }

    if (actionName === 'reject-optional') {
        applyConsentSelection({ analytics: false, personalization: false, marketing: false }, 'reject-optional');
        return;
    }

    if (actionName === 'manage') {
        openPreferencesModal();
        return;
    }

    if (actionName === 'save-preferences' && consentUiState) {
        applyConsentSelection({
            analytics: consentUiState.analytics.checked,
            personalization: consentUiState.personalization.checked,
            marketing: consentUiState.marketing.checked
        }, 'custom-preferences');
        return;
    }

    if (actionName === 'revoke-consent') {
        clearConsent();
        closePreferencesModal();
        showConsentBanner();
        return;
    }

    if (actionName === 'close-modal') {
        closePreferencesModal();
    }
}

function bindConsentUIEvents() {
    if (!consentUiState) return;

    const ui = consentUiState;

    ui.banner.addEventListener('click', function(event) {
        const trigger = event.target.closest('[data-consent-action]');
        if (!trigger) return;
        onConsentAction(trigger.getAttribute('data-consent-action'));
    });

    ui.modal.addEventListener('click', function(event) {
        const trigger = event.target.closest('[data-consent-action]');
        if (!trigger) return;
        onConsentAction(trigger.getAttribute('data-consent-action'));
    });

    ui.floatingManageButton.addEventListener('click', function() {
        if (shouldShowConsentBanner()) {
            showConsentBanner();
            return;
        }
        openPreferencesModal();
    });

    ui.modal.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closePreferencesModal();
            return;
        }

        if (event.key !== 'Tab') return;

        const focusable = getFocusableElements(ui.panel);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
            return;
        }

        if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

function initConsentManager() {
    createConsentUI();

    if (shouldShowConsentBanner()) {
        showConsentBanner();
        return;
    }

    if (consentUiState) {
        consentUiState.floatingManageButton.classList.add('is-visible');
    }
}

/**
 * Cache DOM elements for performance
 */
function cacheElements() {
    elements.cartItemsContainer = document.getElementById('cart-items');
    elements.cartEmpty = document.getElementById('cart-empty');
    elements.cartSummary = document.getElementById('cart-summary');
    elements.cartTotalElement = document.getElementById('cart-total');
    elements.orderItemsContainer = document.getElementById('order-items');
    elements.orderTotalElement = document.getElementById('order-total');
    elements.checkoutBtn = document.getElementById('checkout-btn');
    elements.checkoutForm = document.getElementById('checkout-form');
}

/**
 * Initialize cart functionality
 */
function initCart() {
    renderCart();
    updateCartTotal();
    
    if (elements.checkoutForm) {
        initCheckoutForm();
    }
}

/**
 * Render cart items
 */
function renderCart() {
    if (!elements.cartItemsContainer) return;
    
    // Reload cart from user-scoped localStorage
    cart = loadCartFromStorage();
    
    if (cart.length === 0) {
        if (elements.cartEmpty) elements.cartEmpty.style.display = 'block';
        if (elements.cartSummary) elements.cartSummary.style.display = 'none';
        if (elements.checkoutBtn) elements.checkoutBtn.style.display = 'none';
        elements.cartItemsContainer.innerHTML = '';
        return;
    }
    
    if (elements.cartEmpty) elements.cartEmpty.style.display = 'none';
    if (elements.cartSummary) elements.cartSummary.style.display = 'block';
    if (elements.checkoutBtn) elements.checkoutBtn.style.display = 'inline-flex';
    
    elements.cartItemsContainer.innerHTML = cart.map((item, index) => `
        <div class="cart-item" data-index="${index}">
            <img src="${item.image}" alt="${item.name}" class="cart-item-image">
            <div class="cart-item-info">
                <h4>${item.name}</h4>
                <p>${item.weight || ''}</p>
            </div>
            <div class="cart-item-price">${item.price.toFixed(2)} <span>ден.</span></div>
            <div class="cart-quantity">
                <button onclick="decreaseQuantity(${index})" class="qty-btn">-</button>
                <span class="qty-value">${item.quantity}</span>
                <button onclick="increaseQuantity(${index})" class="qty-btn">+</button>
            </div>
            <button onclick="removeFromCart(${index})" class="cart-item-remove">Отстрани</button>
        </div>
    `).join('');
    
    updateCartTotal();
}

/**
 * Update cart total and localStorage
 */
function updateCartTotal() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const delivery = 200;
    const totalWithDelivery = subtotal + delivery;
    
    if (elements.cartTotalElement) {
        elements.cartTotalElement.textContent = totalWithDelivery.toFixed(2);
    }
    
    // Update order total on checkout page
    const orderTotalEl = document.getElementById('order-total');
    const orderSubtotalEl = document.getElementById('order-subtotal');
    const orderTaxEl = document.getElementById('order-tax');
    
    if (orderTotalEl) orderTotalEl.textContent = totalWithDelivery.toFixed(2);
    if (orderSubtotalEl) orderSubtotalEl.textContent = subtotal.toFixed(2) + ' ден.';
    if (orderTaxEl) orderTaxEl.textContent = delivery.toFixed(2) + ' ден.';
    
    // Update cart summary on cart page
    const cartSubtotalEl = document.getElementById('cart-subtotal');
    const cartTaxEl = document.getElementById('cart-tax');
    
    if (cartSubtotalEl) cartSubtotalEl.textContent = subtotal.toFixed(2) + ' ден.';
    if (cartTaxEl) cartTaxEl.textContent = delivery.toFixed(2) + ' ден.';
    
    // Save to user-scoped localStorage
    writeStorageValue(localStorage, getCartStorageKey(), JSON.stringify(cart));
    persistSessionReference({ cartItems: cart.length });
    
    // Update order items on checkout
    renderOrderItems();
    
    // Update cart count
    updateCartCount();
}

/**
 * Render order items in checkout
 */
function renderOrderItems() {
    if (!elements.orderItemsContainer) return;
    
    elements.orderItemsContainer.innerHTML = cart.map((item) => `
        <div class="checkout-item">
            <div class="checkout-item-info">
                <h4>${item.name}</h4>
                <span>${item.quantity} x ${item.price.toFixed(2)} ден.</span>
            </div>
            <div class="checkout-item-price">${(item.price * item.quantity).toFixed(2)} ден.</div>
        </div>
    `).join('');
}

/**
 * Increase item quantity
 */
function increaseQuantity(index) {
    cart[index].quantity++;
    saveCart();
    renderCart();
    showToast('Количината е зголемена', 'success');
}

/**
 * Decrease item quantity
 */
function decreaseQuantity(index) {
    if (cart[index].quantity > 1) {
        cart[index].quantity--;
    } else {
        removeFromCart(index);
        return;
    }
    saveCart();
    renderCart();
}

/**
 * Remove item from cart
 */
function removeFromCart(index) {
    const removedItem = cart[index];
    cart.splice(index, 1);
    saveCart();
    renderCart();
    
    if (cart.length === 0) {
        showToast('Кошничката е празна', 'error');
    } else {
        showToast(`${removedItem.name} е отстранет`, 'success');
    }
}

/**
 * Save cart to localStorage
 */
function saveCart() {
    writeStorageValue(localStorage, getCartStorageKey(), JSON.stringify(cart));
    persistSessionReference({ cartItems: cart.length });
}

/**
 * Update cart count in navbar
 */
function updateCartCount() {
    const cartCountElements = document.querySelectorAll('.cart-count');
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    cartCountElements.forEach(element => {
        if (element) {
            element.textContent = totalItems;
            element.style.display = totalItems > 0 ? 'flex' : 'none';
        }
    });
}

/**
 * Add product to cart
 */
function addToCart(product) {
    const normalizedPrice = parsePriceValue(product && product.price);
    const normalizedId = normalizeProductId(product && product.id);
    const existingItem = cart.find(item => item.id === normalizedId);
    
    if (existingItem) {
        existingItem.quantity += 1;
        if (normalizedPrice > 0) {
            existingItem.price = normalizedPrice;
        }
        existingItem.weight = product.weight || existingItem.weight;
        existingItem.image = product.image || existingItem.image;
    } else {
        cart.push({
            id: normalizedId,
            name: product.name,
            price: normalizedPrice,
            weight: product.weight,
            image: product.image,
            quantity: 1
        });
    }
    
    saveCart();
    updateCartCount();
    showToast(`${product.name} е додаден во кошничката!`, 'success');
}

function syncCartPricesFromProductCards() {
    const productCards = document.querySelectorAll('.product-card[data-id]');
    if (!productCards.length || !cart.length) return;

    let hasChanges = false;

    productCards.forEach(function(productCard) {
        const productId = normalizeProductId(productCard.dataset.id);
        if (!productId) return;

        const priceElement = productCard.querySelector('.product-price, .card-price');
        const priceSource = productCard.dataset.price || (priceElement ? priceElement.textContent : '');
        const normalizedPrice = parsePriceValue(priceSource);
        if (!(normalizedPrice > 0)) return;

        const cartItem = cart.find(function(item) {
            return item.id === productId;
        });

        if (!cartItem || cartItem.price === normalizedPrice) return;

        cartItem.price = normalizedPrice;
        hasChanges = true;
    });

    if (!hasChanges) return;

    saveCart();
    updateCartTotal();
}

/**
 * Show temporary "Item added" state on the add-to-cart button.
 */
function showItemAddedState(button) {
    if (!button) return;

    const labelTarget = button.querySelector('.btn-text') || button;
    const originalLabel = labelTarget.textContent.trim();

    if (button._itemAddedTimer) {
        clearTimeout(button._itemAddedTimer);
    }

    labelTarget.textContent = '\u0414\u043e\u0434\u0430\u0434\u0435\u043d\u043e \u0432\u043e \u043a\u043e\u0448\u043d\u0438\u0447\u043a\u0430';
    button.classList.add('item-added');
    button.disabled = true;

    button._itemAddedTimer = setTimeout(function() {
        labelTarget.textContent = originalLabel;
        button.classList.remove('item-added');
        button.disabled = false;
        button._itemAddedTimer = null;
    }, 3000);
}

/**
 * Initialize checkout form
 */
function initCheckoutForm() {
    if (!elements.checkoutForm) return;
    
    renderOrderItems();
    
    elements.checkoutForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (!validateCheckoutForm()) {
            return;
        }
        
        if (cart.length === 0) {
            showToast('Кошничката е празна', 'error');
            return;
        }
        
        // Get form values
        const firstName = document.getElementById('first-name').value.trim();
        const lastName = document.getElementById('last-name').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const email = document.getElementById('email').value.trim();
        const address = document.getElementById('address').value.trim();
        const city = document.getElementById('city').value.trim();
        const note = document.getElementById('note') ? document.getElementById('note').value.trim() : '';
        
        // Calculate totals
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const delivery = 200;
        const total = subtotal + delivery;
        
        // Build payload for backend order API
        const orderData = {
            customer: {
                firstName: firstName,
                lastName: lastName,
                phone: phone,
                email: email,
                address: address,
                city: city,
                note: note
            },
            products: cart.map(function(item) {
                return {
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    total: item.price * item.quantity
                };
            }),
            subtotal: subtotal,
            delivery: delivery,
            total: total,
            orderDate: new Date().toLocaleString('mk-MK')
        };

        function finalizeSuccessfulOrder() {
            // Clear cart and refresh all cart-related UI state.
            cart = [];
            saveCart();
            updateCartCount();
            renderOrderItems();

            // Show confirmation and reset form.
            showOrderConfirmation();
            elements.checkoutForm.reset();

            setTimeout(function() {
                window.location.href = 'index.html';
            }, 5000);
        }

        // Show loading state
        const submitBtn = elements.checkoutForm.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.textContent : '\u0418\u0441\u043f\u0440\u0430\u0442\u0438';
        if (submitBtn) {
            submitBtn.textContent = '\u041f\u043e\u0440\u0430\u043a\u0430\u0442\u0430 \u0441\u0435 \u043f\u0440\u0430\u045c\u0430...';
            submitBtn.disabled = true;
        }
        
        fetch('/api/send-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        })
            .then(async function(response) {
                let result = null;
                try {
                    result = await response.json();
                } catch (error) {
                    result = null;
                }

                if (!response.ok || !result || !result.success) {
                    const message = result && result.message ? result.message : 'Грешка при испраќање на нарачката';
                    throw new Error(message);
                }

                showToast('Нарачката е испратена!', 'success');
                finalizeSuccessfulOrder();
            })
            .catch(function(error) {
                console.error('Order submit error:', error);
                showToast(error && error.message ? error.message : 'Нарачката не беше испратена. Обидете се повторно.', 'error');
            })
            .finally(function() {
                if (submitBtn) {
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            });
    });
}

/**
 * Show order confirmation
 */
function showOrderConfirmation() {
    const checkoutContent = document.querySelector('.checkout-content');
    if (checkoutContent) {
        checkoutContent.innerHTML = '<div class="order-confirmation show">' +
            '<div class="confirmation-icon">' +
            '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>' +
            '</div>' +
            '<h2>Нарачката е потврдена!</h2>' +
            '<p>Ќе контактираме за потврда и испорака.</p>' +
            '<a href="index.html" class="btn btn-primary" style="margin-top: 30px;">Континуирај со купување</a>' +
            '</div>';
    }
}

/**
 * Validate checkout form
 */
function validateCheckoutForm() {
    let isValid = true;
    
    const fields = [
        { id: 'first-name', name: 'Име' },
        { id: 'last-name', name: 'Презиме' },
        { id: 'phone', name: 'Телефон' },
        { id: 'email', name: 'Е-маил' },
        { id: 'address', name: 'Адреса' },
        { id: 'city', name: 'Град' }
    ];
    
    fields.forEach(function(field) {
        const input = document.getElementById(field.id);
        clearError(input);
        
        if (!input || !input.value.trim()) {
            showError(input, 'Ве молиме внесете ' + field.name);
            isValid = false;
        } else if (field.id === 'phone' && input.value.trim().length < 6) {
            showError(input, 'Телефонот мора да има барем 6 цифри');
            isValid = false;
        } else if (field.id === 'email' && !isValidEmail(input.value.trim())) {
            showError(input, 'Ве молиме внесете валиден е-маил');
            isValid = false;
        }
    });
    
    return isValid;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Show error on form field
 */
function showError(input, message) {
    if (!input) return;
    const formGroup = input.closest('.form-group');
    if (formGroup) {
        formGroup.classList.add('error');
        let errorElement = formGroup.querySelector('.error-message');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.className = 'error-message';
            formGroup.appendChild(errorElement);
        }
        errorElement.textContent = message;
    }
}

/**
 * Clear error from form field
 */
function clearError(input) {
    if (!input) return;
    const formGroup = input.closest('.form-group');
    if (formGroup) {
        formGroup.classList.remove('error');
        const errorElement = formGroup.querySelector('.error-message');
        if (errorElement) {
            errorElement.remove();
        }
    }
}

/**
 * Initialize contact form
 */
function initContactForm() {
    const contactForm = document.getElementById('contact-form');
    if (!contactForm) return;
    
    contactForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const firstName = document.getElementById('first-name');
        const lastName = document.getElementById('last-name');
        const email = document.getElementById('email');
        const message = document.getElementById('message');
        
        // Reset errors
        [firstName, lastName, email, message].forEach(function(el) { clearError(el); });
        
        let isValid = true;
        
        if (!firstName.value.trim()) {
            showError(firstName, 'Ве молиме внесете име');
            isValid = false;
        }
        
        if (!lastName.value.trim()) {
            showError(lastName, 'Ве молиме внесете презиме');
            isValid = false;
        }
        
        if (!email.value.trim() || !isValidEmail(email.value.trim())) {
            showError(email, 'Ве молиме внесете валиден е-маил');
            isValid = false;
        }
        
        if (!message.value.trim()) {
            showError(message, 'Ве молиме внесете порака');
            isValid = false;
        }
        
        if (!isValid) return;
        
        // Show loading state
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.textContent : '\u0418\u0441\u043f\u0440\u0430\u0442\u0438';
        if (submitBtn) {
            submitBtn.textContent = '\u041f\u043e\u0440\u0430\u043a\u0430\u0442\u0430 \u0441\u0435 \u043f\u0440\u0430\u045c\u0430...';
            submitBtn.disabled = true;
        }
        
        const formData = {
            firstName: firstName.value.trim(),
            lastName: lastName.value.trim(),
            email: email.value.trim(),
            message: message.value.trim()
        };
        
        function openContactMailtoFallback() {
            const subject = encodeURIComponent('Контакт порака - 7 Грама Студио');
            const body = encodeURIComponent(
                'Име: ' + formData.firstName + '\n' +
                'Презиме: ' + formData.lastName + '\n' +
                'Е-маил: ' + formData.email + '\n\n' +
                'Порака:\n' + formData.message
            );
            window.location.href = 'mailto:7grama.bambuskafe@gmail.com?subject=' + subject + '&body=' + body;
        }

        try {
            const response = await fetch('/api/send-contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const responseText = await response.text();
            let result = null;

            if (responseText) {
                try {
                    result = JSON.parse(responseText);
                } catch (parseError) {
                    result = null;
                }
            }

            if (response.ok && result && result.success) {
                showToast('Пораката е испратена успешно!', 'success');
                contactForm.reset();
            } else {
                // If backend API is unavailable or email delivery is misconfigured, fallback to mail client.
                if (response.status === 404 || response.status >= 500) {
                    openContactMailtoFallback();
                    showToast('Отворен е е-маил клиент за испраќање на пораката.', 'success');
                    contactForm.reset();
                    return;
                }
                const messageText = result && result.message
                    ? result.message
                    : ('Сервисот за пораки моментално не е достапен (' + response.status + ').');
                showToast(messageText, 'error');
            }
        } catch (error) {
            console.error('Contact form error:', error);
            openContactMailtoFallback();
            showToast('Отворен е е-маил клиент за испраќање на пораката.', 'success');
        } finally {
            if (submitBtn) {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }
    });
}

/**
 * Initialize mobile menu with smooth animations
 */
function initMobileMenu() {
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    const menuOverlay = document.querySelector('.menu-overlay');
    const body = document.body;
    
    if (!menuToggle || !navMenu) return;
    
    function closeMenu() {
        menuToggle.classList.remove('active');
        navMenu.classList.remove('active');
        if (menuOverlay) menuOverlay.classList.remove('active');
        body.classList.remove('menu-open');
    }
    
    function openMenu() {
        menuToggle.classList.add('active');
        navMenu.classList.add('active');
        if (menuOverlay) menuOverlay.classList.add('active');
        body.classList.add('menu-open');
    }
    
    // Toggle menu with smooth animation
    menuToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        const isActive = menuToggle.classList.contains('active');
        
        if (isActive) {
            closeMenu();
        } else {
            openMenu();
        }
    });
    
    // Close on overlay click
    if (menuOverlay) {
        menuOverlay.addEventListener('click', function(e) {
            e.stopPropagation();
            closeMenu();
        });
    }
    
    // Close on regular link click (not dropdown parent)
    const navLinks = navMenu.querySelectorAll('.nav-link:not(.nav-dropdown > .nav-link)');
    navLinks.forEach(function(link) {
        link.addEventListener('click', function() {
            closeMenu();
        });
    });
    
    // Close on dropdown item click
    const dropdownItems = navMenu.querySelectorAll('.dropdown-item');
    dropdownItems.forEach(function(item) {
        item.addEventListener('click', function() {
            closeMenu();
        });
    });
    
    // Mobile dropdown toggle with smooth animation
    const navDropdowns = document.querySelectorAll('.nav-dropdown');
    navDropdowns.forEach(function(dropdown) {
        const link = dropdown.querySelector('.nav-link');
        
        link.addEventListener('click', function(e) {
            if (window.innerWidth <= 992) {
                e.preventDefault();
                e.stopPropagation();
                
                const isActive = dropdown.classList.contains('active');
                
                // Close all other dropdowns
                navDropdowns.forEach(function(other) {
                    if (other !== dropdown) {
                        other.classList.remove('active');
                    }
                });
                
                // Toggle current dropdown
                dropdown.classList.toggle('active');
            }
        });
    });
    
    // Reset on resize to desktop
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            if (window.innerWidth > 992) {
                closeMenu();
                navDropdowns.forEach(function(dropdown) {
                    dropdown.classList.remove('active');
                });
            }
        }, 250);
    });
    
    // Prevent body scroll when menu is open
    navMenu.addEventListener('touchmove', function(e) {
        if (body.classList.contains('menu-open')) {
            e.stopPropagation();
        }
    }, { passive: true });
}

/**
 * Initialize scroll animations
 */
function initScrollAnimations() {
    const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
    if (!revealElements.length) return;

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(function(entries, obs) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    obs.unobserve(entry.target);
                }
            });
        }, {
            root: null,
            rootMargin: '0px 0px -100px 0px',
            threshold: 0.01
        });

        revealElements.forEach(function(element) {
            observer.observe(element);
        });
        return;
    }

    // Fallback for very old browsers
    revealElements.forEach(function(element) {
        element.classList.add('active');
    });
}

/**
 * Keep hero/category video active only while visible to reduce CPU/GPU load.
 */
function initHeroVideoVisibility() {
    const video = document.querySelector('.hero-video');
    if (!video) return;

    if (!('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                video.play().catch(function() {});
            } else {
                video.pause();
            }
        });
    }, {
        threshold: 0.05
    });

    observer.observe(video);
}

/**
 * Prevent synchronous image decode jank when many product cards are present.
 */
function optimizeProductImageDecoding() {
    const images = document.querySelectorAll('.product-card img, .card-image, .product-image');
    if (!images.length) return;

    images.forEach(function(img) {
        img.decoding = 'async';
        img.fetchPriority = 'low';
        img.draggable = false;
    });
}

/**
 * Desktop-only temporary performance mode while actively scrolling.
 * Keeps visuals the same at rest, but reduces micro-stutter during fast scroll.
 */
function initDesktopScrollPerformanceMode() {
    const isDesktopPointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!isDesktopPointer) return;

    let scrollTimer = null;
    let ticking = false;

    window.addEventListener('scroll', function() {
        if (!ticking) {
            requestAnimationFrame(function() {
                document.body.classList.add('is-scrolling-fast');
                ticking = false;
            });
            ticking = true;
        }

        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function() {
            document.body.classList.remove('is-scrolling-fast');
        }, 120);
    }, { passive: true });
}

/**
 * Initialize product cards with add to cart
 */
function initProductCards() {
    // Use event delegation for better performance
    document.addEventListener('click', function(e) {
        const button = e.target.closest('.btn-add-cart, .card-btn-add');
        if (!button) return;
        
        e.preventDefault();
        
        const productCard = button.closest('.product-card');
        if (!productCard) return;
        
        // Cache selectors
        const productImage = productCard.querySelector('.product-image, .card-image');
        const productName = productCard.querySelector('.product-name, .card-title');
        const productWeight = productCard.querySelector('.product-weight, .card-weight');
        const productPriceEl = productCard.querySelector('.product-price, .card-price');
        
        // Parse price
        const priceSource = productCard.dataset.price || (productPriceEl ? productPriceEl.textContent : '');
        const price = parsePriceValue(priceSource);
        
        const product = {
            id: normalizeProductId(productCard.dataset.id) || generateProductId(productName ? productName.textContent : 'product'),
            name: productName ? productName.textContent.trim() : 'Product',
            price: price,
            weight: productWeight ? productWeight.textContent.trim() : '',
            image: productImage ? productImage.src : ''
        };
        
        addToCart(product);
        showItemAddedState(button);
    });
}

/**
 * Generate product ID from name
 */
function generateProductId(name) {
    return name.toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '') + '_' + Date.now();
}

/**
 * Show toast notification
 */
function showToast(message, type) {
    type = type || 'success';
    let toast = document.querySelector('.toast');
    
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg><span class="toast-message"></span>';
        document.body.appendChild(toast);
    }
    
    toast.className = 'toast ' + type;
    toast.querySelector('.toast-message').textContent = message;
    
    // Force reflow
    toast.offsetHeight;
    
    toast.classList.add('show');
    
    setTimeout(function() {
        toast.classList.remove('show');
    }, 3000);
}

/**
 * Ripple effect for buttons
 */
function createRipple(event, button) {
    const ripple = document.createElement('span');
    ripple.classList.add('ripple');
    
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (event.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (event.clientY - rect.top - size / 2) + 'px';
    
    button.appendChild(ripple);
    
    ripple.addEventListener('animationend', function() {
        ripple.remove();
    });
}

/**
 * Initialize ripple effect on buttons
 */
function initRippleEffects() {
    const buttons = document.querySelectorAll('.btn-add-cart');
    
    buttons.forEach(function(button) {
        button.addEventListener('click', function(e) {
            createRipple(e, this);
        });
    });
}

// Global functions for onclick handlers
window.increaseQuantity = increaseQuantity;
window.decreaseQuantity = decreaseQuantity;
window.removeFromCart = removeFromCart;
window.addToCart = addToCart;
window.updateCartCount = updateCartCount;
window.showToast = showToast;
window.openCookiePreferences = openPreferencesModal;
window.cookieConsentManager = {
    openPreferences: openPreferencesModal,
    revokeConsent: function() {
        clearConsent();
        showConsentBanner();
    },
    getConsent: readStoredConsent
};
