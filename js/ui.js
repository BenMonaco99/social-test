/* ui.js — DOM helpers and the reusable pieces of the interface. */
(function (global) {
  'use strict';

  var Store = global.Store;

  /* ---------- tiny DOM helpers ---------- */

  function el(tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else node.setAttribute(k, v === true ? '' : v);
    });
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) {
      children.forEach(function (c) { append(node, c); });
      return node;
    }
    node.appendChild(children.nodeType ? children : document.createTextNode(String(children)));
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function frag(children) { var f = document.createDocumentFragment(); append(f, children); return f; }

  /* ---------- formatting ---------- */

  function relTime(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    var d = Math.floor(h / 24);
    if (d < 7) return d + 'd';
    var date = new Date(ts);
    var same = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, same
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function absTime(ts) {
    return new Date(ts).toLocaleString(undefined, {
      hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  function joinedTime(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function count(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return n ? String(n) : '';
  }

  /* ---------- avatars ---------- */

  var HUES = [8, 32, 145, 200, 262, 320, 96, 178, 350, 48];

  function initials(user) {
    var parts = user.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return user.handle.slice(0, 2).toUpperCase();
  }

  function avatar(user, size) {
    if (user.avatarUrl) {
      var img = el('img', {
        class: 'avatar' + (size ? ' ' + size : ''),
        src: user.avatarUrl, alt: '', title: '@' + user.handle,
        referrerpolicy: 'no-referrer'
      });
      // If the picture fails to load, fall back to the initials tile.
      img.addEventListener('error', function () {
        var stand = avatar({ handle: user.handle, name: user.name }, size);
        if (img.parentNode) img.parentNode.replaceChild(stand, img);
      });
      return img;
    }
    var hue = HUES[Math.abs(global.Seed.hash(user.handle)) % HUES.length];
    return el('div', {
      class: 'avatar' + (size ? ' ' + size : ''),
      style: 'background: linear-gradient(140deg, hsl(' + hue + ' 62% 48%), hsl(' + ((hue + 38) % 360) + ' 58% 38%))',
      title: '@' + user.handle,
      'aria-hidden': 'true'
    }, initials(user));
  }

  /* ---------- text with links ---------- */

  var TOKEN = /(#[\p{L}\p{N}_]{1,40})|(@[A-Za-z0-9_]{1,20})|(https?:\/\/[^\s]+)/gu;

  function linkify(text) {
    var out = document.createDocumentFragment();
    var last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      if (m.index > last) out.appendChild(document.createTextNode(text.slice(last, m.index)));
      var token = m[0];
      if (m[1]) {
        out.appendChild(el('a', { href: '#/tag/' + token.slice(1).toLowerCase(), text: token }));
      } else if (m[2]) {
        var u = Store.userByHandle(token.slice(1));
        out.appendChild(u
          ? el('a', { href: '#/u/' + u.handle, text: token })
          : document.createTextNode(token));
      } else {
        out.appendChild(el('a', { href: token, target: '_blank', rel: 'noopener noreferrer', text: token }));
      }
      last = m.index + token.length;
    }
    if (last < text.length) out.appendChild(document.createTextNode(text.slice(last)));
    return out;
  }

  /* ---------- toasts + modal ---------- */

  function toast(message) {
    var host = document.getElementById('toasts');
    var node = el('div', { class: 'toast', text: message });
    host.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .2s';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 220);
    }, 2200);
  }

  function closeModal() {
    var host = document.getElementById('modal-host');
    host.hidden = true;
    clear(document.getElementById('modal'));
  }

  function openModal(title, body, footer) {
    var host = document.getElementById('modal-host');
    var modal = clear(document.getElementById('modal'));
    append(modal, [
      el('div', { class: 'modal-head' }, [
        el('button', { class: 'icon-btn', onclick: closeModal, 'aria-label': 'Close' }, '✕'),
        el('h2', { text: title })
      ]),
      el('div', { class: 'modal-body' }, body),
      footer ? el('div', { class: 'modal-foot' }, footer) : null
    ]);
    host.hidden = false;
    host.onclick = function (e) { if (e.target === host) closeModal(); };
    var first = modal.querySelector('input, textarea, button.btn-primary');
    if (first) first.focus();
    return modal;
  }

  function confirmDialog(title, message, confirmLabel, onConfirm) {
    openModal(title, el('p', { text: message, style: 'margin:0' }), [
      el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn-danger',
        onclick: function () { closeModal(); onConfirm(); }
      }, confirmLabel)
    ]);
  }

  /* ---------- composer ---------- */

  function composer(opts) {
    opts = opts || {};
    var self = Store.me();
    var area = el('textarea', {
      rows: 1,
      maxlength: String(Store.MAX_LEN + 80),
      placeholder: opts.placeholder || "What's happening?",
      'aria-label': 'Post text'
    });
    var counter = el('span', { class: 'counter', text: String(Store.MAX_LEN) });
    var submit = el('button', { class: 'btn btn-primary btn-sm', disabled: true }, opts.submitLabel || 'Post');

    function sync() {
      area.style.height = 'auto';
      area.style.height = Math.min(area.scrollHeight, 320) + 'px';
      var left = Store.MAX_LEN - area.value.trim().length;
      counter.textContent = String(left);
      counter.className = 'counter' + (left < 0 ? ' over' : left <= 20 ? ' warn' : '');
      submit.disabled = !area.value.trim() || left < 0;
    }

    function send() {
      var res = Store.createPost(area.value, opts.parentId || null);
      if (res.error) return toast(res.error);
      area.value = '';
      sync();
      if (opts.onPost) opts.onPost(res.post);
      toast(opts.parentId ? 'Reply posted' : 'Posted');
    }

    area.addEventListener('input', sync);
    area.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!submit.disabled) send(); }
    });
    submit.addEventListener('click', send);

    var node = el('div', { class: 'composer' + (opts.inline ? ' inline' : '') }, [
      link('#/u/' + self.handle, avatar(self)),
      el('div', { class: 'composer-body' }, [
        area,
        el('div', { class: 'composer-foot' }, [
          el('span', { class: 'composer-hint', text: opts.hint || '⌘/Ctrl + Enter to post' }),
          counter,
          submit
        ])
      ])
    ]);
    node.focusComposer = function () { area.focus(); };
    setTimeout(sync, 0);
    if (opts.autofocus) setTimeout(function () { area.focus(); }, 0);
    return node;
  }

  function link(href, children, cls) {
    return el('a', { href: href, class: cls || '' }, children);
  }

  /* ---------- post card ---------- */

  function stop(fn) {
    return function (e) { e.preventDefault(); e.stopPropagation(); fn(e); };
  }

  function postCard(p, opts) {
    opts = opts || {};
    var author = Store.user(p.authorId);
    var replies = Store.replyCount(p.id);
    var liked = Store.isLiked(p);
    var reposted = Store.isReposted(p);
    var marked = Store.isBookmarked(p.id);

    var head = el('div', { class: 'post-head' }, [
      link('#/u/' + author.handle, el('span', { class: 'name truncate', text: author.name })),
      el('span', { class: 'handle truncate', text: '@' + author.handle }),
      el('span', { class: 'dot', text: '·' }),
      el('a', {
        class: 'time', href: '#/p/' + p.id, title: absTime(p.createdAt),
        dataset: { time: String(p.createdAt) }, text: relTime(p.createdAt)
      }),
      el('button', {
        class: 'icon-btn menu', title: 'More', 'aria-label': 'More actions',
        onclick: stop(function () { postMenu(p); })
      }, '···')
    ]);

    var actions = el('div', { class: 'actions' }, [
      action('reply', '↩', replies, false, function () {
        if (opts.detail) {
          var box = document.getElementById('reply-box');
          if (box && box.focusComposer) return box.focusComposer();
        }
        location.hash = '#/p/' + p.id + '?reply=1';
      }),
      action('repost', '⇄', p.reposts.length, reposted, function () {
        toast(Store.toggleRepost(p.id) ? 'Reposted' : 'Repost removed');
      }),
      action('like', liked ? '♥' : '♡', p.likes.length, liked, function () { Store.toggleLike(p.id); }),
      action('bookmark', marked ? '★' : '☆', 0, marked, function () {
        toast(Store.toggleBookmark(p.id) ? 'Saved to bookmarks' : 'Removed from bookmarks');
      })
    ]);

    var body = el('div', { class: 'post-body' }, [
      head,
      p.parentId && !opts.detail && !opts.hideReplyTo && Store.post(p.parentId) ? el('div', { class: 'reply-to' }, [
        'Replying to ',
        link('#/u/' + Store.user(Store.post(p.parentId).authorId).handle,
          '@' + Store.user(Store.post(p.parentId).authorId).handle)
      ]) : null,
      el('p', { class: 'post-text' + (opts.detail ? ' big' : '') }, linkify(p.text)),
      opts.detail ? null : actions
    ]);

    var card = el('article', {
      class: 'post',
      onclick: function (e) {
        if (e.target.closest('a, button')) return;
        location.hash = '#/p/' + p.id;
      }
    }, [
      el('div', { class: 'post-col' }, [
        link('#/u/' + author.handle, avatar(author)),
        opts.thread === 'continues' ? el('div', { class: 'thread-line' }) : null
      ]),
      body
    ]);

    if (opts.detail) return frag([card, detailFooter(p, actions)]);
    if (opts.reason) return frag([reasonLine(opts.reason), card]);
    return card;
  }

  function detailFooter(p, actions) {
    var plural = function (n, word) { return n === 1 ? word : (word === 'reply' ? 'replies' : word + 's'); };
    var stats = [];
    if (p.reposts.length) stats.push([plural(p.reposts.length, 'repost'), p.reposts.length]);
    if (p.likes.length) stats.push([plural(p.likes.length, 'like'), p.likes.length]);
    var replies = Store.replyCount(p.id);
    if (replies) stats.push([plural(replies, 'reply'), replies]);

    return frag([
      el('div', { class: 'detail-time', text: absTime(p.createdAt) }),
      stats.length ? el('div', { class: 'stat-row' }, stats.map(function (s) {
        return el('div', {}, [el('b', { text: String(s[1]) }), ' ', el('span', { text: s[0] })]);
      })) : null,
      el('div', { class: 'post', style: 'cursor:default;padding-left:14px' },
        el('div', { class: 'post-body' }, actions))
    ]);
  }

  function reasonLine(reason) {
    var u = Store.user(reason.userId);
    if (!u) return null;
    var who = u.id === Store.me().id ? 'You' : u.name;
    return el('div', { class: 'context-line' }, ['⇄ ', who + ' reposted']);
  }

  function action(kind, glyph, n, on, handler) {
    return el('button', {
      class: 'action' + (on ? ' on' : ''),
      dataset: { act: kind },
      title: kind[0].toUpperCase() + kind.slice(1),
      onclick: stop(handler)
    }, [el('span', { text: glyph }), el('span', { text: count(n) })]);
  }

  function postMenu(p) {
    var mine = p.authorId === Store.me().id;
    var author = Store.user(p.authorId);
    var items = [];

    items.push(el('button', {
      onclick: function () {
        closeModal();
        var url = location.origin + location.pathname + '#/p/' + p.id;
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); },
          function () { toast(url); });
        else toast(url);
      }
    }, 'Copy link to post'));

    if (!mine) {
      items.push(el('button', {
        onclick: function () {
          closeModal();
          var on = Store.toggleFollow(author.id);
          toast((on ? 'Following @' : 'Unfollowed @') + author.handle);
        }
      }, (Store.isFollowing(author.id) ? 'Unfollow @' : 'Follow @') + author.handle));
    }

    items.push(el('button', {
      onclick: function () {
        closeModal();
        toast(Store.toggleBookmark(p.id) ? 'Saved to bookmarks' : 'Removed from bookmarks');
      }
    }, Store.isBookmarked(p.id) ? 'Remove bookmark' : 'Bookmark post'));

    if (mine) {
      items.push(el('button', {
        class: 'danger',
        style: 'color:#d33',
        onclick: function () {
          closeModal();
          confirmDialog('Delete post?', 'This removes the post from every timeline. It cannot be undone.',
            'Delete', function () {
              Store.deletePost(p.id);
              toast('Post deleted');
              if (location.hash.indexOf('#/p/' + p.id) === 0) location.hash = '#/home';
            });
        }
      }, 'Delete post'));
    }

    openModal('Post options', el('ul', { class: 'menu-list' }, items.map(function (b) {
      return el('li', {}, b);
    })));
  }

  /* ---------- rows ---------- */

  function userRow(u, opts) {
    opts = opts || {};
    var self = Store.me();
    var isSelf = u.id === self.id;
    var following = Store.isFollowing(u.id);
    return el('div', {
      class: 'card-row',
      style: 'cursor:pointer',
      onclick: function (e) { if (!e.target.closest('button')) location.hash = '#/u/' + u.handle; }
    }, [
      avatar(u, 'sm'),
      el('div', { class: 'grow' }, [
        el('div', { class: 'k truncate', text: u.name }),
        el('div', { class: 'v truncate', text: '@' + u.handle + (opts.showBio && u.bio ? ' · ' + u.bio : '') })
      ]),
      isSelf ? el('span', { class: 'pill', text: 'you' }) : el('button', {
        class: 'btn btn-sm' + (following ? '' : ' btn-primary'),
        onclick: stop(function () {
          var on = Store.toggleFollow(u.id);
          toast((on ? 'Following @' : 'Unfollowed @') + u.handle);
        })
      }, following ? 'Following' : 'Follow')
    ]);
  }

  var NOTIF_GLYPH = { like: '♥', repost: '⇄', reply: '↩', follow: '＋', mention: '@' };

  function notifRow(n, unread) {
    var actor = Store.user(n.actorId);
    if (!actor) return null;
    var p = n.postId ? Store.post(n.postId) : null;
    var verb = {
      like: 'liked your post',
      repost: 'reposted your post',
      reply: 'replied to you',
      follow: 'followed you',
      mention: 'mentioned you'
    }[n.type] || 'did something';

    return el('div', {
      class: 'notif' + (unread ? ' unread' : ''),
      onclick: function (e) {
        if (e.target.closest('a')) return;
        location.hash = p && !p.deleted ? '#/p/' + p.id : '#/u/' + actor.handle;
      }
    }, [
      el('div', { class: 'glyph', text: NOTIF_GLYPH[n.type] || '·' }),
      avatar(actor, 'sm'),
      el('div', { class: 'grow' }, [
        el('div', { class: 'txt' }, [
          link('#/u/' + actor.handle, el('b', { text: actor.name })),
          ' ' + verb,
          el('span', { class: 'handle', style: 'color:var(--text-dim)', text: ' · ' + relTime(n.at) })
        ]),
        p && !p.deleted ? el('div', { class: 'quote truncate', text: p.text }) : null
      ])
    ]);
  }

  function empty(title, body) {
    return el('div', { class: 'empty' }, [
      el('h3', { text: title }),
      el('p', { text: body, style: 'margin:0' })
    ]);
  }

  function sectionLabel(text) { return el('div', { class: 'section-label', text: text }); }

  function tabs(items, active, onPick) {
    return frag(items.map(function (t) {
      return el('button', {
        class: 'tab' + (t.key === active ? ' is-active' : ''),
        onclick: function () { onPick(t.key); }
      }, t.label);
    }));
  }

  global.UI = {
    el: el, append: append, clear: clear, frag: frag, link: link, stop: stop,
    relTime: relTime, absTime: absTime, joinedTime: joinedTime, count: count,
    avatar: avatar, linkify: linkify,
    toast: toast, openModal: openModal, closeModal: closeModal, confirmDialog: confirmDialog,
    composer: composer, postCard: postCard, userRow: userRow, notifRow: notifRow,
    empty: empty, sectionLabel: sectionLabel, tabs: tabs
  };
})(window);
