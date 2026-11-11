// Site menu (Orisod 2.0): the Menu panel, the Search icon, its reveal on pages
// with their own search box, and the category flyouts. Single source for every
// page that carries the generated menu: scripts/sync_nav.py copies this file
// into the marked region near the end of each page; scripts/check_nav_sync.py
// (CI: check-nav-sync) fails when a copy differs. Edit it here, then run:
// python scripts/sync_nav.py --write
// The flyouts are static HTML in each page's menu, generated from the /tools
// cards; this script only opens and closes them.

// Minimal nav (Initiative 2): the Menu panel and the Search icon.
// Button labels come from data attributes, so the same script works in every
// language. The Search icon opens a small search box under the nav; only
// submitting it leaves the page (to /tools/?search=...). On a page that has
// its own search box, the icon's data-search-target names it and the icon
// just scrolls to it and focuses it instead.
(function(){
  var menuBtn = document.getElementById('navMenuBtn');
  var menu = document.getElementById('navMenu');
  var searchBtn = document.getElementById('navSearchBtn');
  var form = document.getElementById('navSearch');
  var input = form && form.querySelector('input');
  if(!menuBtn || !menu || !searchBtn) return;

  function openMenu(){
    closeSearch(false);
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.setAttribute('aria-label', menuBtn.getAttribute('data-label-close'));
    var first = menu.querySelector('a'); if(first) first.focus();
  }
  function closeMenu(returnFocus){
    if(menu.hidden) return;
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', menuBtn.getAttribute('data-label-open'));
    if(returnFocus) menuBtn.focus();
  }
  menuBtn.addEventListener('click', function(){
    if(menu.hidden) openMenu(); else closeMenu(true);
  });
  // Picking a link closes the menu (matters where a link acts in place, like /tools filters).
  menu.addEventListener('click', function(e){
    if(e.target.closest('a')) closeMenu(false);
  });
  // Tabbing past the last menu link closes the menu.
  menu.addEventListener('focusout', function(e){
    if(e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== menuBtn) closeMenu(false);
  });

  function openSearch(){
    closeMenu(false);
    form.hidden = false;
    searchBtn.setAttribute('aria-expanded', 'true');
    input.focus();
  }
  function closeSearch(returnFocus){
    if(!form || form.hidden) return;
    form.hidden = true;
    input.value = '';
    searchBtn.setAttribute('aria-expanded', 'false');
    if(returnFocus) searchBtn.focus();
  }
  searchBtn.addEventListener('click', function(){
    var target = document.getElementById(searchBtn.getAttribute('data-search-target'));
    if(target){
      closeMenu(false);
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block: 'center'});
      target.focus({preventScroll: true});
      return;
    }
    if(!form) return;
    if(form.hidden) openSearch(); else closeSearch(true);
  });
  if(form){
    // An empty search goes nowhere; the box just stays open.
    form.addEventListener('submit', function(e){
      if(!input.value.trim()){ e.preventDefault(); input.focus(); }
    });
    form.addEventListener('focusout', function(e){
      if(e.relatedTarget && !form.contains(e.relatedTarget) && e.relatedTarget !== searchBtn) closeSearch(false);
    });
  }

  document.addEventListener('click', function(e){
    if(!menu.contains(e.target) && !menuBtn.contains(e.target)) closeMenu(false);
    if(form && !form.contains(e.target) && !searchBtn.contains(e.target)) closeSearch(false);
  });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    if(form && !form.hidden) closeSearch(true); else closeMenu(true);
  });
})();
// Reveal the nav search icon only after the page's own search box (the one
// the icon's data-search-target names, or the element data-search-watch
// selects around it, like the homepage's .search-box) has scrolled up past the
// bottom of the sticky nav. Pages without their own search box keep the icon
// (it opens the nav search box). Without IntersectionObserver the icon simply
// stays visible.
(function(){
  var btn = document.getElementById('navSearchBtn');
  var target = btn && document.getElementById(btn.getAttribute('data-search-target'));
  var watch = btn && btn.getAttribute('data-search-watch');
  var box = target && (watch ? document.querySelector(watch) : target);
  var nav = document.querySelector('.site-nav');
  if(!btn || !box || !nav || !('IntersectionObserver' in window)) return;
  function update(){
    var past = box.getBoundingClientRect().bottom <= nav.getBoundingClientRect().bottom;
    btn.classList.toggle('search-reveal-hidden', !past);
  }
  // First check happens with transitions off, so the icon doesn't visibly
  // animate away right after the page loads.
  btn.style.transition = 'none';
  update();
  void btn.offsetWidth;
  btn.style.transition = '';
  var io;
  function observe(){
    if(io) io.disconnect();
    // Shrink the observed area from the top by the nav's height, so "out of
    // view" means "hidden behind the nav", not just "off the top of the screen".
    io = new IntersectionObserver(update, {rootMargin: '-' + nav.offsetHeight + 'px 0px 0px 0px', threshold: [0, 1]});
    io.observe(box);
  }
  observe();
  window.addEventListener('resize', function(){ observe(); update(); });
})();
// Open/close the menu's category flyouts (desktop only, 601px+).
// Mouse: hover a category to open its flyout; moving into the flyout keeps it
// open; leaving both closes it after a short delay. Keyboard: focusing a
// category opens its flyout, Tab moves into its links, Escape closes the
// flyout and returns focus to the category (a second Escape closes the menu).
// Clicking a category still goes to /tools/#category (on /tools: jumps to that
// section); phones never see flyouts.
(function(){
  var menu = document.getElementById('navMenu');
  var items = menu ? [].slice.call(menu.querySelectorAll('a.menu-item[data-flyout]')) : [];
  if(!items.length) return;
  var desktop = window.matchMedia('(min-width:601px)');
  var GAP = 8, EDGE = 12, TWO_COL_WIDTH = 460, ONE_COL_WIDTH = 280;
  var openItem = null, closeTimer = null, switchTimer = null, suppressFocusOpen = false;

  function flyoutOf(item){ return document.getElementById(item.getAttribute('data-flyout')); }
  function clearTimers(){ clearTimeout(closeTimer); clearTimeout(switchTimer); closeTimer = switchTimer = null; }

  function place(fly){
    var r = menu.getBoundingClientRect();
    var room = r.left - GAP - EDGE;
    var two = room >= TWO_COL_WIDTH;
    var width = Math.min(two ? TWO_COL_WIDTH : ONE_COL_WIDTH, room);
    var top = r.top;
    fly.classList.toggle('two-col', two);
    fly.style.top = top + 'px';
    fly.style.left = (r.left - GAP - width) + 'px';
    fly.style.width = width + 'px';
    fly.style.maxHeight = (window.innerHeight - top - EDGE) + 'px';
    // The invisible bridge over the gap, as tall as the panel or flyout.
    fly.style.setProperty('--fly-top', top + 'px');
    fly.style.setProperty('--fly-h', Math.max(r.height, fly.offsetHeight) + 'px');
    fly.style.setProperty('--fly-gap-left', (r.left - GAP) + 'px');
    fly.style.setProperty('--fly-gap', GAP + 'px');
  }
  function open(item){
    clearTimers();
    if(!desktop.matches) return;
    if(openItem === item) return;
    closeAll();
    var fly = flyoutOf(item);
    fly.hidden = false;
    fly.scrollTop = 0;
    place(fly);
    item.setAttribute('aria-expanded', 'true');
    openItem = item;
  }
  function closeAll(){
    clearTimers();
    items.forEach(function(item){
      flyoutOf(item).hidden = true;
      if(desktop.matches) item.setAttribute('aria-expanded', 'false');
    });
    openItem = null;
  }
  function scheduleClose(){
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closeAll, 200);
  }
  function syncAria(){
    items.forEach(function(item){
      if(desktop.matches){
        item.setAttribute('aria-controls', item.getAttribute('data-flyout'));
        item.setAttribute('aria-expanded', item === openItem ? 'true' : 'false');
      } else {
        item.removeAttribute('aria-controls');
        item.removeAttribute('aria-expanded');
      }
    });
  }

  items.forEach(function(item){
    var fly = flyoutOf(item);
    item.addEventListener('pointerenter', function(e){
      if(e.pointerType !== 'mouse') return;
      clearTimeout(closeTimer);
      if(openItem && openItem !== item){
        // Another flyout is open: wait a moment, so a diagonal move toward
        // that flyout that brushes this row doesn't switch it.
        clearTimeout(switchTimer);
        switchTimer = setTimeout(function(){ open(item); }, 150);
      } else {
        open(item);
      }
    });
    item.addEventListener('pointerleave', function(e){
      if(e.pointerType !== 'mouse') return;
      clearTimeout(switchTimer);
      scheduleClose();
    });
    fly.addEventListener('pointerenter', function(){ clearTimers(); });
    fly.addEventListener('pointerleave', function(e){
      if(e.pointerType === 'mouse') scheduleClose();
    });
  });

  // Keyboard: focus decides which flyout (if any) is open.
  menu.addEventListener('focusin', function(e){
    var t = e.target;
    var item = items.indexOf(t) > -1 ? t : null;
    if(item){
      if(suppressFocusOpen){ suppressFocusOpen = false; return; }
      open(item);
    } else if(!(openItem && flyoutOf(openItem).contains(t))){
      closeAll();
    }
  });

  // Escape closes just the open flyout first. Runs before the menu's own
  // document-level Escape handler, which then closes the whole menu.
  menu.addEventListener('keydown', function(e){
    if(e.key !== 'Escape' || !openItem) return;
    e.stopPropagation();
    var item = openItem;
    var wasInside = flyoutOf(item).contains(document.activeElement);
    closeAll();
    if(wasInside){ suppressFocusOpen = true; item.focus(); }
  });

  // Close flyouts whenever the menu itself closes, or the window resizes.
  new MutationObserver(function(){ if(menu.hidden) closeAll(); })
    .observe(menu, {attributes: true, attributeFilter: ['hidden']});
  window.addEventListener('resize', function(){
    if(openItem && desktop.matches) place(flyoutOf(openItem)); else closeAll();
  });
  function onModeChange(){ closeAll(); syncAria(); }
  if(desktop.addEventListener) desktop.addEventListener('change', onModeChange); else desktop.addListener(onModeChange);
  syncAria();
})();
