/* Live score page: asks the cloud for the match's latest score and draws it. It works nothing out -
 * the scorer's phone sends every figure (see src/domain/cricket/liveSnapshot.ts). All text is set
 * with textContent, never as HTML, so a name in a score can never run as code. */
(function () {
  'use strict';

  // Public keys (the "anon" role): they only let a page call the functions the cloud allows anyone to call.
  // The link names the project its score was sent to (`p`); no `p` means production.
  var PRODUCTION_REF = 'eagmswyijddacfarkevt';
  var ENVIRONMENTS = {
    eagmswyijddacfarkevt: {
      url: 'https://eagmswyijddacfarkevt.supabase.co',
      anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZ21zd3lpamRkYWNmYXJrZXZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMDkzMzksImV4cCI6MjEwODU4NTMzOX0.U27Uv2Yx5KMR3oN7wfngjYt8kupc9C28kGdxiHphTHY',
    },
    wyfkzazvgiwxbnmwldsc: {
      url: 'https://wyfkzazvgiwxbnmwldsc.supabase.co',
      anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5Zmt6YXp2Z2l3eGJubXdsZHNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MzA2NDQsImV4cCI6MjEwODMwNjY0NH0.ymElJsepIUuLLLl0TQ23H4-FIhWNDfq8TnRzazK5PG0',
    },
  };

  var TOKEN_PATTERN = /^[0-9a-f]{16}$/;
  var POLL_MS = 6000;
  var POLL_FINISHED_MS = 30000;
  var POLL_MAX_BACKOFF_MS = 30000;
  var STALE_AFTER_S = 120;

  var app = document.getElementById('app');
  var params = new URLSearchParams(window.location.search);
  var token = (params.get('c') || '').trim();
  var projectRef = params.get('p') || PRODUCTION_REF;
  var env = Object.prototype.hasOwnProperty.call(ENVIRONMENTS, projectRef)
    ? ENVIRONMENTS[projectRef]
    : null;

  var lastUpdatedAt = null; // the cloud's own stamp of the score on screen, sent back to skip unchanged replies
  var lastReceivedAtMs = 0;
  var snapshot = null;
  var failures = 0;
  var pollTimer = null;
  var isStopped = false;

  /* ---------- small helpers ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function num(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : 0;
  }

  function fixed(value, digits) {
    return num(value).toFixed(digits);
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  // Names come from the scorer, in any language: let the browser pick each one's direction
  function nameCell(tag, className, text) {
    var node = el(tag, className, text);
    node.setAttribute('dir', 'auto');
    return node;
  }

  function lineOf(innings) {
    return (
      innings.team +
      ' ' +
      num(innings.runs) +
      '/' +
      num(innings.wickets) +
      ' (' +
      innings.overs +
      ' ov)'
    );
  }

  /* ---------- one ball in the recent-balls strip ---------- */

  function describeBall(ball) {
    var runs = num(ball.runs);
    var extra = runs > 1 ? '+' + (runs - 1) : '';
    var label;
    var className = 'ball';
    switch (ball.kind) {
      case 'FOUR':
        label = '4';
        className += ' ball-four';
        break;
      case 'SIX':
        label = '6';
        className += ' ball-six';
        break;
      case 'WIDE':
        label = 'Wd' + extra;
        className += ' ball-extra';
        break;
      case 'NO_BALL':
        label = 'Nb' + extra;
        className += ' ball-extra';
        break;
      case 'BYE':
        label = 'B' + runs;
        className += ' ball-extra';
        break;
      case 'LEG_BYE':
        label = 'Lb' + runs;
        className += ' ball-extra';
        break;
      case 'PENALTY':
        label = 'P' + runs;
        className += ' ball-extra';
        break;
      case 'DOT':
        label = '•';
        className += ' ball-dot';
        break;
      default:
        label = String(runs);
    }
    if (ball.isWicket) {
      label = 'W';
      className = 'ball ball-wicket';
    }
    return { label: label, className: className };
  }

  /* ---------- sections ---------- */

  function buildHeader(data) {
    var top = el('div', 'top');
    top.appendChild(nameCell('h1', 'teams', data.teamA + ' vs ' + data.teamB));
    var chip;
    if (data.state === 'LIVE') chip = el('span', 'chip chip-live', 'Live');
    else if (data.state === 'INNINGS_BREAK') chip = el('span', 'chip chip-break', 'Innings break');
    else chip = el('span', 'chip chip-done', 'Finished');
    top.appendChild(chip);

    var card = el('section', 'card');
    card.appendChild(top);
    var details = [plural(num(data.oversPerInnings), 'over')];
    if (data.venue) details.unshift(data.venue);
    card.appendChild(nameCell('p', 'meta', details.join(' · ')));
    return card;
  }

  function buildScore(data) {
    var batting = data.batting;
    var card = el('section', 'card');

    var row = el('div', 'batting');
    var team = nameCell('span', 'batting-team', batting.team);
    if (data.isSuperOver) team.appendChild(el('span', 'tag', 'Super Over'));
    if (data.isFreeHit) team.appendChild(el('span', 'tag tag-free', 'Free Hit'));
    row.appendChild(team);
    var score = el('div', 'score num', num(batting.runs) + '/' + num(batting.wickets));
    score.appendChild(
      el('small', null, '(' + batting.overs + '/' + num(data.oversPerInnings) + ' ov)')
    );
    row.appendChild(score);
    card.appendChild(row);
    card.appendChild(el('p', 'rates num', 'Run rate ' + fixed(batting.runRate, 2)));

    var chase = data.chase;
    if (chase && data.state !== 'COMPLETED') {
      var need = num(chase.runsNeeded);
      var text =
        need > 0
          ? 'Target ' +
            num(chase.target) +
            ' · need ' +
            plural(need, 'run') +
            ' from ' +
            plural(num(chase.ballsLeft), 'ball')
          : 'Target ' + num(chase.target) + ' reached';
      if (need > 0 && chase.requiredRate !== null && chase.requiredRate !== undefined) {
        text += ' · RRR ' + fixed(chase.requiredRate, 2);
      }
      card.appendChild(el('p', 'chase num', text));
    }

    if (data.state === 'COMPLETED' && data.result) {
      card.appendChild(nameCell('p', 'result', data.result));
    }

    if (data.earlierInnings && data.earlierInnings.length > 0) {
      var list = el('ul', 'earlier num');
      data.earlierInnings.forEach(function (innings) {
        list.appendChild(nameCell('li', null, lineOf(innings)));
      });
      card.appendChild(list);
    }
    return card;
  }

  function buildTable(title, headings, rows) {
    var card = el('section', 'card');
    card.appendChild(el('h2', null, title));
    var table = el('table', 'num');
    var head = el('tr');
    headings.forEach(function (heading) {
      head.appendChild(el('th', null, heading));
    });
    var thead = el('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = el('tbody');
    rows.forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (cell, index) {
        tr.appendChild(index === 0 ? nameCell('td', 'name', cell) : el('td', null, cell));
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    card.appendChild(table);
    return card;
  }

  function buildCrease(data) {
    var rows = [];
    function batterRow(batter, isOnStrike) {
      return [
        batter.name + (isOnStrike ? ' *' : ''),
        num(batter.runs),
        num(batter.balls),
        num(batter.fours),
        num(batter.sixes),
        fixed(batter.strikeRate, 1),
      ];
    }
    if (data.striker) rows.push(batterRow(data.striker, true));
    if (data.nonStriker) rows.push(batterRow(data.nonStriker, false));
    if (rows.length === 0) return null;
    return buildTable('Batting', ['Batter', 'R', 'B', '4s', '6s', 'SR'], rows);
  }

  function buildBowler(data) {
    var bowler = data.bowler;
    if (!bowler) return null;
    return buildTable(
      'Bowling',
      ['Bowler', 'O', 'M', 'R', 'W', 'Econ'],
      [
        [
          bowler.name,
          bowler.overs,
          num(bowler.maidens),
          num(bowler.runs),
          num(bowler.wickets),
          fixed(bowler.economy, 2),
        ],
      ]
    );
  }

  function buildRecentBalls(data) {
    var balls = data.recentBalls || [];
    if (balls.length === 0) return null;
    var card = el('section', 'card');
    card.appendChild(el('h2', null, 'Recent balls'));
    var list = el('ol', 'balls num');
    balls.forEach(function (ball) {
      var shown = describeBall(ball);
      list.appendChild(el('li', shown.className, shown.label));
    });
    card.appendChild(list);
    return card;
  }

  function buildUpdated() {
    var seconds = Math.max(0, Math.round((Date.now() - lastReceivedAtMs) / 1000));
    var node = el('p', 'updated');
    node.id = 'updated';
    return setUpdatedText(node, seconds);
  }

  function setUpdatedText(node, seconds) {
    var isStale = snapshot && snapshot.state === 'LIVE' && seconds > STALE_AFTER_S;
    node.className = isStale ? 'updated stale' : 'updated';
    if (isStale) {
      node.textContent =
        'No new ball for ' + Math.round(seconds / 60) + ' min. The scorer may be offline.';
    } else {
      node.textContent =
        'Updated ' +
        (seconds < 5
          ? 'just now'
          : seconds < 60
            ? seconds + 's ago'
            : Math.round(seconds / 60) + ' min ago');
    }
    return node;
  }

  /* ---------- the page ---------- */

  function showMessage(title, detail, withRetry) {
    app.textContent = '';
    var box = el('div', 'message');
    box.appendChild(el('strong', null, title));
    box.appendChild(document.createTextNode(detail));
    app.appendChild(box);
    if (withRetry) {
      var button = el('button', 'retry', 'Try again');
      button.type = 'button';
      button.addEventListener('click', function () {
        showMessage('Loading the live score...', '', false);
        failures = 0;
        poll();
      });
      app.appendChild(button);
    }
  }

  function render() {
    var data = snapshot;
    app.textContent = '';
    if (failures > 0) {
      app.appendChild(el('p', 'offline', 'Reconnecting... showing the last score.'));
    }
    app.appendChild(buildHeader(data));
    app.appendChild(buildScore(data));
    [buildCrease(data), buildBowler(data), buildRecentBalls(data)].forEach(function (section) {
      if (section) app.appendChild(section);
    });
    app.appendChild(buildUpdated());
    document.title =
      data.batting.team +
      ' ' +
      num(data.batting.runs) +
      '/' +
      num(data.batting.wickets) +
      ' - Live Score';
  }

  /* ---------- talking to the cloud ---------- */

  function request() {
    var body = { p_token: token };
    if (lastUpdatedAt) body.p_since = lastUpdatedAt;
    return fetch(env.url + '/rest/v1/rpc/get_live_score', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        apikey: env.anon,
        Authorization: 'Bearer ' + env.anon,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function nextDelay() {
    if (failures > 0) return Math.min(POLL_MS * Math.pow(2, failures), POLL_MAX_BACKOFF_MS);
    return snapshot && snapshot.state === 'COMPLETED' ? POLL_FINISHED_MS : POLL_MS;
  }

  function schedule() {
    clearTimeout(pollTimer);
    if (isStopped || document.hidden) return;
    pollTimer = setTimeout(poll, nextDelay());
  }

  function poll() {
    clearTimeout(pollTimer);
    request()
      .then(function (reply) {
        var wasReconnecting = failures > 0;
        failures = 0;
        if (!reply || reply.found !== true) {
          isStopped = true;
          showMessage(
            'This live score is not shared any more',
            'The scorer stopped sharing it, or the link is old.',
            false
          );
          return;
        }
        if (reply.unchanged) {
          // Nothing new: draw again only to take the "Reconnecting" line away
          lastReceivedAtMs = Date.now();
          if (wasReconnecting) render();
          else refreshUpdated();
        } else if (reply.snapshot) {
          snapshot = reply.snapshot;
          lastUpdatedAt = reply.updated_at;
          lastReceivedAtMs = Date.now();
          render();
        }
        schedule();
      })
      .catch(function () {
        failures += 1;
        if (snapshot) render();
        else showMessage('Could not load the score', 'Check your internet and try again.', true);
        if (snapshot) schedule();
      });
  }

  // The "Updated ... ago" line keeps counting between polls
  function refreshUpdated() {
    var node = document.getElementById('updated');
    if (node && snapshot)
      setUpdatedText(node, Math.max(0, Math.round((Date.now() - lastReceivedAtMs) / 1000)));
  }
  setInterval(refreshUpdated, 1000);

  // A tab nobody is looking at stops asking; it asks again at once when it comes back
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(pollTimer);
    else if (!isStopped && snapshot) poll();
  });

  if (!env || !TOKEN_PATTERN.test(token)) {
    isStopped = true;
    showMessage('This link is not complete', 'Ask the scorer to share the live link again.', false);
  } else {
    poll();
  }
})();
