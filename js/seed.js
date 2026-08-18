/* seed.js — the starting world: accounts, posts, threads, and a little history. */
(function (global) {
  'use strict';

  var MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  var PEOPLE = [
    ['you',     'You',            'Reading the timeline instead of doing the thing I said I would do.'],
    ['mira',    'Mira Okonkwo',   'Compiler person. I make small languages and large mistakes. #plaintext'],
    ['dev_ola', 'Ola Fitzgerald', 'Backend. Coffee. Postgres apologist.'],
    ['tarek',   'Tarek Aziz',     'Building a text editor nobody asked for. Ship it anyway.'],
    ['juno',    'Juno Park',      'Design systems, typography, and being wrong about fonts in public.'],
    ['bex',     'Bex Marlowe',    'Sysadmin. If it is down, I am already awake.'],
    ['nilsson', 'Ada Nilsson',    'Distributed systems. Consensus is hard, disagreement is easy.'],
    ['grep',    'grep enjoyer',   'One-liners only. Occasionally two.']
  ];

  // [handle, minutes-ago, text, [likers], [reposters], replyToIndex]
  var POSTS = [
    ['mira',    5,    'shipped a change that deletes 400 lines and adds 12. best kind of pull request. #plaintext', ['dev_ola','tarek','juno','bex'], ['tarek'], null],
    ['dev_ola', 22,   'reminder that a database index is not a personality, but it is close', ['mira','grep','nilsson'], [], null],
    ['tarek',   41,   'spent the morning making the cursor blink at exactly the right interval. productivity is a lie i tell myself. #textui', ['juno','mira'], [], null],
    ['juno',    58,   'a good interface is mostly restraint. every control you add is a decision you are handing to someone who did not ask for it. #design', ['mira','tarek','bex','nilsson','grep'], ['mira','bex'], null],
    ['bex',     95,   'pager went off at 3am for a disk that filled up with logs about the disk filling up', ['dev_ola','grep','mira'], ['grep'], null],
    ['nilsson', 140,  'consensus protocols are just group chats with stricter rules', ['mira','juno','grep'], ['dev_ola'], null],
    ['grep',    170,  'awk is the most underrated programming language and I will not be taking questions #plaintext', ['bex','dev_ola'], [], null],
    ['mira',    210,  'unpopular take: most "performance problems" are three unnecessary round trips wearing a trench coat', ['dev_ola','nilsson','bex','tarek'], ['nilsson'], null],
    ['juno',    280,  'monospace is not a personality either. it is better than that. #textui', ['tarek','grep','mira'], [], null],
    ['dev_ola', 6*60, 'wrote the migration. tested the migration. the migration ran. I am suspicious.', ['bex','mira'], [], null],
    ['tarek',   9*60, 'if your editor cannot open a 2GB log file, it is a text viewer with opinions', ['grep','bex','nilsson'], [], null],
    ['nilsson', 13*60,'"eventually consistent" is a promise about the future, not an excuse about the present #distsys', ['mira','juno','dev_ola','grep'], ['juno'], null],
    ['bex',     20*60,'backups you have never restored are just files with good intentions', ['dev_ola','mira','nilsson','tarek','juno','grep'], ['dev_ola','mira'], null],
    ['juno',    28*60,'redesigned the settings screen by deleting two thirds of it. nobody has noticed. that is the review. #design', ['mira','bex'], [], null],
    ['mira',    2*24*60, 'a parser is a program that turns your confidence into a stack trace', ['tarek','juno','grep','dev_ola'], ['grep'], null],
    ['grep',    3*24*60, 'sed -i is a time machine that only goes one direction', ['bex','mira','tarek'], [], null]
  ];

  // Replies keyed by the text prefix of the post they answer.
  var REPLIES = [
    ['dev_ola', 3,  'the 12 lines better have a comment', 'shipped a change that deletes', ['mira']],
    ['mira',    2,  'they have a test, which is a comment that complains', 'shipped a change that deletes', ['dev_ola','tarek','juno']],
    ['tarek',   40, 'this is the nicest thing anyone has said about restraint since I stopped adding toolbars', 'a good interface is mostly restraint', ['juno']],
    ['grep',    88, 'logrotate, my beloved', 'pager went off at 3am', ['bex','dev_ola']],
    ['nilsson', 120,'the trench coat is usually an ORM', 'unpopular take: most "performance problems"', ['mira','dev_ola','grep']],
    ['juno',    12*60, 'restoring a backup once a quarter is cheaper than one bad tuesday', 'backups you have never restored', ['bex']]
  ];

  var SEED_NOTIFS = [
    ['mira', 'follow', 30],
    ['juno', 'follow', 90],
    ['grep', 'follow', 5*60]
  ];

  function build() {
    var now = Date.now();
    var state = {
      users: {},
      posts: {},
      notifications: [],
      session: { currentUserId: null },
      settings: { theme: 'light', simulate: true },
      seq: { u: 0, p: 0, n: 0 }
    };
    var byHandle = {};

    PEOPLE.forEach(function (row, i) {
      var id = 'u_' + (i + 1);
      state.users[id] = {
        id: id,
        handle: row[0],
        name: row[1],
        bio: row[2],
        joinedAt: now - (400 - i * 27) * DAY,
        following: [],
        bookmarks: [],
        notifsSeenAt: now - 12 * HOUR
      };
      byHandle[row[0]] = id;
    });
    state.seq.u = PEOPLE.length;
    state.session.currentUserId = byHandle.you;

    // Everyone follows most other people; "you" starts with a smaller circle.
    Object.keys(state.users).forEach(function (id) {
      Object.keys(state.users).forEach(function (other) {
        if (id === other) return;
        if (id === byHandle.you) return;
        if (Math.abs(hash(id + other)) % 10 < 7) state.users[id].following.push(other);
      });
    });
    state.users[byHandle.you].following = [byHandle.mira, byHandle.juno, byHandle.grep];

    var index = {};
    function add(handle, minutesAgo, text, likers, reposters, parentId) {
      state.seq.p += 1;
      var id = 'p_' + state.seq.p;
      state.posts[id] = {
        id: id,
        authorId: byHandle[handle],
        text: text,
        createdAt: now - minutesAgo * MIN,
        parentId: parentId || null,
        likes: (likers || []).map(function (h) { return byHandle[h]; }),
        reposts: (reposters || []).map(function (h, i) {
          return { userId: byHandle[h], at: now - (minutesAgo - 1 - i) * MIN };
        })
      };
      index[text] = id;
      return id;
    }

    POSTS.forEach(function (r) { add(r[0], r[1], r[2], r[3], r[4], null); });

    REPLIES.forEach(function (r) {
      var parent = null;
      Object.keys(index).forEach(function (k) {
        if (k.indexOf(r[3]) === 0) parent = index[k];
      });
      if (parent) add(r[0], r[1], r[2], r[4], [], parent);
    });

    // A couple of likes/replies aimed at the default account so the
    // notifications tab has something real in it from the start.
    var mine = add('you', 4 * 60, 'first post. testing whether this thing actually works. #plaintext',
      ['mira', 'juno', 'grep', 'tarek'], ['mira'], null);
    add('mira', 3 * 60 + 40, 'it works. welcome aboard.', ['you'], [], mine);

    state.posts[mine].likes.forEach(function (uidLike) {
      state.notifications.push(mknotif(state, 'like', uidLike, byHandle.you, mine, now - (3 * HOUR + 20 * MIN)));
    });
    state.notifications.push(mknotif(state, 'repost', byHandle.mira, byHandle.you, mine, now - 3 * HOUR - 10 * MIN));
    SEED_NOTIFS.forEach(function (n) {
      state.notifications.push(mknotif(state, n[1], byHandle[n[0]], byHandle.you, null, now - n[2] * MIN));
    });
    state.notifications.sort(function (a, b) { return b.at - a.at; });

    return state;
  }

  function mknotif(state, type, actorId, userId, postId, at) {
    state.seq.n += 1;
    return { id: 'n_' + state.seq.n, type: type, actorId: actorId, userId: userId, postId: postId, at: at };
  }

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  global.Seed = { build: build, hash: hash };
})(window);
