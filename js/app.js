/* app.js — routing, views, and app-level wiring. */
(function (global) {
  'use strict';

  var Store = global.Store;
  var UI = global.UI;
  var el = UI.el, frag = UI.frag, clear = UI.clear, link = UI.link;

  var view = { tab: {} };          // per-route tab selections, keyed by route name
  var current = null;              // last parsed route, for re-rendering on state change

  /* ---------- routing ---------- */

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var parts = raw.split('?');
    var segs = parts[0].split('/').filter(Boolean).map(decodeURIComponent);
    var query = {};
    (parts[1] || '').split('&').filter(Boolean).forEach(function (kv) {
      var pair = kv.split('=');
      query[decodeURIComponent(pair[0])] = decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
    });
    return { name: segs[0] || 'home', args: segs.slice(1), query: query };
  }

  var ROUTES = {
    home: viewHome,
    explore: viewExplore,
    notifications: viewNotifications,
    bookmarks: viewBookmarks,
    search: viewSearch,
    tag: viewTag,
    u: viewProfile,
    p: viewPost,
    settings: viewSettings
  };

  function render(route) {
    if (!Store.isSignedIn()) return showGate();
    hideGate(); // covers a reload that resumes an existing session
    current = route || current || parseHash();
    var host = clear(document.getElementById('view'));
    var sub = clear(document.getElementById('view-sub'));
    var scroll = window.scrollY;

    var fn = ROUTES[current.name] || viewNotFound;
    var result = fn(current, sub) || UI.empty('Nothing here', 'This page came up empty.');
    document.getElementById('view-title').textContent = result.title || 'Home';
    UI.append(host, result.body);

    renderRail();
    renderSidebar();
    if (route) window.scrollTo(0, 0); else window.scrollTo(0, scroll);
    document.getElementById('rail').classList.remove('open');
    document.getElementById('scrim').hidden = true;
  }

  function go() { render(parseHash()); }

  /* ---------- views ---------- */

  function timeline(entries, emptyNode) {
    if (!entries.length) return emptyNode;
    return frag(entries.map(function (e) {
      var p = e.post || e;
      return UI.postCard(p, { reason: e.reason || null });
    }));
  }

  function viewHome(route, sub) {
    var tab = view.tab.home || 'following';
    UI.append(sub, UI.tabs(
      [{ key: 'following', label: 'Following' }, { key: 'all', label: 'Everything' }],
      tab,
      function (k) { view.tab.home = k; render(); }
    ));

    var entries = Store.homeTimeline(tab);
    return {
      title: 'Home',
      body: frag([
        UI.composer({ onPost: afterPost }),
        timeline(entries, tab === 'following'
          ? UI.empty('Your timeline is quiet', 'Follow a few accounts — or switch to Everything — to fill it up.')
          : UI.empty('No posts yet', 'Write the first one.'))
      ])
    };
  }

  function viewExplore() {
    var trending = Store.trends(8);
    var posts = Store.homeTimeline('all').filter(function (e) { return !e.reason; });
    var top = posts.slice().sort(function (a, b) {
      return engagement(b.post) - engagement(a.post);
    }).slice(0, 12);

    return {
      title: 'Explore',
      body: frag([
        trending.length ? frag([
          UI.sectionLabel('Trending tags'),
          frag(trending.map(function (t, i) {
            return el('div', {
              class: 'card-row', style: 'cursor:pointer;border-bottom:1px solid var(--line)',
              onclick: function () { location.hash = '#/tag/' + t.tag; }
            }, [
              el('div', { class: 'grow' }, [
                el('div', { class: 'k', text: '#' + t.tag }),
                el('div', { class: 'v', text: t.count + (t.count === 1 ? ' post' : ' posts') })
              ]),
              el('span', { class: 'pill', text: '#' + (i + 1) })
            ]);
          }))
        ]) : null,
        UI.sectionLabel('Most engaged'),
        timeline(top, UI.empty('Nothing to explore', 'Post something and it will show up here.'))
      ])
    };
  }

  function engagement(p) {
    return p.likes.length * 2 + p.reposts.length * 3 + Store.replyCount(p.id) * 2;
  }

  function viewNotifications(route, sub) {
    var tab = view.tab.notifications || 'all';
    UI.append(sub, UI.tabs(
      [{ key: 'all', label: 'All' }, { key: 'mentions', label: 'Mentions & replies' }],
      tab,
      function (k) { view.tab.notifications = k; render(); }
    ));

    var self = Store.me();
    var seen = self.notifsSeenAt || 0;
    var items = Store.notificationsFor(self.id, tab);
    var rows = items.map(function (n) { return UI.notifRow(n, n.at > seen); }).filter(Boolean);

    // Mark read after painting so the unread highlight is visible once.
    setTimeout(function () {
      if (Store.unreadCount()) { Store.markNotificationsRead(); renderRail(); }
    }, 1200);

    return {
      title: 'Notifications',
      body: rows.length ? frag(rows)
        : UI.empty('No notifications yet', 'Likes, replies, reposts and follows land here.')
    };
  }

  function viewBookmarks() {
    var items = Store.bookmarks();
    return {
      title: 'Bookmarks',
      body: items.length ? frag(items.map(function (p) { return UI.postCard(p, {}); }))
        : UI.empty('No bookmarks', 'Tap ☆ on any post to save it for later.')
    };
  }

  function viewSearch(route, sub) {
    var q = route.query.q || '';
    var res = Store.search(q);
    var tab = view.tab.search || 'posts';
    UI.append(sub, UI.tabs(
      [{ key: 'posts', label: 'Posts (' + res.posts.length + ')' },
       { key: 'people', label: 'People (' + res.users.length + ')' }],
      tab,
      function (k) { view.tab.search = k; render(); }
    ));
    document.getElementById('search-input').value = q;

    var body;
    if (!q) body = UI.empty('Search plaintext', 'Try a word, a #tag, or an @handle.');
    else if (tab === 'people') {
      body = res.users.length
        ? frag(res.users.map(function (u) { return UI.userRow(u, { showBio: true }); }))
        : UI.empty('No people found', 'Nobody matches “' + q + '”.');
    } else {
      body = res.posts.length
        ? frag(res.posts.map(function (p) { return UI.postCard(p, {}); }))
        : UI.empty('No posts found', 'Nothing matches “' + q + '” yet.');
    }
    return { title: 'Search: ' + (q || '…'), body: body };
  }

  function viewTag(route) {
    var tag = (route.args[0] || '').toLowerCase();
    var res = Store.search('#' + tag);
    return {
      title: '#' + tag,
      body: frag([
        UI.sectionLabel(res.posts.length + (res.posts.length === 1 ? ' post' : ' posts') + ' tagged #' + tag),
        res.posts.length
          ? frag(res.posts.map(function (p) { return UI.postCard(p, {}); }))
          : UI.empty('No posts with #' + tag, 'Use the tag in a post to start it off.')
      ])
    };
  }

  function viewProfile(route, sub) {
    var u = Store.userByHandle(route.args[0]);
    if (!u) return { title: 'Not found', body: UI.empty('No such account', '@' + route.args[0] + ' does not exist here.') };

    var key = 'profile:' + u.id;
    var tab = view.tab[key] || 'posts';
    UI.append(sub, UI.tabs(
      [{ key: 'posts', label: 'Posts' }, { key: 'replies', label: 'Replies' }, { key: 'likes', label: 'Likes' }],
      tab,
      function (k) { view.tab[key] = k; render(); }
    ));

    var self = Store.me();
    var isSelf = u.id === self.id;
    var following = Store.isFollowing(u.id);
    var followers = Store.followerCount(u.id);

    var actionBtn = isSelf
      ? el('button', { class: 'btn', onclick: editProfileModal }, 'Edit profile')
      : el('button', {
          class: 'btn' + (following ? '' : ' btn-primary'),
          onclick: function () {
            var on = Store.toggleFollow(u.id);
            UI.toast((on ? 'Following @' : 'Unfollowed @') + u.handle);
          }
        }, following ? 'Following' : 'Follow');

    var head = el('div', { class: 'profile-head' }, [
      el('div', { class: 'profile-top' }, [
        UI.avatar(u, 'lg'),
        el('div', { style: 'min-width:0' }, [
          el('h2', { class: 'profile-name', text: u.name }),
          el('div', { class: 'profile-handle' }, [
            '@' + u.handle,
            !isSelf && u.following.indexOf(self.id) !== -1
              ? el('span', { class: 'pill', style: 'margin-left:8px', text: 'follows you' })
              : null
          ])
        ]),
        actionBtn
      ]),
      u.bio ? el('p', { class: 'profile-bio' }, UI.linkify(u.bio)) : null,
      el('div', { class: 'profile-meta' }, [
        el('span', {}, 'Joined ' + UI.joinedTime(u.joinedAt)),
        el('a', { href: '#/u/' + u.handle, style: 'color:inherit', onclick: function (e) { e.preventDefault(); listModal('Following', u.following.map(Store.user)); } },
          [el('b', { text: String(u.following.length) }), ' following']),
        el('a', { href: '#/u/' + u.handle, style: 'color:inherit', onclick: function (e) { e.preventDefault(); listModal('Followers', Store.followersOf(u.id)); } },
          [el('b', { text: String(followers) }), followers === 1 ? ' follower' : ' followers'])
      ])
    ]);

    var items = Store.postsBy(u.id, tab);
    var emptyMsg = {
      posts: ['No posts yet', isSelf ? 'Your posts will show up here.' : '@' + u.handle + ' has not posted.'],
      replies: ['No replies yet', 'Replies to other people appear here.'],
      likes: ['No likes yet', 'Liked posts collect here.']
    }[tab];

    return {
      title: u.name,
      body: frag([head, timeline(items, UI.empty(emptyMsg[0], emptyMsg[1]))])
    };
  }

  function viewPost(route) {
    var thread = Store.threadOf(route.args[0]);
    if (!thread || thread.post.deleted) {
      return { title: 'Post', body: UI.empty('Post not available', 'It was deleted, or the link is wrong.') };
    }
    var p = thread.post;
    var wantsReply = route.query.reply === '1';

    var replyBox = UI.composer({
      parentId: p.id,
      inline: true,
      placeholder: 'Post your reply',
      submitLabel: 'Reply',
      autofocus: wantsReply,
      onPost: afterPost
    });
    replyBox.id = 'reply-box';

    return {
      title: 'Post',
      body: frag([
        frag(thread.ancestors.map(function (a) { return UI.postCard(a, { thread: 'continues' }); })),
        UI.postCard(p, { detail: true }),
        replyBox,
        thread.replies.length ? frag(thread.replies.map(function (r) { return UI.postCard(r, { hideReplyTo: true }); })) : null
      ])
    };
  }

  function viewSettings() {
    var s = Store.settings;
    var row = function (title, desc, control) {
      return el('div', { class: 'card-row', style: 'border-bottom:1px solid var(--line);align-items:flex-start;padding:14px' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'k', text: title }),
          el('div', { class: 'v', style: 'white-space:normal', text: desc })
        ]),
        control
      ]);
    };

    return {
      title: 'Settings',
      body: frag([
        UI.sectionLabel('Appearance'),
        row('Theme', 'Light or dark. Saved with the rest of your session.',
          el('button', {
            class: 'btn btn-sm',
            onclick: function () { setTheme(s.theme === 'dark' ? 'light' : 'dark'); render(); }
          }, s.theme === 'dark' ? 'Dark' : 'Light')),
        UI.sectionLabel('Activity'),
        row('Simulated replies', 'Other accounts occasionally like or reply to your posts, so notifications have something to show.',
          el('button', {
            class: 'btn btn-sm',
            onclick: function () { Store.setSetting('simulate', !s.simulate); render(); }
          }, s.simulate ? 'On' : 'Off')),
        UI.sectionLabel('Account'),
        row('Signed in',
          Store.me().email
            ? Store.me().email + (Store.me().provider === 'google' ? ' · Google account' : '')
            : '@' + Store.me().handle + ' · demo account, no email attached',
          el('button', { class: 'btn btn-sm btn-danger', onclick: signOut }, 'Sign out')),
        row('Google sign-in',
          global.Auth.isConfigured()
            ? 'Client ID ending ' + global.Auth.configuredClientId().slice(-14) + ' is in use for this browser.'
            : 'Not configured. Add a Google OAuth client ID to enable the Google button on the sign-in screen.',
          el('button', { class: 'btn btn-sm', onclick: clientIdModal },
            global.Auth.isConfigured() ? 'Change' : 'Configure')),
        row('Switch account', 'Sign in as one of the seeded accounts to see the app from another side.',
          el('button', { class: 'btn btn-sm', onclick: accountModal }, 'Switch')),
        row('Create account', 'Add a new account to this browser.',
          el('button', { class: 'btn btn-sm', onclick: newAccountModal }, 'Create')),
        UI.sectionLabel('Data'),
        row('Stored locally', 'Everything lives in this browser via localStorage. Nothing is sent anywhere.',
          el('button', {
            class: 'btn btn-sm',
            onclick: function () { exportData(); }
          }, 'Export JSON')),
        row('Reset', 'Wipe your posts and restore the original seeded world.',
          el('button', {
            class: 'btn btn-sm btn-danger',
            onclick: function () {
              UI.confirmDialog('Reset everything?', 'All posts, likes and accounts you created in this browser are removed.',
                'Reset', function () { Store.reset(); location.hash = '#/home'; UI.toast('Reset to the seeded world'); });
            }
          }, 'Reset'))
      ])
    };
  }

  function viewNotFound() {
    return { title: 'Not found', body: UI.empty('Nothing here', 'That link does not point at anything.') };
  }

  /* ---------- chrome: rail + sidebar ---------- */

  var NAV = [
    ['home', '⌂', 'Home'],
    ['explore', '⌗', 'Explore'],
    ['notifications', '◉', 'Notifications'],
    ['bookmarks', '☆', 'Bookmarks'],
    ['settings', '⚙', 'Settings']
  ];

  function renderRail() {
    var nav = clear(document.getElementById('nav'));
    var unread = Store.unreadCount();
    var self = Store.me();

    NAV.forEach(function (item) {
      var active = current && current.name === item[0];
      nav.appendChild(el('li', {}, el('a', {
        href: '#/' + item[0],
        class: active ? 'is-active' : ''
      }, [
        el('span', { class: 'glyph', text: item[1] }),
        el('span', { text: item[2] }),
        item[0] === 'notifications' && unread ? el('span', { class: 'badge', text: String(unread) }) : null
      ])));
    });

    nav.appendChild(el('li', {}, el('a', {
      href: '#/u/' + self.handle,
      class: current && current.name === 'u' && current.args[0] === self.handle ? 'is-active' : ''
    }, [el('span', { class: 'glyph', text: '☻' }), el('span', { text: 'Profile' })])));

    var chip = clear(document.getElementById('account-chip'));
    UI.append(chip, [
      UI.avatar(self, 'sm'),
      el('div', { class: 'meta grow', style: 'min-width:0' }, [
        el('div', { class: 'nm truncate', text: self.name }),
        el('div', { class: 'hd truncate', text: '@' + self.handle })
      ]),
      el('span', { style: 'color:var(--text-dim)', text: '⇅' })
    ]);
  }

  function renderSidebar() {
    var trendsCard = clear(document.getElementById('trends'));
    var trends = Store.trends(5);
    UI.append(trendsCard, [
      el('h2', { text: 'Trending' }),
      trends.length ? frag(trends.map(function (t) {
        return el('div', {
          class: 'card-row', style: 'cursor:pointer',
          onclick: function () { location.hash = '#/tag/' + t.tag; }
        }, el('div', { class: 'grow' }, [
          el('div', { class: 'k', text: '#' + t.tag }),
          el('div', { class: 'v', text: t.count + (t.count === 1 ? ' post' : ' posts') })
        ]));
      })) : el('div', { class: 'card-row' }, el('span', { class: 'v', text: 'No tags yet — try #plaintext' }))
    ]);

    var sugg = clear(document.getElementById('suggestions'));
    var people = Store.suggestions(3);
    UI.append(sugg, [
      el('h2', { text: 'Who to follow' }),
      people.length ? frag(people.map(function (s) { return UI.userRow(s.user); }))
        : el('div', { class: 'card-row' }, el('span', { class: 'v', text: 'You follow everyone here.' }))
    ]);

    var about = clear(document.getElementById('about'));
    UI.append(about, [
      el('div', {}, ['Shortcuts: ', el('kbd', { text: 'n' }), ' new post · ',
        el('kbd', { text: '/' }), ' search · ', el('kbd', { text: 'g' }), ' then ',
        el('kbd', { text: 'h' }), ' home']),
      el('div', { style: 'margin-top:8px' }, 'Everything is stored in this browser only.')
    ]);
  }

  /* ---------- modals ---------- */

  function accountModal() {
    var users = Store.allUsers();
    var me = Store.me();
    UI.openModal('Switch account', el('ul', { class: 'menu-list' }, users.map(function (u) {
      return el('li', {}, el('button', {
        onclick: function () {
          Store.switchUser(u.id);
          UI.closeModal();
          UI.toast('Signed in as @' + u.handle);
          location.hash = '#/home';
          render(parseHash());
        }
      }, el('span', { style: 'display:flex;align-items:center;gap:10px' }, [
        UI.avatar(u, 'sm'),
        el('span', {}, [
          el('div', { style: 'font-weight:600' }, u.name),
          el('div', { style: 'color:var(--text-dim);font-size:12px' }, '@' + u.handle)
        ]),
        u.id === me.id ? el('span', { class: 'pill', style: 'margin-left:auto', text: 'current' }) : null
      ])));
    })), [
      el('button', { class: 'btn', onclick: function () { UI.closeModal(); newAccountModal(); } }, 'Create new account'),
      el('button', { class: 'btn btn-danger', onclick: function () { UI.closeModal(); signOut(); } }, 'Sign out')
    ]);
  }

  function newAccountModal() {
    var name = el('input', { placeholder: 'Ada Lovelace', maxlength: '50' });
    var handle = el('input', { placeholder: 'ada', maxlength: '20' });
    var bio = el('textarea', { rows: '3', placeholder: 'Optional bio', maxlength: '200' });
    UI.openModal('Create account', [
      el('div', { class: 'field' }, [el('label', { text: 'Display name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Handle' }), handle]),
      el('div', { class: 'field' }, [el('label', { text: 'Bio' }), bio])
    ], [
      el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          var res = Store.createAccount(name.value, handle.value, bio.value);
          if (res.error) return UI.toast(res.error);
          UI.closeModal();
          hideGate();
          UI.toast('Signed in as @' + res.user.handle);
          location.hash = '#/home';
          render(parseHash());
        }
      }, 'Create')
    ]);
  }

  function editProfileModal() {
    var self = Store.me();
    var name = el('input', { value: self.name, maxlength: '50' });
    var handle = el('input', { value: self.handle, maxlength: '20' });
    var bio = el('textarea', { rows: '3', maxlength: '200' });
    bio.value = self.bio || '';
    UI.openModal('Edit profile', [
      el('div', { class: 'field' }, [el('label', { text: 'Display name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Handle' }), handle]),
      el('div', { class: 'field' }, [el('label', { text: 'Bio' }), bio])
    ], [
      el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          var res = Store.updateProfile({ name: name.value, handle: handle.value, bio: bio.value });
          if (res.error) return UI.toast(res.error);
          UI.closeModal();
          UI.toast('Profile updated');
          location.hash = '#/u/' + res.user.handle;
          render(parseHash());
        }
      }, 'Save')
    ]);
  }

  function listModal(title, users) {
    UI.openModal(title, users.length
      ? el('div', {}, users.filter(Boolean).map(function (u) { return UI.userRow(u, { showBio: true }); }))
      : el('p', { text: 'Nobody yet.', style: 'margin:0;color:var(--text-dim)' }));
  }

  function exportData() {
    var data = JSON.stringify(Store.state, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(data).then(
        function () { UI.toast('Session JSON copied to clipboard'); },
        function () { UI.toast('Could not copy — check the console'); }
      );
    }
    console.log(data);
  }

  /* ---------- simulated activity ---------- */

  var CANNED = [
    'this is a good point and I resent it slightly',
    'saving this for the next time someone argues with me about it',
    'ok but have you considered doing it the wrong way, faster',
    'strongly agree, which is rare for me before noon',
    'I have opened three tabs because of this post',
    'putting this in the team channel with no context'
  ];

  function afterPost(p) {
    render(parseHash());
    if (!Store.settings.simulate || p.parentId) return;
    var others = Store.allUsers().filter(function (u) { return u.id !== p.authorId; });
    if (!others.length) return;
    shuffle(others).slice(0, 1 + Math.floor(Math.random() * 3)).forEach(function (u, i) {
      setTimeout(function () {
        if (!Store.post(p.id) || Store.post(p.id).deleted) return;
        Store.botLike(p.id, u.id);
      }, 2500 + i * 2600 + Math.random() * 2500);
    });
    if (Math.random() < 0.55) {
      var replier = shuffle(others)[0];
      setTimeout(function () {
        if (!Store.post(p.id) || Store.post(p.id).deleted) return;
        Store.botReply(p.id, replier.id, CANNED[Math.floor(Math.random() * CANNED.length)]);
        UI.toast('@' + replier.handle + ' replied');
      }, 6000 + Math.random() * 6000);
    }
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- theme ---------- */

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Store.setSetting('theme', theme);
  }

  /* ---------- keyboard ---------- */

  var pendingG = false;

  function onKey(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    if (e.key === 'Escape') { UI.closeModal(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (pendingG) {
      pendingG = false;
      var dest = { h: '#/home', e: '#/explore', n: '#/notifications', b: '#/bookmarks', p: '#/u/' + Store.me().handle }[e.key];
      if (dest) { e.preventDefault(); location.hash = dest; return; }
    }
    if (e.key === 'g') { pendingG = true; setTimeout(function () { pendingG = false; }, 1200); return; }
    if (e.key === 'n') { e.preventDefault(); composeModal(); return; }
    if (e.key === '/') { e.preventDefault(); document.getElementById('search-input').focus(); return; }
    if (e.key === 't') { e.preventDefault(); setTheme(Store.settings.theme === 'dark' ? 'light' : 'dark'); }
  }

  function composeModal() {
    var box = UI.composer({
      autofocus: true,
      onPost: function (p) { UI.closeModal(); afterPost(p); }
    });
    box.style.borderBottom = '0';
    UI.openModal('New post', box);
  }

  /* ---------- sign-in gate ---------- */

  function showGate() {
    document.getElementById('app').hidden = true;
    var gate = document.getElementById('gate');
    gate.hidden = false;
    document.title = 'Sign in · plaintext';
    mountGoogleButton();
  }

  function hideGate() {
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    document.title = 'plaintext';
  }

  function gateError(message) {
    var slot = document.getElementById('google-note');
    slot.hidden = false;
    clear(slot);
    UI.append(slot, el('span', { class: 'gate-error', text: message }));
  }

  function gateNote(children) {
    var slot = document.getElementById('google-note');
    slot.hidden = false;
    clear(slot);
    UI.append(slot, children);
  }

  function mountGoogleButton() {
    var slot = clear(document.getElementById('google-button'));
    var note = document.getElementById('google-note');
    note.hidden = true;
    clear(note);

    if (!global.Auth.isConfigured()) return offerClientIdSetup();

    global.Auth.renderButton(slot, {
      theme: Store.settings.theme,
      onSuccess: onGoogleProfile,
      onError: gateError
    }).catch(function (err) {
      gateNote([
        el('div', { text: err.message }),
        el('div', { style: 'margin-top:6px' }, [
          'You can still ',
          el('button', { class: 'linkish', onclick: demoPicker }, 'use a demo account'),
          '.'
        ])
      ]);
    });
  }

  function offerClientIdSetup() {
    gateNote([
      el('div', {}, [
        el('b', { text: 'Google sign-in is not configured yet.' }),
        ' Add a Google OAuth client ID for this origin (',
        el('code', { text: location.origin }), ') and it will appear here.'
      ]),
      global.Auth.fileProtocol()
        ? el('div', { style: 'margin-top:6px' }, 'Google rejects file:// pages — serve the app over http first, e.g. python3 -m http.server 8000.')
        : null,
      el('div', { style: 'margin-top:8px' }, [
        el('button', { class: 'linkish', onclick: clientIdModal }, 'Enter a client ID'),
        ' · ',
        el('a', {
          href: 'https://console.cloud.google.com/apis/credentials',
          target: '_blank', rel: 'noopener noreferrer'
        }, 'Get one from Google')
      ])
    ]);
  }

  function clientIdModal() {
    var input = el('input', {
      placeholder: '1234567890-abc123.apps.googleusercontent.com',
      value: global.Auth.configuredClientId()
    });
    UI.openModal('Google client ID', [
      el('p', { style: 'margin:0;color:var(--text-dim);font-size:13px' },
        'Create an OAuth 2.0 Web application client in Google Cloud, add ' +
        location.origin + ' as an authorized JavaScript origin, then paste the client ID here. ' +
        'It is stored in this browser only.'),
      el('div', { class: 'field' }, [el('label', { text: 'Client ID' }), input])
    ], [
      el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          global.Auth.setClientId(input.value);
          UI.closeModal();
          UI.toast(input.value.trim() ? 'Client ID saved' : 'Client ID cleared');
          if (Store.isSignedIn()) render(parseHash()); else mountGoogleButton();
        }
      }, 'Save')
    ]);
  }

  function onGoogleProfile(profile) {
    var res = Store.signInWithGoogle(profile);
    if (res.error) return gateError(res.error);
    hideGate();
    location.hash = '#/home';
    render(parseHash());
    UI.toast(res.created ? 'Welcome, ' + res.user.name : 'Signed in as @' + res.user.handle);
  }

  function demoPicker() {
    var users = Store.allUsers();
    UI.openModal('Choose a demo account', el('ul', { class: 'menu-list' }, users.map(function (u) {
      return el('li', {}, el('button', {
        onclick: function () {
          Store.switchUser(u.id, u.provider || 'demo');
          UI.closeModal();
          hideGate();
          location.hash = '#/home';
          render(parseHash());
          UI.toast('Signed in as @' + u.handle);
        }
      }, el('span', { style: 'display:flex;align-items:center;gap:10px' }, [
        UI.avatar(u, 'sm'),
        el('span', {}, [
          el('div', { style: 'font-weight:600' }, u.name),
          el('div', { style: 'color:var(--text-dim);font-size:12px' }, '@' + u.handle)
        ])
      ])));
    })));
  }

  function signOut() {
    UI.confirmDialog('Sign out?', 'Your posts stay in this browser — you can sign back in any time.',
      'Sign out', function () {
        global.Auth.signOut();
        Store.signOut();
        showGate();
        UI.toast('Signed out');
      });
  }

  /* ---------- boot ---------- */

  function boot() {
    Store.init();
    setTheme(Store.settings.theme || 'light');

    Store.subscribe(function () { render(); });

    window.addEventListener('hashchange', go);
    document.addEventListener('keydown', onKey);

    document.getElementById('gate-demo').addEventListener('click', demoPicker);
    document.getElementById('gate-create').addEventListener('click', newAccountModal);
    document.getElementById('nav-compose').addEventListener('click', composeModal);
    document.getElementById('account-chip').addEventListener('click', accountModal);
    document.getElementById('theme-btn').addEventListener('click', function () {
      setTheme(Store.settings.theme === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('menu-btn').addEventListener('click', function () {
      document.getElementById('rail').classList.add('open');
      document.getElementById('scrim').hidden = false;
    });
    document.getElementById('scrim').addEventListener('click', function () {
      document.getElementById('rail').classList.remove('open');
      document.getElementById('scrim').hidden = true;
    });
    document.getElementById('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = document.getElementById('search-input').value.trim();
      location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/explore';
    });

    // Keep relative timestamps honest without re-rendering the whole view.
    setInterval(function () {
      var nodes = document.querySelectorAll('[data-time]');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].textContent = UI.relTime(Number(nodes[i].dataset.time));
      }
    }, 30000);

    if (!Store.isSignedIn()) { showGate(); return; }
    if (!location.hash) location.hash = '#/home';
    go();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
