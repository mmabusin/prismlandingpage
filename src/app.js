(function () {
  'use strict';
  var L = window.LAND || {};
  var root = document.documentElement;
  var CANCEL = { cancelled: true };
  var APP = 'https://app.theprismai.com';
  var MONDAY_API = APP + '/api/monday/subscribe';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function motion() { return root.classList.contains('motion'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* recorded answers carry only <span class="hl"> and <b>; anything else is dropped */
  function safeHl(s) { return String(s || '').replace(/<(?!\/?(span|b)\b)[^>]*>/g, '').replace(/<span(?![^>]*class="hl")[^>]*>/g, '<span>'); }
  function ini(n) {
    var w = String(n || '').split(/\s+/).filter(Boolean);
    if (!w.length) return '';
    return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  function clubIni(n) {
    var w = String(n || '').replace(/\b(FC|AFC|SC|CF|SSC|AC|AS|OGC|RC|1\.)\b/g, '').split(/\s+/).filter(function (x) { return x && /^[A-Za-zÀ-ÿ]/.test(x); });
    return w.slice(0, 3).map(function (x) { return x[0]; }).join('').toUpperCase() || '?';
  }
  function crest(src, club, cls) {
    return '<span class="crest' + (cls ? ' ' + cls : '') + (src ? '' : ' noimg') + '" data-ini="' + esc(clubIni(club)) + '">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : '') + '</span>';
  }
  function face(src, name, cls, crestSrc, club) {
    return '<span class="face' + (cls ? ' ' + cls : '') + (src ? '' : ' noimg') + '" data-ini="' + esc(ini(name)) + '">' +
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : '') +
      (crestSrc !== undefined ? crest(crestSrc, club) : '') + '</span>';
  }
  function markSVG(cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 28 28" fill="none" aria-hidden="true">' +
      '<line x1="4" y1="6" x2="4" y2="22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="24" y1="6" x2="24" y2="22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="4" y1="6" x2="24" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="4" y1="22" x2="24" y2="22" stroke="currentColor" stroke-width="1.2" opacity=".4"/>' +
      '<line x1="9" y1="6" x2="9" y2="22" stroke="currentColor" stroke-width=".8" opacity=".4"/><line x1="14" y1="6" x2="14" y2="22" stroke="currentColor" stroke-width=".8" opacity=".4"/>' +
      '<line x1="19" y1="6" x2="19" y2="22" stroke="currentColor" stroke-width=".8" opacity=".4"/><line x1="4" y1="11" x2="24" y2="11" stroke="currentColor" stroke-width=".8" opacity=".4"/>' +
      '<line x1="4" y1="16" x2="24" y2="16" stroke="currentColor" stroke-width=".8" opacity=".4"/><circle class="ball" cx="14" cy="16" r="3" fill="#2563EB"/></svg>';
  }
  function use(id, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function fmt(n, dec) { return Number(n).toLocaleString('en-GB', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function shortDate(iso) { var d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function longDate(iso) { var d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }

  /* A run can be cancelled: every wait checks it is still the latest run of its scene. */
  function Runner() { this.id = 0; }
  Runner.prototype.start = function () {
    var id = ++this.id, self = this;
    return {
      alive: function () { return id === self.id; },
      wait: function (ms) { return new Promise(function (res, rej) { setTimeout(function () { id === self.id ? res() : rej(CANCEL); }, ms); }); }
    };
  };
  Runner.prototype.stop = function () { this.id++; };
  function quiet(p) { return p.catch(function (e) { if (e !== CANCEL) throw e; }); }

  function countUp(el, to, dec, dur, suffix) {
    suffix = suffix || '';
    if (!motion()) { el.textContent = fmt(to, dec) + suffix; return; }
    var t0 = performance.now();
    (function tick(t) {
      var p = Math.min(1, (t - t0) / (dur || 900)), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e, dec) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  function countAll(scope) {
    $$('[data-to]', scope).forEach(function (el) {
      countUp(el, parseFloat(el.getAttribute('data-to')), parseInt(el.getAttribute('data-dec') || '0', 10), +(el.getAttribute('data-dur') || 900), el.getAttribute('data-suf') || '');
    });
  }
  function typeText(el, text, run, per) {
    per = per || Math.max(16, Math.min(34, 1300 / text.length));
    var n = 0;
    return new Promise(function (res, rej) {
      (function step() {
        if (!run.alive()) return rej(CANCEL);
        el.innerHTML = esc(text.slice(0, n)) + '<span class="caret"></span>';
        if (n++ < text.length) setTimeout(step, per); else res();
      })();
    });
  }

  /* ────────────── HERO: a question in, the answer out of the mark ────────────── */
  var heroRun = new Runner();
  var RAYS = ['#3b82f6', '#6366f1', '#22d3ee', '#34d399', '#fbbf24', '#f87171'];
  function renderHero() {
    var h = L.hero, sc = $('#hero-scene');
    if (!h || !sc) return;
    var rays = RAYS.map(function (c, i) {
      return '<path class="ray-glow" pathLength="1" stroke="' + c + '" style="--d:' + (i * 0.06) + 's"/><path class="ray" pathLength="1" stroke="' + c + '" style="--d:' + (i * 0.06) + 's"/>';
    }).join('');
    var tiles = '<div class="tile rank" style="--i:0"><b>' + esc(h.rank.r) + ' <small>of ' + h.rank.of + '</small></b><span>' + esc(h.rank.group) + '</span><em>Standing <span data-to="' + h.rank.standing + '" data-dec="1">' + h.rank.standing + '</span></em></div>' +
      h.tiles.map(function (t, i) {
        var num = parseFloat(t.v), dec = (String(t.v).split('.')[1] || '').replace('%', '').length, suf = /%$/.test(t.v) ? '%' : '';
        return '<div class="tile" style="--i:' + (i + 1) + '"><b data-to="' + num + '" data-dec="' + dec + '" data-suf="' + suf + '">' + esc(t.v) + '</b><span>' + esc(t.l) + '</span><em>' + esc(t.r) + '</em></div>';
      }).join('');
    var pts = h.strengths.map(function (s, i) { return '<li style="--i:' + (i + 1) + '"><span><b>' + esc(s.t) + '.</b> ' + esc(s.x) + '</span></li>'; }).join('') +
      h.concerns.slice(0, 1).map(function (s) { return '<li class="con" style="--i:4"><span><b>' + esc(s.t) + '.</b> ' + esc(s.x) + '</span></li>'; }).join('');
    sc.innerHTML =
      '<svg class="beams" aria-hidden="true"><path class="beam-glow" pathLength="1"/><path class="beam-core" pathLength="1"/>' + rays + '</svg>' +
      '<div class="sc-ask">' + use('i-spark', 'spark') + '<span class="q">' + esc(h.q) + '</span><span class="go">Ask</span></div>' +
      '<div class="sc-mid"><div class="sc-mark">' + markSVG() + '</div><ol class="sc-steps">' + h.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>' +
      '<article class="sc-card"><div class="sc-edge"></div>' +
        '<div class="rc-hd">' + face(h.photo, h.name, 'lg', h.crest, 'Manchester City') +
          '<div class="rc-who"><div class="rc-kick">' + esc(h.kicker) + '</div><div class="rc-name">' + esc(h.name) + '</div><div class="rc-sub">' + esc(h.sub) + '</div></div>' +
          '<div class="rc-tiles">' + tiles + '</div><div class="rc-season">' + h.season + '</div></div>' +
        '<div class="rc-body"><div class="rc-lbl">' + markSVG() + 'The Prism\'s verdict</div>' +
          '<div class="writing"><p>Writing the verdict</p><span></span><span></span><span></span></div>' +
          '<p class="rc-lead" style="--i:0">' + esc(h.lead).replace(/(80\.4|9 appearances and 698 minutes)/g, '<span class="hl">$1</span>') + '</p>' +
          '<ul class="rc-pts">' + pts + '</ul></div>' +
        '<div class="rc-by">' + markSVG() + '<b>The Prism</b><span class="st">Scout report · ' + esc(h.recorded.replace(' 2026', '')) + '</span><span class="ok">' + use('i-check') + 'Figures checked</span></div>' +
      '</article>';
    $('#hero-note').textContent = 'The Prism’s read on ' + h.name + ', from the app on ' + h.recorded + '. Replayed faster: in the app the figures arrive within seconds and the full report in about thirty.';
    layoutHero();
  }
  function off(el, upTo) { var x = 0, y = 0; while (el && el !== upTo) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return { x: x, y: y }; }
  /* The question drops out of the ask bar into the mark as one white beam; the answer leaves the
     mark as a bundle that splits into the six colours of the spectrum and lands across the top edge
     of the card, blue at the left, red at the right, where the card's own spectrum edge picks it up. */
  function layoutHero() {
    var sc = $('#hero-scene'); if (!sc || !sc.firstChild) return;
    var ask = $('.sc-ask', sc), mark = $('.sc-mark', sc), card = $('.sc-card', sc), steps = $('.sc-steps', sc), mid = $('.sc-mid', sc);
    var a = off(ask, sc), m = off(mark, sc), c = off(card, sc), md = off(mid, sc);
    var mx = m.x + mark.offsetWidth / 2, mt = m.y + 3, mb = m.y + mark.offsetHeight - 3;
    var beam = 'M' + mx + ',' + (a.y + ask.offsetHeight - 1) + ' L' + mx + ',' + mt;
    $('.beam-core', sc).setAttribute('d', beam);
    $('.beam-glow', sc).setAttribute('d', beam);
    var split = Math.max(mb + 10, md.y + mid.offsetHeight + 6), ct = c.y + 1, h = ct - split;
    var rays = $$('.ray', sc), glows = $$('.ray-glow', sc);
    rays.forEach(function (r, i) {
      var x = c.x + card.offsetWidth * (0.06 + 0.88 * i / (rays.length - 1));
      var d = 'M' + mx + ',' + mb + ' L' + mx + ',' + split + ' C' + mx + ',' + (split + h * 0.62) + ' ' + x + ',' + (ct - h * 0.7) + ' ' + x + ',' + ct;
      r.setAttribute('d', d); glows[i].setAttribute('d', d);
    });
  }
  function heroFinal() {
    heroRun.stop();
    var sc = $('#hero-scene'); if (!sc) return;
    sc.classList.add('s-ask', 's-beam', 's-rays', 's-card', 's-verdict', 's-done', 'done');
    $$('.sc-steps li', sc).forEach(function (li) { li.classList.add('in'); li.classList.remove('run'); });
    $('.sc-ask .q', sc).textContent = L.hero.q;
    $('.sc-mark', sc).classList.add('lit');
    $('#hero-replay').classList.remove('show');
    $$('[data-to]', sc).forEach(function (el) { el.textContent = fmt(parseFloat(el.getAttribute('data-to')), +(el.getAttribute('data-dec') || 0)) + (el.getAttribute('data-suf') || ''); });
  }
  function playHero() {
    var sc = $('#hero-scene'); if (!sc || !L.hero) return;
    if (!motion()) return heroFinal();
    var run = heroRun.start(), q = $('.sc-ask .q', sc), ask = $('.sc-ask', sc), mark = $('.sc-mark', sc), st = $('.rc-by .st', sc);
    sc.className = 'scene'; mark.classList.remove('lit'); q.textContent = '';
    $$('.sc-steps li', sc).forEach(function (li) { li.classList.remove('in', 'run'); });
    $('#hero-replay').classList.remove('show');
    layoutHero();
    quiet((async function () {
      await run.wait(450);
      await typeText(q, L.hero.q, run, 30);
      sc.classList.add('s-ask'); ask.classList.add('sent');
      await run.wait(160); ask.classList.remove('sent'); q.textContent = L.hero.q;
      sc.classList.add('s-beam');
      await run.wait(560);
      mark.classList.add('lit');
      var lis = $$('.sc-steps li', sc);
      for (var i = 0; i < lis.length; i++) { lis[i].classList.add('in', 'run'); await run.wait(420); lis[i].classList.remove('run'); }
      sc.classList.add('s-rays');
      await run.wait(560);
      st.textContent = 'Writing'; st.classList.add('wr');
      sc.classList.add('s-card'); countAll(sc);
      await run.wait(1100);
      sc.classList.add('s-writing');
      await run.wait(1500);
      sc.classList.add('s-verdict');
      await run.wait(1000);
      st.classList.remove('wr'); st.textContent = 'Scout report · ' + L.hero.recorded.replace(' 2026', '');
      sc.classList.add('s-done', 'done');
      $('#hero-replay').classList.add('show');
    })());
  }

  /* ────────────── NUMBERS ────────────── */
  function renderNumbers() {
    var n = L.counts || {}, el = $('#numbers'); if (!el) return;
    var items = [[5, 'leagues, this season and last'], [n.clubs, 'clubs, every squad'], [n.players, 'players with this season’s numbers'], [n.matches, 'matches this season, minute by minute']].filter(function (x) { return x[0]; });
    el.innerHTML = items.map(function (x) { return '<li><b data-to="' + x[0] + '" data-dur="1200">' + fmt(x[0]) + '</b><span>' + esc(x[1]) + '</span></li>'; }).join('');
  }

  /* ────────────── ASK: two recorded answers, replayed ────────────── */
  var askRun = new Runner(), askIdx = 0;
  function renderAsk() {
    var el = $('#ask-app'); if (!el || !L.ask_list) return;
    el.innerHTML =
      '<div class="app-hd"><div class="seg" role="tablist" aria-label="Recorded answers">' +
        '<button type="button" role="tab" aria-selected="true" data-i="0">Under-23 forwards</button>' +
        '<button type="button" role="tab" aria-selected="false" data-i="1">Brighton’s new style</button></div></div>' +
      '<div class="ask-body"><div class="askbar" id="ask-bar">' + use('i-spark', 'spark') + '<span class="q" id="ask-q"></span></div>' +
        '<div class="by">' + markSVG() + '<b>The Prism</b><span id="ask-st"></span></div>' +
        '<ul class="steps2" id="ask-steps"></ul><div class="ask-ans" id="ask-ans"></div></div>' +
      '<p class="foot-note">Recorded from the app on 3 November 2026, replayed faster. Answers are cut to their opening lines here.</p>';
    $$('.seg button', el).forEach(function (b) { b.addEventListener('click', function () { showAsk(+b.getAttribute('data-i'), true); }); });
    showAsk(0, false);
  }
  function askContent(i) {
    if (i === 0) {
      var A = L.ask_list;
      return {
        q: A.q, secs: A.secs, steps: ['Read La Liga’s under-23 forwards', 'Ranked them on The Prism standing'],
        lead: '<p class="card-lead">' + esc(A.head) + ' <small>· Numbered by The Prism’s standing</small></p>',
        items: A.cards.map(function (c, k) {
          return '<div class="cc"><span class="cc-rk">' + (k + 1) + '</span>' + face(c.ph, c.n, '', c.cr, (c.sub.split(' · ').pop())) +
            '<div class="cc-who"><b>' + esc(c.n) + '</b><span>' + esc(c.sub) + '</span></div>' +
            '<div class="cc-st"><b>' + esc(c.st) + '</b><small>' + esc(c.grp) + '</small></div>' +
            '<div class="cc-chips">' + c.chips.map(function (x) { return '<span class="chip"><b>' + esc(x.v) + '</b>' + esc(x.l) + ' <em>' + esc(x.r) + '</em></span>'; }).join('') + '</div>' +
            '<p class="cc-say">' + safeHl(c.say) + '</p></div>';
        }),
        progress: true
      };
    }
    /* a club question: the answer opens with the club's header, as it does in the app */
    var Q = L.ask_club, H = Q.head;
    var head = '<div class="ah"><div class="ah-kick">' + esc(H.kick) + '</div><div class="ah-row">' +
      '<span class="ah-cr" data-ini="' + esc(clubIni(H.name)) + '"><img src="' + esc(H.cr) + '" alt=""></span>' +
      '<div class="ah-id"><b>' + esc(H.name) + '</b><span>' + esc(H.mgr) + '</span></div>' +
      '<div class="ah-fig"><b>' + esc(H.pos) + '</b><small>' + esc(H.pts) + '</small></div></div>' +
      '<div class="ah-ln"><span class="ah-form">' + H.form.map(function (f) { return '<i class="' + f + '">' + f.toUpperCase() + '</i>'; }).join('') + '</span>' +
      H.line.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div></div>';
    return { q: Q.q, secs: Q.secs, steps: Q.steps, lead: '', head: head,
      items: Q.paras.map(function (p) { return safeHl(p.replace(/<(\/?)(p|h4|i)>/g, '[[$1$2]]')).replace(/\[\[(\/?)(p|h4|i)\]\]/g, '<$1$2>'); }), plain: true };
  }
  function showAsk(i, animate) {
    askIdx = i;
    var el = $('#ask-app'), C = askContent(i), run = askRun.start();
    $$('.seg button', el).forEach(function (b) { b.setAttribute('aria-selected', String(+b.getAttribute('data-i') === i)); });
    var q = $('#ask-q'), st = $('#ask-st'), steps = $('#ask-steps'), ans = $('#ask-ans'), bar = $('#ask-bar');
    function fill() { ans.innerHTML = C.lead + (C.head || '') + (C.plain ? '<div class="plain">' + C.items.join('') + '</div>' : C.items.join('')); }
    function done() {
      q.textContent = C.q; bar.classList.remove('thinking');
      steps.innerHTML = C.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
      fill(); ans.scrollTop = 0;
      $$('.cc, .plain > *, .ah', ans).forEach(function (x) { x.classList.add('in'); });
      st.innerHTML = 'Answered in ' + C.secs + 's';
    }
    if (!animate || !motion()) return done();
    q.textContent = ''; steps.innerHTML = ''; ans.innerHTML = ''; st.innerHTML = ''; ans.scrollTop = 0;
    quiet((async function () {
      await run.wait(250);
      await typeText(q, C.q, run, 26);
      q.textContent = C.q; bar.classList.add('thinking');
      st.innerHTML = '<span class="pulse"></span> Working';
      for (var k = 0; k < C.steps.length; k++) {
        await run.wait(520);
        steps.insertAdjacentHTML('beforeend', '<li>' + esc(C.steps[k]) + '</li>');
      }
      await run.wait(500);
      fill();
      var nodes = $$('.ah, .cc, .plain > *', ans);
      for (var n = 0; n < nodes.length; n++) {
        if (C.progress) st.innerHTML = '<span class="pulse"></span> Writing about each player, ' + (n + 1) + ' of ' + nodes.length;
        else st.innerHTML = '<span class="pulse"></span> Writing';
        nodes[n].classList.add('in');
        /* the answer area keeps the newest card in view while it writes, as the app's chat does */
        if (n > 0 && nodes[n].offsetTop - ans.offsetTop > ans.clientHeight * 0.55) ans.scrollTo({ top: nodes[n].offsetTop - ans.offsetTop - 8, behavior: 'smooth' });
        await run.wait(C.plain ? 650 : 620);
      }
      bar.classList.remove('thinking');
      st.innerHTML = 'Answered in ' + C.secs + 's';
      /* then it goes back to the top, so the finished answer reads from its first line */
      await run.wait(650);
      ans.scrollTo({ top: 0, behavior: 'smooth' });
    })());
  }

  /* ────────────── THE STANDING: every wide player in La Liga, measure by measure ────────────── */
  function renderStanding() {
    var el = $('#st-app'), S = L.standing; if (!el || !S) return;
    var P = S.lead;
    var strips = S.strips.map(function (m) {
      var vals = m.vals, lo = m.min, hi = m.max, span = (hi - lo) || 1;
      var pos = vals.map(function (v) { var t = (v - lo) / span; return m.lower ? 1 - t : t; });
      /* a light beeswarm: dots that would sit on top of one another move to a lane above or below */
      var order = pos.map(function (p, i) { return [p, i]; }).sort(function (a, b) { return a[0] - b[0]; });
      var lanes = {}, last = [-1, -1, -1];
      order.forEach(function (o) {
        var lane = [0, -1, 1].find(function (l) { return o[0] - last[l + 1] > 0.018; });
        if (lane === undefined) lane = 0;
        lanes[o[1]] = lane; last[lane + 1] = o[0];
      });
      var dots = vals.map(function (v, i) {
        if (i === m.i) return '';
        return '<i class="d" style="left:' + (2 + pos[i] * 96).toFixed(2) + '%;--ly:' + (lanes[i] * 7) + 'px;--dl:' + (pos[i] * 0.5).toFixed(2) + 's"></i>';
      }).join('');
      var me = '<i class="me" style="left:' + (2 + pos[m.i] * 96).toFixed(2) + '%;--dl:.55s"></i>';
      var v = m.l.indexOf('%') >= 0 ? m.me + '%' : m.me.toFixed(2);
      return '<div class="strip"><div class="strip-l">' + esc(m.l) + (m.lower ? ' <small>fewer is better</small>' : '') + '</div>' +
        '<div class="strip-v">' + esc(v) + ' <em>' + ord(m.r) + ' of ' + m.n + '</em></div>' +
        '<div class="dots" aria-hidden="true">' + dots + me + '</div></div>';
    }).join('');
    var like = P.similar.map(function (x) {
      return '<div>' + face(x.ph, x.n, 'sm', x.cr, x.c) + '<span><b>' + esc(x.n) + '</b><small>' + ord(x.r) + ' of ' + x.of + ' in ' + esc(x.lg) + '</small></span></div>';
    }).join('');
    el.innerHTML =
      '<div class="st-hd">' + face(P.photo, P.name, 'lg', P.crest, P.club) +
        '<div class="rc-who"><div class="rc-kick">Wide players · ' + esc(S.league) + ' 2026/2027</div><div class="rc-name">' + esc(P.name) + '</div>' +
        '<div class="rc-sub">' + P.age + ' · ' + esc(P.club) + ' · ' + P.starts + ' starts, ' + fmt(P.mins) + ' minutes</div>' +
        '<span class="st-rank">' + ord(P.rank) + ' of ' + P.of + ' ' + esc(S.group) + '</span></div>' +
        '<div class="st-big"><b data-to="' + P.standing + '" data-dec="1" data-dur="1400">' + P.standing.toFixed(1) + '</b><span>The Prism standing, out of 100</span></div></div>' +
      '<div class="strips" id="strips">' + strips + '</div>' +
      '<div class="st-foot"><div class="st-prev">Last season<b>' + ord(P.prev.rank) + ' of ' + P.prev.of + '</b>' + esc(P.prev.season.replace('/20', '/')) + '</div>' +
        '<div><div class="yc-k" style="margin-bottom:8px">Players like him, across the five leagues</div><div class="like">' + like + '</div></div></div>' +
      '<p class="foot-note">From his page in the app, ' + esc(L.as_of) + '. Each dot is one of the ' + P.of + ' ' + esc(S.group) + ' with enough minutes to be ranked.</p>';
  }

  /* ────────────── MATCHES: Barcelona 6-1 Alavés ────────────── */
  var mxRun = new Runner();
  function pitchLines() {
    return '<svg viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true"><g class="lines">' +
      '<rect x="0.6" y="0.6" width="103.8" height="66.8" rx="0.6"/><line x1="52.5" y1="0.6" x2="52.5" y2="67.4"/><circle cx="52.5" cy="34" r="9.15"/>' +
      '<rect x="0.6" y="13.85" width="16.5" height="40.3"/><rect x="0.6" y="24.85" width="5.5" height="18.3"/><rect x="87.9" y="13.85" width="16.5" height="40.3"/><rect x="98.9" y="24.85" width="5.5" height="18.3"/>' +
      '<circle cx="11" cy="34" r=".5" fill="rgba(255,255,255,.4)"/><circle cx="94" cy="34" r=".5" fill="rgba(255,255,255,.4)"/><circle cx="52.5" cy="34" r=".5" fill="rgba(255,255,255,.4)"/></g></svg>';
  }
  function renderMatch() {
    var el = $('#mx'), M = L.match; if (!el || !M) return;
    var away = M.away.n.replace('Deportivo ', ''), home = M.home.n.replace('FC ', '');
    el.innerHTML =
      '<div class="mx-hd"><span>' + esc(M.league) + ' · Matchday ' + esc(M.round) + '</span><span>' + esc(M.venue) + ' · ' + esc(longDate(M.date)) + '</span></div>' +
      '<div class="mx-score"><div class="mx-team">' + crest(M.home.cr, M.home.n) + '<span>' + esc(M.home.n) + '</span></div>' +
        '<div class="mx-sc num">' + M.home.g + '<em>-</em>' + M.away.g + '</div>' +
        '<div class="mx-team r"><span>' + esc(M.away.n) + '</span>' + crest(M.away.cr, M.away.n) + '</div></div>' +
      '<div class="pitch"><canvas id="heat" aria-label="Heat map: where the ball spent the game"></canvas>' + pitchLines() + '</div>' +
      '<div class="pitch-ends"><span>' + esc(home) + '’s goal</span><span>' + esc(home) + ' attack →</span><span>' + esc(away) + '’s goal</span></div>' +
      '<div class="tl" id="tl"></div>' +
      '<div class="mx-cap" id="mx-cap" aria-live="polite"></div>' +
      '<ul class="mx-lines">' + (M.lines || []).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '<li>Where the ball was shows where the game was played, not who had the ball.</li></ul>';
    drawHeat(); drawTimeline(false);
    caption(M.goals[3]);
    var hd = $('#potr-h'); if (hd) hd.textContent = 'Players of the round, last weekend · official match ratings';
    $('#potr').innerHTML = L.potr.map(function (p) {
      var slug = p.lg.toLowerCase().replace(/ /g, '-');
      return '<a href="/rankings/' + slug + '/team-of-the-week"><span class="lg">' + esc(p.lg) + ' · ' + esc(p.rd) + '</span>' + face(p.ph, p.n, '', p.cr, p.c) +
        '<b>' + esc(p.n) + '</b><span class="rt">' + (p.rt % 1 ? p.rt.toFixed(2) : p.rt.toFixed(1)) + '</span><small>' + esc(p.game) + '</small></a>';
    }).join('');
  }
  function caption(g) {
    var cap = $('#mx-cap'); if (!cap) return;
    if (!g) { cap.innerHTML = ''; return; }
    cap.innerHTML = '<b>' + g.m + '′ ' + esc(g.score) + '</b>' + esc(g.text || g.p);
  }
  function drawHeat() {
    var M = L.match, cv = $('#heat'); if (!cv || !M) return;
    paintHeat(cv, M.grid, M.cols, M.rows);
    $$('canvas[data-heat]').forEach(function (c) { var g = L.monday && L.monday[c.getAttribute('data-heat')]; if (g) paintHeat(c, g.grid, g.cols, g.rows); });
  }
  /* where the ball was: the app's 21 x 14 grid of time, blurred, scaled to its own peak and
     coloured along the spectrum, drawn under the pitch lines */
  function paintHeat(cv, grid, cols, rows) {
    var box = cv.parentNode.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.max(10, Math.round(box.width * dpr)), H = Math.max(10, Math.round(box.height * dpr));
    cv.width = W; cv.height = H;
    var max = Math.max.apply(null, grid) || 1;
    var s = document.createElement('canvas'); s.width = cols; s.height = rows;
    var sx = s.getContext('2d'), id = sx.createImageData(cols, rows);
    for (var i = 0; i < grid.length; i++) { var v = Math.round(255 * Math.pow(grid[i] / max, 0.8)); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    sx.putImageData(id, 0, 0);
    var mw = 336, mh = 218, m = document.createElement('canvas'); m.width = mw; m.height = mh;
    var mc = m.getContext('2d'); mc.imageSmoothingEnabled = true; mc.imageSmoothingQuality = 'high';
    mc.filter = 'blur(5px)'; mc.drawImage(s, 0, 0, mw, mh); mc.filter = 'none';
    var img = mc.getImageData(0, 0, mw, mh), d = img.data, peak = 1;
    for (var q = 0; q < d.length; q += 4) if (d[q] > peak) peak = d[q];   /* blurring lowers the peak: scale back to full */
    var stops = [[0, 30, 64, 175], [0.22, 37, 99, 235], [0.42, 6, 182, 212], [0.62, 16, 185, 129], [0.8, 245, 158, 11], [1, 239, 68, 68]];
    for (var p = 0; p < d.length; p += 4) {
      var t = Math.pow(d[p] / peak, 0.75), k = 1;
      while (k < stops.length - 1 && stops[k][0] < t) k++;
      var a = stops[k - 1], b = stops[k], f = Math.max(0, Math.min(1, (t - a[0]) / ((b[0] - a[0]) || 1)));
      d[p] = a[1] + (b[1] - a[1]) * f; d[p + 1] = a[2] + (b[2] - a[2]) * f; d[p + 2] = a[3] + (b[3] - a[3]) * f;
      d[p + 3] = Math.round(255 * Math.min(0.95, Math.max(0, (t - 0.05) * 1.5)));
    }
    mc.putImageData(img, 0, 0);
    var c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.clearRect(0, 0, W, H); c.drawImage(m, 0, 0, W, H);
  }
  function goalT(g, M) { return g.m <= 45 ? (g.m - 0.5) * 60 : M.h1_end + (g.m - 45.5) * 60; }
  function drawTimeline(hidden) {
    var M = L.match, host = $('#tl'); if (!host || !M) return;
    var w = Math.max(200, host.clientWidth), h = 62, mid = 31, BIN = 180, end = M.end;
    var n = M.river.length, bw = w / Math.ceil(end / BIN);
    var bars = M.river.map(function (v, i) {
      if (v === null || v === undefined || v === 0) return '';
      var x = i * bw + 1, hh = Math.abs(v) * 24, cls = v > 0 ? 'bar-h' : 'bar-a';
      return '<rect class="' + cls + '" data-t="' + (i * BIN) + '" x="' + x.toFixed(1) + '" y="' + (v > 0 ? mid - hh : mid).toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1"/>';
    }).join('');
    var goals = M.goals.map(function (g, i) {
      var x = goalT(g, M) / end * w, y = g.side === 'home' ? 4 : h - 4;
      return '<circle class="' + (g.side === 'home' ? 'goal' : 'goal-a') + '" data-g="' + i + '" data-t="' + goalT(g, M) + '" cx="' + x.toFixed(1) + '" cy="' + y + '" r="3.6"/>';
    }).join('');
    var htx = M.h1_end / end * w;
    host.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><line class="mid" x1="0" y1="' + mid + '" x2="' + w + '" y2="' + mid + '"/>' +
      '<line class="ht" x1="' + htx + '" y1="6" x2="' + htx + '" y2="' + (h - 6) + '"/>' + bars + goals +
      '<text class="lbl" x="' + (htx + 4) + '" y="' + (h - 2) + '">HT</text>' +
      '<line class="scrub" id="scrub" x1="' + (hidden ? 0 : w) + '" y1="2" x2="' + (hidden ? 0 : w) + '" y2="' + (h - 2) + '" opacity="' + (hidden ? 1 : 0) + '"/></svg>' +
      '<div class="tl-key"><span><i class="k-h"></i>Ball in ' + esc(M.away.n.replace('Deportivo ', '')) + '’s half</span><span><i class="k-a"></i>In ' + esc(M.home.n.replace('FC ', '')) + '’s half</span><span><i class="k-g"></i>Goals</span></div>';
    if (!hidden) $$('rect, circle', host).forEach(function (n2) { n2.classList.add('on'); });
  }
  function playMatch() {
    var M = L.match, el = $('#mx'); if (!el || !M) return;
    el.classList.add('in');
    if (!motion()) { drawTimeline(false); caption(M.goals[3]); return; }
    var run = mxRun.start();
    drawTimeline(true); caption(null);
    var host = $('#tl'), w = host.clientWidth, scrub = $('#scrub'), end = M.end, dur = 7000;
    var bars = $$('rect', host), goals = $$('circle', host), t0 = null;
    quiet((async function () {
      await run.wait(900);
      await new Promise(function (res, rej) {
        (function frame(ts) {
          if (!run.alive()) return rej(CANCEL);
          if (t0 === null) t0 = ts;
          var p = Math.min(1, (ts - t0) / dur), now = p * end, x = p * w;
          scrub.setAttribute('x1', x); scrub.setAttribute('x2', x);
          bars.forEach(function (b) { if (!b.classList.contains('on') && +b.getAttribute('data-t') <= now) b.classList.add('on'); });
          goals.forEach(function (g) { if (!g.classList.contains('on') && +g.getAttribute('data-t') <= now) { g.classList.add('on'); caption(M.goals[+g.getAttribute('data-g')]); } });
          if (p < 1) requestAnimationFrame(frame); else res();
        })(performance.now());
      });
      await run.wait(900);
      scrub.setAttribute('opacity', '0');
    })());
  }

  /* ────────────── FIND ────────────── */
  var findRun = new Runner();
  function renderFind() {
    var el = $('#fd-app'), F = L.find; if (!el || !F) return;
    var rows = F.rows.filter(function (r) { return r.member; }).slice(0, 5).map(function (r, i) {
      return '<div class="fr" style="--dl:' + (i * 0.09) + 's"><span class="fr-rk">' + (i + 1) + '</span>' + face(r.ph, r.n, 'sm', r.cr, r.c) +
        '<div class="fr-who"><b>' + esc(r.n) + '</b><span>' + esc(r.c) + ' · ' + r.age + ' · ' + r.h + 'cm · left foot</span></div>' +
        '<div class="fr-st"><div class="fr-bar"><i style="--w:' + r.s.toFixed(1) + '%;--wn:' + (r.s / 100).toFixed(3) + '"></i></div>' +
        '<small><b>' + r.s.toFixed(1) + '</b><span>' + ord(r.r) + ' of ' + r.of + ' ' + esc(r.g) + '</span></small></div></div>';
    }).join('');
    el.innerHTML =
      '<div class="fd-hd"><h3>Find the player you need</h3>' +
        '<div class="fd-say">' + use('i-spark', 'spark') + '<span class="q" id="fd-q">' + esc(F.say) + '</span><button type="button" tabindex="-1">Find</button></div>' +
        '<div class="fd-read" id="fd-read"><span>The Prism read it as</span>' + F.pills.map(function (p, i) { return '<span class="pill" style="--dl:' + (i * 0.08) + 's">' + esc(p) + '</span>'; }).join('') + '</div></div>' +
      '<div class="fd-meta"><span><b>' + F.matched + ' players</b> fit</span><span>Ranked on The Prism standing</span></div>' +
      '<div class="fd-rows" id="fd-rows">' + rows + '</div>' +
      '<p class="foot-note">From the app on ' + esc(L.as_of) + ': the five best-ranked of the ' + F.matched + ' players who fit.</p>';
    $('#fd-read').classList.add('in'); $('#fd-rows').classList.add('in');
  }
  function playFind() {
    var F = L.find, q = $('#fd-q'), rd = $('#fd-read'), rows = $('#fd-rows'); if (!q) return;
    if (!motion()) { q.textContent = F.say; rd.classList.add('in'); rows.classList.add('in'); return; }
    var run = findRun.start();
    rd.classList.remove('in'); rows.classList.remove('in'); q.textContent = '';
    quiet((async function () {
      await run.wait(350);
      await typeText(q, F.say, run, 32);
      q.textContent = F.say;
      await run.wait(380); rd.classList.add('in');
      await run.wait(650); rows.classList.add('in');
    })());
  }

  /* ────────────── YOUR CLUB ────────────── */
  function surname(n) { var w = n.split(' '); return w.length > 1 ? w[w.length - 1] : n; }
  function renderClub() {
    var el = $('#yc-app'), C = L.club; if (!el || !C) return;
    var nx = C.next, xi = (nx.us && nx.us.xi) || [];
    var rowsY = { GK: 64, DEF: 51, DM: 39, AM: 25, ST: 12 }, shape = [['GK', [1]], ['DEF', [2, 3, 4, 5]], ['DM', [6, 7]], ['AM', [8, 9, 10]], ['ST', [11]]];
    var bySlot = {}; xi.forEach(function (p) { bySlot[p.slot] = p; });
    var pl = '', k = 0;
    shape.forEach(function (row) {
      var slots = row[1].slice().reverse(), n = slots.length;   /* slots count from the right: draw them left to right */
      slots.forEach(function (s, i) {
        var p = bySlot[s]; if (!p) return;
        var x = n === 1 ? 34 : 9 + (50 * i) / (n - 1), y = rowsY[row[0]];
        pl += '<g class="pl" style="--dl:' + (k++ * 0.06) + 's"><circle cx="' + x + '" cy="' + y + '" r="2.4"/><text x="' + x + '" y="' + (y + 5.6) + '">' + esc(surname(p.name)) + '</text></g>';
      });
    });
    var mini = '<svg viewBox="0 0 68 72" aria-hidden="true"><g class="lines"><rect x=".6" y=".6" width="66.8" height="70.8"/><line x1=".6" y1="0.6" x2="67.4" y2="0.6"/><path d="M24.85 71.4v-5.5h18.3v5.5M13.85 71.4V54.9h40.3v16.5"/><path d="M24.9 .6a9.15 9.15 0 0 0 18.2 0"/></g>' + pl + '</svg>';
    var ko = new Date(nx.ko.replace(' ', 'T') + 'Z');
    var when = ko.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    var res = C.recent.slice().reverse().map(function (r) {
      var w = r.us > r.them ? 'W' : r.us < r.them ? 'L' : 'D';
      return '<li><span class="wdl" style="background:var(--' + (w === 'W' ? 'win' : w === 'L' ? 'loss' : 'draw') + ')">' + w + '</span>' + crest(r.cr, r.opp) + '<span>' + (r.home ? 'v ' : 'at ') + esc(r.opp) + '</span><b>' + r.us + '-' + r.them + '</b></li>';
    }).join('');
    var tbl = C.ladder.map(function (r) { return '<div class="' + (r.me ? 'me' : '') + '"><span>' + r.pos + '</span>' + crest(r.cr, r.n) + '<span>' + esc(r.n) + '</span><span>' + r.pts + '</span></div>'; }).join('');
    var outs = C.out.map(function (o) { var b = o.back ? new Date(o.back + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; return '<b>' + esc(o.n) + '</b>, ' + esc(o.why.toLowerCase()) + (b ? ', back ' + b : ''); }).join(' · ');
    el.innerHTML =
      '<div class="yc-hd"><span class="yc-crest" data-ini="' + esc(clubIni(C.n)) + '"><img src="' + esc(C.cr) + '" alt=""></span><div><h3>' + esc(C.n) + '</h3><p>' + esc(C.league) + ' · ' + ord(C.table.pos) + ', ' + C.table.pts + ' points · ' + esc(C.race) + '</p></div><span class="yc-follow"><i></i>Following</span></div>' +
      '<div class="yc-grid"><div class="yc-cell"><div class="yc-k">Next match</div>' +
        '<div class="yc-match">' + crest(C.cr, C.n) + '<span>' + esc(C.n) + (nx.home ? ' v ' : ' at ') + esc(nx.opp) + '</span>' + crest(nx.cr, nx.opp) + '</div>' +
        '<div class="yc-when">' + esc(when) + (nx.venue ? ' · ' + esc(nx.venue) : '') + '</div>' +
        '<div class="yc-tags"><span>' + ord(C.table.pos) + ' v ' + ord(nx.opp_pos) + ' in the table</span><span>Matchday ' + esc(nx.round) + '</span></div>' +
        '<div class="mini"><span class="mini-lbl">Expected line-up · ' + esc((nx.us && nx.us.formation) || '') + '</span>' + mini + '</div></div>' +
      '<div class="yc-cell"><div class="yc-k">Results</div><ul class="res">' + res + '</ul><div class="yc-sep"></div>' +
        '<div class="yc-k">The table</div><div class="tbl">' + tbl + '</div><p class="race">' + esc(C.race) + '.</p><div class="yc-sep"></div>' +
        '<div class="yc-k">Out</div><p class="outs">' + outs + '</p></div></div>' +
      '<p class="foot-note">Arsenal on The Prism’s Home, ' + esc(L.as_of) + '. The line-up is the expected XI until the clubs name their teams.</p>';
  }

  /* The Weekend Prism, drawn the way the email is (monday.py on the launch branch): masthead with the
     weekend's figures, The Prism's opening, player of the weekend, game of the weekend with where the
     ball was, smash and grab, a league's results, the under-23s and the games to watch next. */
  function renderMonday() {
    var el = $('#mail'), M = L.monday; if (!el || !M) return;
    var g = M.game, sm = M.smash;
    var pitch = function (key, cls) { return '<div class="mm-pitch ' + (cls || '') + '"><canvas data-heat="' + key + '" aria-hidden="true"></canvas>' + pitchLines() + '</div>'; };
    var res = M.league.results.map(function (x) {
      return '<div class="mm-res"><span class="' + (x.hg > x.ag ? 'w' : '') + '">' + crest(x.hc, x.h) + esc(x.h) + '</span><b>' + x.hg + '-' + x.ag + '</b><span class="r ' + (x.ag > x.hg ? 'w' : '') + '">' + esc(x.a) + crest(x.ac, x.a) + '</span></div>';
    }).join('');
    var young = M.young.map(function (y) { return '<div class="mm-y"><div><b>' + esc(y.n) + '</b><span>' + esc(y.meta) + '</span></div><em>' + y.rt.toFixed(2) + '</em></div>'; }).join('');
    var watch = M.watch.map(function (w) { return '<div class="mm-w"><div><b>' + esc(w.teams) + '</b><span>' + esc(w.meta) + '</span></div><em>' + esc(w.when).replace('\n', '<br>') + '</em></div>'; }).join('');
    el.innerHTML =
      '<div class="mm-scroll" id="mm-scroll" tabindex="0" aria-label="A sample issue of The Weekend Prism">' +
      '<div class="mm-mast"><div class="mm-logo">' + markSVG() + '<b>The Weekend Prism</b></div>' +
        '<p class="mm-tag">The weekend across Europe’s five big leagues, in five minutes.</p>' +
        '<p class="mm-issue">Sample issue · ' + esc(M.label) + '</p>' +
        '<div class="mm-tiles">' + M.numbers.map(function (n) { return '<div><b>' + esc(n.v) + '</b><span>' + esc(n.l) + '</span></div>'; }).join('') + '</div></div>' +
      '<div class="mm-edge"></div>' +
      '<section class="mm-sec"><p class="mm-k">The weekend, by The Prism</p><p class="mm-open">' + esc(M.opening) + '</p></section>' +
      '<section class="mm-sec"><p class="mm-k">Player of the weekend</p><div class="mm-star">' + face(M.star.ph, M.star.n, 'lg', M.star.cr, 'Paris Saint Germain') +
        '<div><small>' + esc(M.star.meta) + '</small><b>' + esc(M.star.n) + '</b><span>' + esc(M.star.line) + '</span>' +
        '<div class="mm-rt"><em>' + esc(M.star.rt) + '</em>match<br>rating</div></div></div><p class="mm-note">' + esc(M.star.season) + '</p></section>' +
      '<section class="mm-sec"><p class="mm-k">Game of the weekend</p><h4 class="mm-t">' + esc(g.head) + '</h4><div class="mm-game">' +
        '<div class="mm-score"><div>' + crest(g.home.cr, g.home.n) + '<b>' + esc(g.home.n) + '</b></div><strong>' + g.home.g + ' - ' + g.away.g + '</strong><div>' + crest(g.away.cr, g.away.n) + '<b>' + esc(g.away.n) + '</b></div></div>' +
        '<p class="mm-meta">' + esc(g.meta) + '</p>' +
        g.goals.map(function (x) { return '<p class="mm-line"><b>' + x.m + '′</b> ' + esc(x.text) + '</p>'; }).join('') +
        (g.red ? '<p class="mm-line"><b>' + g.red.minute + '′</b> ' + esc(g.red.player) + ' was sent off.</p>' : '') +
        '<div class="mm-stats">' + g.stats.map(function (s2) { return '<div><span>' + esc(s2[1]) + '</span><small>' + esc(s2[0]) + '</small><span>' + esc(s2[2]) + '</span></div>'; }).join('') + '</div>' +
        pitch('game') + '<p class="mm-meta">Where the ball was · ' + esc(g.home.n) + ' attack →</p></div></section>' +
      '<section class="mm-sec"><div class="mm-smash">' + pitch('smash', 'sm') + '<div><p class="mm-k" style="color:#b45309">Smash and grab</p><b>' + esc(sm.title) + '</b><span>' + esc(sm.story) + '</span><small>' + esc(sm.goal) + '</small></div></div></section>' +
      '<section class="mm-sec"><p class="mm-k">League by league</p><h4 class="mm-t">Every result from the weekend</h4><div class="mm-lg"><div class="mm-lg-h"><b>' + esc(M.league.name) + '</b><span>Matchday ' + esc(M.league.round) + '</span></div>' + res + '</div></section>' +
      '<section class="mm-sec"><p class="mm-k">Under-23s who stood out</p><h4 class="mm-t">One from each league</h4>' + young + '</section>' +
      '<section class="mm-sec"><p class="mm-k">Worth watching next</p><h4 class="mm-t">The games to watch</h4>' + watch + '</section>' +
      '<section class="mm-sec mm-end"><b>Every player in the five leagues, ranked.</b><span>Open any player, club or match, build your own indexes and ask The Prism anything about them.</span><span class="mm-btn">Open The Prism</span></section>' +
      '</div>' +
      '<p class="foot-note">A sample issue, from the weekend of 31 October. Scroll it.</p>';
    $$('canvas[data-heat]', el).forEach(function (c) { var h = M[c.getAttribute('data-heat')]; paintHeat(c, h.grid, h.cols, h.rows); });
    /* The agreed endpoint (WEB_LAUNCH_PLAN.md 3b, Resend): 200 means a confirm email went out, from "The Weekend
       Prism", and the address joins only when its button is pressed; it never says whether an address was
       already on the list. 422 a bad address, 429 five tries an hour from one connection, 503 or 502 nothing
       was sent, so never "you're in". */
    var form = $('#mf'), input = $('#mf-email'), err = $('#mf-err'), btn = $('button', form);
    function say(t) { err.textContent = t; err.hidden = !t; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { say('Please enter your full email address.'); input.focus(); return; }
      say(''); btn.disabled = true;
      fetch(MONDAY_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, source: 'landing' }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (x) {
          if (x.s === 200 && x.j && x.j.ok) { form.classList.add('sent'); $('#mf-ok').textContent = 'Nearly there. Check your inbox for an email from The Weekend Prism, and press its button to confirm.'; return; }
          if (x.s === 422) say('That email address does not look right. Check it and try again.');
          else if (x.s === 429) say('Too many tries from this connection. Please try again in an hour.');
          else say('That did not work. Please try again in a minute.');
        })
        .catch(function () { say('That did not work. Please try again in a minute.'); })
        .then(function () { btn.disabled = false; });
    });
  }

  /* Once, as it comes into view, the issue scrolls gently to its game of the weekend and back,
     so a visitor sees there is more in it. Any touch, wheel or key on it stops that for good. */
  var mailRun = new Runner(), mailTouched = false;
  function peekMail() {
    var sc = $('#mm-scroll'); if (!sc || !motion() || mailTouched) return;
    var run = mailRun.start(), stop = function () { mailTouched = true; mailRun.stop(); };
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (ev) { sc.addEventListener(ev, stop, { once: true, passive: true }); });
    var target = $('.mm-sec:nth-of-type(3)', sc);
    quiet((async function () {
      await run.wait(1200);
      sc.scrollTo({ top: target ? target.offsetTop - 12 : sc.clientHeight * 0.8, behavior: 'smooth' });
      await run.wait(2600);
      sc.scrollTo({ top: 0, behavior: 'smooth' });
    })());
  }

  /* ────────────── RANKINGS AND REFRACTIONS ────────────── */
  function renderDoors() {
    var rk = $('#rk-mini'), es = $('#essays');
    if (rk && L.rk_top) rk.innerHTML = L.rk_top.map(function (r) { return '<li><span>' + r.r + '</span><span>' + esc(r.n) + ' <small>· ' + esc(r.c) + '</small></span><b>' + r.s + '</b></li>'; }).join('') +
      '<li class="cap">Best centre backs in the Premier League, on The Prism standing</li>';
    function paintEssays(list) { es.innerHTML = list.slice(0, 3).map(function (p) { return '<li><a href="/refractions/' + esc(p.slug) + '"><small>' + esc(longDate(p.when)) + (p.mins ? ' · ' + p.mins + ' min read' : '') + '</small><b>' + esc(p.t) + '</b></a></li>'; }).join(''); }
    if (es && L.essays) {
      paintEssays(L.essays);
      fetch(APP + '/api/refractions').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        var p = d && d.posts;
        if (p && p.length) paintEssays(p.map(function (x) { return { slug: x.slug, t: x.title, when: String(x.published_at || '').slice(0, 10), mins: x.read_minutes }; }));
      }).catch(function () {});
    }
  }

  /* ────────────── FINAL CALL ────────────── */
  function renderFinal() {
    var svg = $('#final-rays'); if (!svg) return;
    /* the closing reprise of the hero: white light in from the left, the spectrum out to the right */
    svg.innerHTML = '<path class="fb" pathLength="1" vector-effect="non-scaling-stroke" d="M0,80 H560" style="--d:0s"/>' + RAYS.map(function (c, i) {
      var y = 80 + (i - 2.5) * 19;
      return '<path pathLength="1" stroke="' + c + '" vector-effect="non-scaling-stroke" d="M640,80 C760,80 880,' + y + ' 1200,' + y + '" style="--d:' + (0.45 + i * 0.07) + 's"/>';
    }).join('');
  }

  /* ────────────── theme, menu, doors ────────────── */
  /* light unless the visitor chose dark with the toggle; the device's own setting is not followed */
  function effTheme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function setTheme(t) {
    if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    try { if (t === 'system') localStorage.removeItem('prism_site_theme'); else localStorage.setItem('prism_site_theme', t); } catch (e) {}
    syncTheme();
  }
  function syncTheme() {
    var dark = effTheme() === 'dark', b = $('#theme-btn'), tc = $('meta[name="theme-color"]');
    if (b) { b.innerHTML = use(dark ? 'i-sun' : 'i-moon'); b.setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark'); }
    if (tc) tc.setAttribute('content', dark ? '#141414' : '#ffffff');
  }
  function wireChrome() {
    $('#theme-btn').addEventListener('click', function () { setTheme(effTheme() === 'dark' ? 'light' : 'dark'); });
    var mb = $('#menu-btn'), dr = $('#drawer');
    mb.addEventListener('click', function () { var o = !dr.classList.contains('open'); dr.classList.toggle('open', o); mb.setAttribute('aria-expanded', String(o)); });
    $$('a', dr).forEach(function (a) { a.addEventListener('click', function () { dr.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); }); });
    /* progress line for browsers without scroll-driven animations */
    if (!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'))) {
      var pr = $('#progress'), tick = false;
      window.addEventListener('scroll', function () {
        if (tick) return; tick = true;
        requestAnimationFrame(function () { tick = false; var h = document.documentElement.scrollHeight - innerHeight; pr.style.transform = 'scaleX(' + (h > 0 ? scrollY / h : 0) + ')'; });
      }, { passive: true });
    }
    /* Every way into the app is a plain link, so it works with scripts blocked. The page's counter
       (head.html) records each one as it is pressed, with its ?src= tag, without holding the visit. */
  }

  /* ────────────── scenes play when they come into view ────────────── */
  var SCENES = [
    { el: '#hero-scene', play: playHero, final: heroFinal, now: true },
    { el: '#numbers', play: function () { countAll($('#numbers')); }, pre: function () { $$('#numbers [data-to]').forEach(function (b) { b.textContent = '0'; }); } },
    { el: '#ask-app', play: function () { showAsk(askIdx, true); }, pre: function () { askRun.stop(); $('#ask-q').textContent = ''; $('#ask-steps').innerHTML = ''; $('#ask-ans').innerHTML = ''; $('#ask-st').textContent = ''; } },
    { el: '#st-app', play: function () { var s = $('#strips'); s.classList.add('in'); countAll($('.st-big')); }, pre: function () { $('#strips').classList.remove('in'); } },
    { el: '#mx', play: playMatch, pre: function () { mxRun.stop(); $('#mx').classList.remove('in'); drawTimeline(true); caption(null); } },
    { el: '#fd-app', play: playFind, pre: function () { findRun.stop(); $('#fd-read').classList.remove('in'); $('#fd-rows').classList.remove('in'); $('#fd-q').textContent = ''; } },
    { el: '#yc-app', play: function () { $('#yc-app').classList.add('in'); }, pre: function () { $('#yc-app').classList.remove('in'); } },
    { el: '#mail', play: peekMail },
    { el: '#tiers', play: function () { $('#tiers').classList.add('in'); }, pre: function () { $('#tiers').classList.remove('in'); } },
    { el: '#final', play: function () { $('#final').classList.add('in'); }, pre: function () { $('#final').classList.remove('in'); } }
  ];
  var io = null;
  function arm() {
    if (io) io.disconnect();
    SCENES.forEach(function (s) { s.done = false; if (s.pre && motion()) s.pre(); });
    if (!motion() || !('IntersectionObserver' in window)) { SCENES.forEach(function (s) { s.done = true; s.play(); }); return; }
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var s = SCENES.filter(function (x) { return $(x.el) === e.target; })[0];
        if (s && !s.done) { s.done = true; s.play(); io.unobserve(e.target); }
      });
    }, { threshold: 0.3 });
    SCENES.forEach(function (s) { var el = $(s.el); if (!el) return; if (s.now) { s.done = true; s.play(); } else io.observe(el); });
  }

  function wireExtras() {
    /* a photo or crest that will not load shows initials instead */
    document.addEventListener('error', function (e) {
      var t = e.target; if (!t || t.tagName !== 'IMG') return;
      var p = t.parentNode; if (p && (p.classList.contains('face') || p.classList.contains('crest'))) { p.classList.add('noimg'); t.remove(); }
    }, true);
    $$('img').forEach(function (i) { if (i.complete && !i.naturalWidth && i.getAttribute('src')) i.dispatchEvent(new Event('error')); });
    /* the hero's light follows the pointer, on devices that have one */
    var st = $('.hero .stage');
    if (st && matchMedia('(pointer: fine)').matches) {
      var pend = null;
      st.addEventListener('pointermove', function (e) {
        if (!motion()) return;
        var r = st.getBoundingClientRect(); pend = [e.clientX - r.left, e.clientY - r.top];
        requestAnimationFrame(function () { if (!pend) return; st.style.setProperty('--gx', pend[0] + 'px'); st.style.setProperty('--gy', pend[1] + 'px'); st.classList.add('lit'); pend = null; });
      });
      st.addEventListener('pointerleave', function () { st.classList.remove('lit'); });
    }
    /* copy rises in as it is reached */
    var rv = $$('.ch-copy, .new-hd, .monday-in > div:first-child, .dcard, .plans-in, .mo-in, .faq');
    rv.forEach(function (el) { el.classList.add('rv'); });
    if (!motion() || !('IntersectionObserver' in window)) { rv.forEach(function (el) { el.classList.add('in'); }); return; }
    var ro = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } }); }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    rv.forEach(function (el) { ro.observe(el); });
  }

  function init() {
    renderHero(); renderNumbers(); renderAsk(); renderStanding(); renderMatch(); renderFind(); renderClub(); renderMonday(); renderDoors(); renderFinal();
    wireChrome(); syncTheme(); wireExtras();
    $('#hero-replay').addEventListener('click', playHero);
    arm();
    var rt = null;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { layoutHero(); drawHeat(); if (!mxRun.id || $('#tl .on')) drawTimeline(false); }, 120); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutHero);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
