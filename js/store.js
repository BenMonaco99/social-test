/* store.js — state, persistence, and all mutations for the plaintext app. */
(function (global) {
  'use strict';

  var KEY = 'plaintext.state.v1';
  var MAX_LEN = 280;

  var listeners = [];
  var state = null;
  var saveTimer = null;

  function emit() {
    save();
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        /* storage disabled or full — the app still works for this session */
      }
    }, 80);
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.users || !parsed.posts) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function uid(kind) {
    state.seq[kind] = (state.seq[kind] || 0) + 1;
    return kind + '_' + state.seq[kind];
  }

  /* ---------- lookups ---------- */

  function user(id) { return state.users[id] || null; }
  function post(id) { return state.posts[id] || null; }
  function me() { return state.users[state.session.currentUserId]; }

  function userByHandle(handle) {
    var h = String(handle || '').replace(/^@/, '').toLowerCase();
    var ids = Object.keys(state.users);
    for (var i = 0; i < ids.length; i++) {
      if (state.users[ids[i]].handle.toLowerCase() === h) return state.users[ids[i]];
    }
    return null;
  }

  function allUsers() {
    return Object.keys(state.users).map(user).sort(function (a, b) {
      return a.handle.localeCompare(b.handle);
    });
  }

  function livePosts() {
    return Object.keys(state.posts).map(post).filter(function (p) { return !p.deleted; });
  }

  function byNewest(a, b) { return b.createdAt - a.createdAt; }

  /* ---------- timeline building ---------- */

  // A timeline entry is { post, reason } where reason describes why it surfaced
  // (e.g. a repost by someone you follow).
  function entry(p, reason) { return { post: p, reason: reason || null }; }

  function homeTimeline(scope) {
    var self = me();
    var following = self.following.slice();
    var visible = {};
    following.forEach(function (id) { visible[id] = true; });
    visible[self.id] = true;

    var out = [];
    livePosts().forEach(function (p) {
      if (p.parentId) return; // replies live in threads, not the root feed
      if (scope === 'following' && !visible[p.authorId]) return;
      out.push(entry(p, null));

      // Surface reposts from accounts in scope, at the time of the repost.
      (p.reposts || []).forEach(function (r) {
        if (r.userId === p.authorId) return;
        if (scope === 'following' && !visible[r.userId]) return;
        out.push({ post: p, reason: { type: 'repost', userId: r.userId }, at: r.at });
      });
    });

    // Newest first, then collapse to one entry per post so a widely reposted
    // item does not appear three times in a row.
    out.sort(function (a, b) {
      return (b.at || b.post.createdAt) - (a.at || a.post.createdAt);
    });
    return dedupe(out);
  }

  function dedupe(entries) {
    var seen = {};
    return entries.filter(function (e) {
      if (seen[e.post.id]) return false;
      seen[e.post.id] = true;
      return true;
    });
  }

  function threadOf(id) {
    var root = post(id);
    if (!root) return null;
    var ancestors = [];
    var cur = root;
    while (cur.parentId && state.posts[cur.parentId]) {
      cur = state.posts[cur.parentId];
      ancestors.unshift(cur);
    }
    var replies = livePosts()
      .filter(function (p) { return p.parentId === id; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });
    return { ancestors: ancestors, post: root, replies: replies };
  }

  function postsBy(userId, tab) {
    var mine = livePosts().filter(function (p) { return p.authorId === userId; });
    if (tab === 'replies') return mine.filter(function (p) { return p.parentId; }).sort(byNewest);
    if (tab === 'likes') {
      return livePosts().filter(function (p) {
        return (p.likes || []).indexOf(userId) !== -1;
      }).sort(byNewest);
    }
    var roots = mine.filter(function (p) { return !p.parentId; }).map(function (p) { return entry(p); });
    livePosts().forEach(function (p) {
      (p.reposts || []).forEach(function (r) {
        if (r.userId === userId && p.authorId !== userId) {
          roots.push({ post: p, reason: { type: 'repost', userId: userId }, at: r.at });
        }
      });
    });
    roots.sort(function (a, b) { return (b.at || b.post.createdAt) - (a.at || a.post.createdAt); });
    return dedupe(roots);
  }

  function replyCount(id) {
    return livePosts().filter(function (p) { return p.parentId === id; }).length;
  }

  function bookmarks() {
    var self = me();
    return (self.bookmarks || [])
      .map(post)
      .filter(function (p) { return p && !p.deleted; })
      .sort(byNewest);
  }

  /* ---------- text parsing ---------- */

  var TAG_RE = /#([\p{L}\p{N}_]{1,40})/gu;
  var MENTION_RE = /@([A-Za-z0-9_]{1,20})/g;

  function hashtagsIn(text) {
    var out = [], m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) out.push(m[1].toLowerCase());
    return out;
  }

  function mentionsIn(text) {
    var out = [], m;
    MENTION_RE.lastIndex = 0;
    while ((m = MENTION_RE.exec(text))) {
      var u = userByHandle(m[1]);
      if (u && out.indexOf(u.id) === -1) out.push(u.id);
    }
    return out;
  }

  function trends(limit) {
    var counts = {};
    var cutoff = Date.now() - 1000 * 60 * 60 * 24 * 14;
    livePosts().forEach(function (p) {
      if (p.createdAt < cutoff) return;
      hashtagsIn(p.text).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    return Object.keys(counts)
      .map(function (t) { return { tag: t, count: counts[t] }; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag); })
      .slice(0, limit || 6);
  }

  function suggestions(limit) {
    var self = me();
    return allUsers()
      .filter(function (u) { return u.id !== self.id && self.following.indexOf(u.id) === -1; })
      .map(function (u) { return { user: u, followers: followerCount(u.id) }; })
      .sort(function (a, b) { return b.followers - a.followers; })
      .slice(0, limit || 3);
  }

  function followerCount(userId) {
    return allUsers().filter(function (u) { return u.following.indexOf(userId) !== -1; }).length;
  }

  function followersOf(userId) {
    return allUsers().filter(function (u) { return u.following.indexOf(userId) !== -1; });
  }

  function search(q) {
    var query = String(q || '').trim();
    var lower = query.toLowerCase();
    if (!lower) return { posts: [], users: [], query: query };
    var tag = lower[0] === '#' ? lower.slice(1) : null;

    var posts = livePosts().filter(function (p) {
      if (tag) return hashtagsIn(p.text).indexOf(tag) !== -1;
      return p.text.toLowerCase().indexOf(lower) !== -1;
    }).sort(byNewest);

    var users = tag ? [] : allUsers().filter(function (u) {
      var needle = lower.replace(/^@/, '');
      return u.handle.toLowerCase().indexOf(needle) !== -1 ||
             u.name.toLowerCase().indexOf(needle) !== -1;
    });

    return { posts: posts, users: users, query: query };
  }

  /* ---------- notifications ---------- */

  function notify(targetUserId, type, actorId, postId) {
    if (!targetUserId || targetUserId === actorId) return;
    state.notifications.unshift({
      id: uid('n'), type: type, actorId: actorId,
      userId: targetUserId, postId: postId || null, at: Date.now()
    });
    if (state.notifications.length > 300) state.notifications.length = 300;
  }

  function notificationsFor(userId, filter) {
    return state.notifications.filter(function (n) {
      if (n.userId !== userId) return false;
      if (filter === 'mentions') return n.type === 'mention' || n.type === 'reply';
      return true;
    });
  }

  function unreadCount() {
    var self = me();
    var seen = self.notifsSeenAt || 0;
    return notificationsFor(self.id).filter(function (n) { return n.at > seen; }).length;
  }

  function markNotificationsRead() {
    me().notifsSeenAt = Date.now();
    emit();
  }

  /* ---------- mutations ---------- */

  function createPost(text, parentId) {
    var body = String(text || '').trim();
    if (!body) return { error: 'Write something first.' };
    if (body.length > MAX_LEN) return { error: 'That is ' + (body.length - MAX_LEN) + ' characters too long.' };

    var self = me();
    var p = {
      id: uid('p'),
      authorId: self.id,
      text: body,
      createdAt: Date.now(),
      parentId: parentId || null,
      likes: [],
      reposts: []
    };
    state.posts[p.id] = p;

    if (parentId && state.posts[parentId]) notify(state.posts[parentId].authorId, 'reply', self.id, p.id);
    mentionsIn(body).forEach(function (id) {
      if (parentId && state.posts[parentId] && state.posts[parentId].authorId === id) return;
      notify(id, 'mention', self.id, p.id);
    });

    emit();
    return { post: p };
  }

  function deletePost(id) {
    var p = post(id);
    if (!p || p.authorId !== me().id) return false;
    p.deleted = true;
    emit();
    return true;
  }

  function toggleLike(id) {
    var p = post(id);
    if (!p) return false;
    var selfId = me().id;
    var at = p.likes.indexOf(selfId);
    var liked = at === -1;
    if (liked) { p.likes.push(selfId); notify(p.authorId, 'like', selfId, p.id); }
    else p.likes.splice(at, 1);
    emit();
    return liked;
  }

  function toggleRepost(id) {
    var p = post(id);
    if (!p) return false;
    var selfId = me().id;
    var idx = -1;
    for (var i = 0; i < p.reposts.length; i++) if (p.reposts[i].userId === selfId) idx = i;
    var on = idx === -1;
    if (on) { p.reposts.push({ userId: selfId, at: Date.now() }); notify(p.authorId, 'repost', selfId, p.id); }
    else p.reposts.splice(idx, 1);
    emit();
    return on;
  }

  function toggleBookmark(id) {
    var self = me();
    if (!self.bookmarks) self.bookmarks = [];
    var at = self.bookmarks.indexOf(id);
    var on = at === -1;
    if (on) self.bookmarks.unshift(id); else self.bookmarks.splice(at, 1);
    emit();
    return on;
  }

  function toggleFollow(userId) {
    var self = me();
    if (userId === self.id) return false;
    var at = self.following.indexOf(userId);
    var on = at === -1;
    if (on) { self.following.push(userId); notify(userId, 'follow', self.id, null); }
    else self.following.splice(at, 1);
    emit();
    return on;
  }

  function isLiked(p) { return p.likes.indexOf(state.session.currentUserId) !== -1; }
  function isReposted(p) {
    return p.reposts.some(function (r) { return r.userId === state.session.currentUserId; });
  }
  function isBookmarked(id) { return (me().bookmarks || []).indexOf(id) !== -1; }
  function isFollowing(userId) { return me().following.indexOf(userId) !== -1; }

  function isSignedIn() { return !!state.users[state.session.currentUserId]; }

  function switchUser(userId, provider) {
    if (!state.users[userId]) return false;
    state.session.currentUserId = userId;
    state.session.provider = provider || state.users[userId].provider || 'demo';
    emit();
    return true;
  }

  function signOut() {
    state.session.currentUserId = null;
    state.session.provider = null;
    emit();
  }

  function userByGoogleId(sub) {
    var ids = Object.keys(state.users);
    for (var i = 0; i < ids.length; i++) {
      if (state.users[ids[i]].googleId === sub) return state.users[ids[i]];
    }
    return null;
  }

  function userByEmail(email) {
    var target = String(email || '').toLowerCase();
    if (!target) return null;
    var ids = Object.keys(state.users);
    for (var i = 0; i < ids.length; i++) {
      if ((state.users[ids[i]].email || '').toLowerCase() === target) return state.users[ids[i]];
    }
    return null;
  }

  // Turn an email or display name into a handle nobody else is using.
  function handleFrom(seed) {
    var base = String(seed || '').split('@')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 16).toLowerCase();
    if (!base) base = 'user';
    var candidate = base, n = 1;
    while (userByHandle(candidate)) { n += 1; candidate = (base + n).slice(0, 20); }
    return candidate;
  }

  /**
   * Sign in with a verified-enough Google profile: link to the existing account
   * for that Google id (or email), otherwise create one.
   * Returns { user, created }.
   */
  function signInWithGoogle(profile) {
    if (!profile || !profile.sub) return { error: 'Google did not return an account.' };

    var existing = userByGoogleId(profile.sub) || userByEmail(profile.email);
    if (existing) {
      existing.googleId = profile.sub;
      existing.email = profile.email || existing.email;
      existing.provider = 'google';
      if (profile.picture) existing.avatarUrl = profile.picture;
      switchUser(existing.id, 'google');
      return { user: existing, created: false };
    }

    var u = {
      id: uid('u'),
      handle: handleFrom(profile.email || profile.name),
      name: String(profile.name || '').slice(0, 50) || 'Google user',
      bio: '',
      joinedAt: Date.now(),
      following: [],
      bookmarks: [],
      notifsSeenAt: 0,
      provider: 'google',
      googleId: profile.sub,
      email: profile.email || '',
      avatarUrl: profile.picture || ''
    };
    state.users[u.id] = u;
    state.session.currentUserId = u.id;
    state.session.provider = 'google';
    welcome(u);
    emit();
    return { user: u, created: true };
  }

  // Give a brand new account a timeline and a couple of followers, so the first
  // visit is not an empty room.
  function welcome(u) {
    var others = allUsers().filter(function (o) { return o.id !== u.id && !o.provider; });
    others.slice(0, 4).forEach(function (o) { u.following.push(o.id); });
    others.slice(0, 2).forEach(function (o) {
      if (o.following.indexOf(u.id) === -1) o.following.push(u.id);
      notify(u.id, 'follow', o.id, null);
    });
  }

  function createAccount(name, handle, bio) {
    var clean = String(handle || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
    if (!clean) return { error: 'Pick a handle (letters, numbers, underscore).' };
    if (userByHandle(clean)) return { error: '@' + clean + ' is taken.' };
    var u = {
      id: uid('u'),
      handle: clean,
      name: String(name || '').trim() || clean,
      bio: String(bio || '').trim(),
      joinedAt: Date.now(),
      following: [],
      bookmarks: [],
      notifsSeenAt: 0,
      provider: 'local'
    };
    state.users[u.id] = u;
    state.session.currentUserId = u.id;
    state.session.provider = 'local';
    welcome(u);
    emit();
    return { user: u };
  }

  function updateProfile(fields) {
    var self = me();
    if (fields.handle !== undefined) {
      var clean = String(fields.handle).replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
      if (!clean) return { error: 'Handle cannot be empty.' };
      var taken = userByHandle(clean);
      if (taken && taken.id !== self.id) return { error: '@' + clean + ' is taken.' };
      self.handle = clean;
    }
    if (fields.name !== undefined) self.name = String(fields.name).trim().slice(0, 50) || self.handle;
    if (fields.bio !== undefined) self.bio = String(fields.bio).trim().slice(0, 200);
    emit();
    return { user: self };
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    emit();
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    state = global.Seed.build();
    emit();
  }

  /* ---------- init ---------- */

  function init() {
    var loaded = load();
    state = loaded || global.Seed.build();
    if (!state.settings) state.settings = { theme: 'light', simulate: true };
    if (!state.session) state.session = { currentUserId: null, provider: null };
    // A session pointing at an account that no longer exists is a signed-out session.
    if (!state.users[state.session.currentUserId]) {
      state.session.currentUserId = null;
      state.session.provider = null;
    }
    return state;
  }

  /* ---------- simulated activity (other accounts reacting to you) ---------- */

  function botLike(postId, actorId) {
    var p = post(postId);
    if (!p || p.deleted || !state.users[actorId]) return false;
    if (p.likes.indexOf(actorId) !== -1) return false;
    p.likes.push(actorId);
    notify(p.authorId, 'like', actorId, p.id);
    emit();
    return true;
  }

  function botRepost(postId, actorId) {
    var p = post(postId);
    if (!p || p.deleted || !state.users[actorId]) return false;
    if (p.reposts.some(function (r) { return r.userId === actorId; })) return false;
    p.reposts.push({ userId: actorId, at: Date.now() });
    notify(p.authorId, 'repost', actorId, p.id);
    emit();
    return true;
  }

  function botReply(postId, actorId, text) {
    var parent = post(postId);
    if (!parent || parent.deleted || !state.users[actorId]) return false;
    var r = {
      id: uid('p'), authorId: actorId, text: text, createdAt: Date.now(),
      parentId: postId, likes: [], reposts: []
    };
    state.posts[r.id] = r;
    notify(parent.authorId, 'reply', actorId, r.id);
    emit();
    return r;
  }

  function botFollow(actorId, targetId) {
    var actor = user(actorId);
    if (!actor || actor.following.indexOf(targetId) !== -1) return false;
    actor.following.push(targetId);
    notify(targetId, 'follow', actorId, null);
    emit();
    return true;
  }

  global.Store = {
    MAX_LEN: MAX_LEN,
    init: init,
    subscribe: function (fn) { listeners.push(fn); },
    get state() { return state; },
    get settings() { return state.settings; },
    me: me,
    user: user,
    post: post,
    userByHandle: userByHandle,
    allUsers: allUsers,
    homeTimeline: homeTimeline,
    threadOf: threadOf,
    postsBy: postsBy,
    replyCount: replyCount,
    bookmarks: bookmarks,
    followerCount: followerCount,
    followersOf: followersOf,
    hashtagsIn: hashtagsIn,
    trends: trends,
    suggestions: suggestions,
    search: search,
    notificationsFor: notificationsFor,
    unreadCount: unreadCount,
    markNotificationsRead: markNotificationsRead,
    notify: notify,
    createPost: createPost,
    deletePost: deletePost,
    toggleLike: toggleLike,
    toggleRepost: toggleRepost,
    toggleBookmark: toggleBookmark,
    toggleFollow: toggleFollow,
    isLiked: isLiked,
    isReposted: isReposted,
    isBookmarked: isBookmarked,
    isFollowing: isFollowing,
    isSignedIn: isSignedIn,
    switchUser: switchUser,
    signOut: signOut,
    signInWithGoogle: signInWithGoogle,
    userByGoogleId: userByGoogleId,
    createAccount: createAccount,
    updateProfile: updateProfile,
    setSetting: setSetting,
    emit: emit,
    reset: reset,
    botLike: botLike,
    botRepost: botRepost,
    botReply: botReply,
    botFollow: botFollow
  };
})(window);
