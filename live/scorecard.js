/* The Scorecard tab of the live page: every innings with its batting, bowling, extras, fall of
 * wickets and over-by-over balls, read only. Like live.js it only draws what the scorer's phone sent
 * (see src/domain/cricket/liveScorecard.ts) and sets all text with textContent. */
(function () {
  'use strict';

  // How a batter was out, worded the usual cricket way from the wicket type and the names
  function dismissalText(batter) {
    var bowler = batter.bowler || '';
    var fielder = batter.fielder || '';
    var byBowler = bowler ? ' b ' + bowler : '';
    switch (batter.how) {
      case 'bowled':
        return 'b ' + bowler;
      case 'caught':
        if (!fielder || fielder === bowler) return 'c & b ' + bowler;
        return 'c ' + fielder + byBowler;
      case 'lbw':
        return 'lbw' + byBowler;
      case 'stumped':
        return 'st ' + fielder + byBowler;
      case 'run_out':
        return 'run out' + (fielder ? ' (' + fielder + ')' : '');
      case 'hit_wicket':
        return 'hit wicket' + byBowler;
      case 'retired_hurt':
        return 'retired hurt';
      case 'retired_out':
        return 'retired out';
      case 'hit_ball_twice':
        return 'hit the ball twice';
      case 'obstructing_field':
        return 'obstructing the field';
      case 'timed_out':
        return 'timed out';
      default:
        return batter.isOut ? 'out' : 'not out';
    }
  }

  // "FOUR:4" or "WIDE:1:W" back into the ball the strip draws
  function readBall(token) {
    var parts = String(token).split(':');
    return { kind: parts[0], runs: Number(parts[1]) || 0, isWicket: parts[2] === 'W' };
  }

  function extrasText(extras) {
    var parts = [];
    [
      ['wides', 'wd'],
      ['noBalls', 'nb'],
      ['byes', 'b'],
      ['legByes', 'lb'],
      ['penalty', 'pen'],
    ].forEach(function (pair) {
      var count = Number(extras[pair[0]]) || 0;
      if (count > 0) parts.push(pair[1] + ' ' + count);
    });
    var total = Number(extras.total) || 0;
    return 'Extras ' + total + (parts.length > 0 ? ' (' + parts.join(', ') + ')' : '');
  }

  function batterRows(ui, card) {
    var table = ui.el('table', 'num');
    var head = ui.el('tr');
    ['Batter', 'R', 'B', '4s', '6s', 'SR'].forEach(function (heading) {
      head.appendChild(ui.el('th', null, heading));
    });
    var thead = ui.el('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = ui.el('tbody');
    card.batters.forEach(function (batter) {
      var row = ui.el('tr');
      var name = ui.nameCell(
        'td',
        'name',
        ui.withMark(batter.name || 'Batter', batter.mark) + (batter.isAtCrease ? ' *' : '')
      );
      name.appendChild(ui.el('span', 'how', dismissalText(batter)));
      row.appendChild(name);
      [batter.runs, batter.balls, batter.fours, batter.sixes].forEach(function (value) {
        row.appendChild(ui.el('td', null, ui.num(value)));
      });
      row.appendChild(ui.el('td', null, ui.fixed(batter.strikeRate, 1)));
      body.appendChild(row);
    });
    table.appendChild(body);
    return table;
  }

  function buildBatting(ui, card) {
    var section = ui.el('section', 'card');
    section.appendChild(ui.el('h2', null, 'Batting'));
    if (card.batters.length > 0) section.appendChild(batterRows(ui, card));
    else section.appendChild(ui.el('p', 'empty', 'No batters yet.'));
    if (card.yetToBat.length > 0) {
      section.appendChild(ui.el('p', 'subhead', 'Yet to bat'));
      section.appendChild(ui.nameCell('p', 'plain', card.yetToBat.join(', ')));
    }
    var foot = ui.el('div', 'tally num');
    foot.appendChild(ui.el('span', null, extrasText(card.extras)));
    foot.appendChild(ui.el('strong', null, 'Total ' + ui.scoreOf(card)));
    section.appendChild(foot);
    return section;
  }

  function buildBowling(ui, card) {
    if (card.bowlers.length === 0) return null;
    return ui.buildTable(
      'Bowling',
      ['Bowler', 'O', 'M', 'R', 'W', 'Econ'],
      card.bowlers.map(function (bowler) {
        return [
          ui.withMark(bowler.name || 'Bowler', bowler.mark),
          bowler.overs,
          ui.num(bowler.maidens),
          ui.num(bowler.runs),
          ui.num(bowler.wickets),
          ui.fixed(bowler.economy, 2),
        ];
      })
    );
  }

  function buildFall(ui, card) {
    if (card.fallOfWickets.length === 0) return null;
    var section = ui.el('section', 'card');
    section.appendChild(ui.el('h2', null, 'Fall of wickets'));
    var list = ui.el('ul', 'fall num');
    card.fallOfWickets.forEach(function (fall) {
      var item = ui.el('li', 'fall-item');
      item.appendChild(ui.el('strong', null, ui.num(fall.runs) + '/' + ui.num(fall.wicket)));
      item.appendChild(
        ui.nameCell('span', null, (fall.player || 'Batter') + ' (' + fall.overs + ' ov)')
      );
      list.appendChild(item);
    });
    section.appendChild(list);
    return section;
  }

  function buildOvers(ui, card) {
    if (card.overByOver.length === 0) return null;
    var section = ui.el('section', 'card');
    section.appendChild(ui.el('h2', null, 'Over by over'));
    card.overByOver.forEach(function (over) {
      var row = ui.el('div', 'over');
      var head = ui.el('div', 'over-head num');
      // The phone counts overs from 0; people count from 1
      head.appendChild(ui.el('strong', null, 'Over ' + (ui.num(over.over) + 1)));
      head.appendChild(ui.el('span', null, ui.plural(ui.num(over.runs), 'run')));
      row.appendChild(head);
      var balls = ui.el('ol', 'balls num');
      over.balls.forEach(function (token) {
        var shown = ui.describeBall(readBall(token));
        balls.appendChild(ui.el('li', shown.className, shown.label));
      });
      row.appendChild(balls);
      section.appendChild(row);
    });
    return section;
  }

  function buildPicker(ui, cards, selected, onSelect) {
    var picker = ui.el('div', 'innings-picker');
    cards.forEach(function (card, index) {
      var button = ui.el('button', 'pill' + (index === selected ? ' pill-on' : ''));
      button.type = 'button';
      button.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
      button.setAttribute('dir', 'auto');
      button.textContent = (index >= 2 ? 'SO · ' : '') + ui.lineOf(card);
      button.addEventListener('click', function () {
        onSelect(index);
      });
      picker.appendChild(button);
    });
    return picker;
  }

  /** The tab's content: a list of nodes to put under the tab bar. */
  function build(ui, data, selected, onSelect) {
    var cards = data.scorecard;
    if (!cards || cards.length === 0) {
      return [
        ui.el(
          'p',
          'message',
          "The scorecard is not available for this match. The scorer's app may need an update."
        ),
      ];
    }
    var index = Math.min(Math.max(selected, 0), cards.length - 1);
    var card = cards[index];
    var nodes = [];
    if (cards.length > 1) nodes.push(buildPicker(ui, cards, index, onSelect));
    if (card.isManual) {
      nodes.push(
        ui.nameCell(
          'p',
          'note',
          card.team + ' ' + ui.scoreOf(card) + ': only the total was recorded for this innings.'
        )
      );
    } else {
      nodes.push(buildBatting(ui, card));
    }
    [buildBowling(ui, card), buildFall(ui, card), buildOvers(ui, card)].forEach(function (section) {
      if (section) nodes.push(section);
    });
    return nodes;
  }

  window.LiveScorecard = { build: build };
})();
