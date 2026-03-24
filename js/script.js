/**
 * 7 Грама Студио Аеродром - Main JavaScript
 * Non-cart functionality (animations, UI, etc.)
 */

// DOM Elements
const navbar = document.querySelector('.navbar');
const scrollIndicator = document.querySelector('.scroll-indicator');

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initNavbar();
    initScrollIndicator();
    optimizeHeroVideo();
    
    // Navbar scroll effect
    let scrollTicking = false;
    window.addEventListener('scroll', function() {
        if (scrollTicking || !navbar) return;
        scrollTicking = true;

        requestAnimationFrame(function() {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
            scrollTicking = false;
        });
    }, { passive: true });
});

/**
 * Scroll indicator click handler
 */
function initScrollIndicator() {
    if (scrollIndicator) {
        scrollIndicator.addEventListener('click', function() {
            const nextSection = document.querySelector('.section');
            if (nextSection) {
                nextSection.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
}

/**
 * Navbar initialization (for additional navbar-specific code if needed)
 */
function initNavbar() {
    // Additional navbar code can go here
    // Most navbar functionality is handled in cart.js for consistency
}

/**
 * Reduce heavy video usage on constrained networks/devices.
 */
function optimizeHeroVideo() {
    const video = document.querySelector('.hero-video');
    if (!video) return;
    
    // Keep hero video lightweight until the browser decides playback is needed.
    video.preload = 'metadata';

    tryDesktopVideoSource(video);
}

/**
 * On desktop-class devices, prefer a separate higher-bitrate hero video
 * when a desktop source is provided via data attribute.
 */
function tryDesktopVideoSource(video) {
    const desktopSrc = video.getAttribute('data-desktop-src');
    if (!desktopSrc) return;

    const isDesktop = window.matchMedia('(min-width: 992px) and (hover: hover) and (pointer: fine)').matches;
    if (!isDesktop) return;

    fetch(desktopSrc, { method: 'HEAD' })
        .then(function(response) {
            if (!response.ok) return;

            const source = video.querySelector('source');
            if (!source || source.getAttribute('src') === desktopSrc) return;

            source.setAttribute('src', desktopSrc);
            video.load();
            video.play().catch(function() {});
        })
        .catch(function() {
            // Keep default mobile-optimized source when desktop file is missing.
        });
}

// Export functions if needed
window.initNavbar = initNavbar;
window.initScrollIndicator = initScrollIndicator;
