// ── SHARED DECK ANALYSIS ──────────────────────────────────────────────
//
// This file contains the core deck analysis functions that were previously
// duplicated across Mtg-Deck-Stats, Mtg-Shadowboxing, and Grand-Sealed-Magic.
// All three apps now import from this single source.
// Functions are defined at global scope so browser HTML files can use them.
//
// NOTE: keep top-level const/let/class names namespaced (DECKSTATS_* or
// generic-but-unique) — the apps declare their own globals too, and a
// duplicate const/let/class declaration across two classic <script> tags
// throws a SyntaxError that kills the app's entire inline script.

// ── UTILITY ────────────────────────────────────────────────────────────

// Re-exported from shared style.css normalization; kept for standalone use
const normalizeCardName = s => s.replace(/[\u2019\u2018]/g, "'").replace(/^A-/, '').replace(/\*+$/g, '').trim().toLowerCase();

// ── LAND MANA DEDUCTION ────────────────────────────────────────────────

function deduceLandMana(typeLine, oracleText) {
  const res = new Set();
  const t = (typeLine || '').toLowerCase();
  const o = (oracleText || '').toLowerCase();

  if (t.includes('plains')) res.add('W');
  if (t.includes('island')) res.add('U');
  if (t.includes('swamp')) res.add('B');
  if (t.includes('mountain')) res.add('R');
  if (t.includes('forest')) res.add('G');
  if (t.includes('wastes')) res.add('C');

  if (o.includes('search your library for')) {
    if (o.includes('plains')) res.add('W');
    if (o.includes('island')) res.add('U');
    if (o.includes('swamp')) res.add('B');
    if (o.includes('mountain')) res.add('R');
    if (o.includes('forest')) res.add('G');
  }

  if (o.includes('any color') || o.includes('any type')) {
    ['W', 'U', 'B', 'R', 'G'].forEach(c => res.add(c));
  }

  if (o.includes('{')) {
    ['W', 'U', 'B', 'R', 'G', 'C'].forEach(c => {
      if (oracleText.includes('{' + c + '}')) res.add(c);
    });
  }

  return Array.from(res);
}

// ── CREATURE SUBTYPES ───────────────────────────────────────────────────

const DECKSTATS_CARD_TYPES = new Set([
  'basic', 'legendary', 'snow', 'elite', 'world', 'ongoing', 'token', 'host', 'augment',
  'creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'instant', 'sorcery',
  'tribal', 'dungeon', 'battle'
]);

function addCreatureSubtypes(typeLine, acc, qty, cards, name) {
  const parts = (typeLine || '').split(/—|–|-/);
  if (parts.length < 2) return;
  const subtypePart = parts.slice(1).join(' ').trim();
  if (!subtypePart) return;
  subtypePart.split(/\s+/).forEach(word => {
    if (!word) return;
    const clean = word.replace(/\/\/|,/g, '').trim();
    if (!clean || DECKSTATS_CARD_TYPES.has(clean.toLowerCase())) return;
    acc[clean] = (acc[clean] || 0) + qty;
    if (cards) {
      if (!cards[clean]) cards[clean] = [];
      if (!cards[clean].some(c => c.name === name)) cards[clean].push({ name, qty });
    }
  });
}

// ── CARD ROLE DETECTION ────────────────────────────────────────────────

function detectCardRoles(card) {
  const o = ((card && (card.oracle_text || '')) + ' ' + (card && (card.type_line || ''))).toLowerCase();
  const roles = [];

  if (!o.includes('from a graveyard') && !o.includes('from graveyards') &&
      (/(destroy|exile) .*?target .{0,30}?(creature|artifact|enchantment|permanent|land|planeswalker)s?\b/.test(o) ||
       /deals? \d+ damage to (any target|target (creature|noncreature|planeswalker))/.test(o) ||
       /fight target/.test(o) ||
       /target creature.*(gets -\d+\s*\/\s*-?\d+|\bsacrifice it\b)/.test(o) ||
       /target player(s?) (sacrifice|sacrifices) a (creature|permanent|artifact)/.test(o))) {
    roles.push('removal');
  }

  if (/(destroy|exile) (all|each) (creatures|permanents)|deals? \d+ damage to (all|each) (creatures|nontoken)|each (creature|permanent) gets -\d+\s*\/\s*-?\d+/.test(o)) {
    roles.push('wipe');
  }

  if (/search your library for (a|up to \d+) (basic )?land|search your library for (a|up to \d+) (plains|island|swamp|mountain|forest)|put (a|up to \d+) land (card )?(from your library )?onto the battlefield|add (\d+|one|two|three|four)? ?mana|add \{|: add|for each land you control, add/.test(o)) {
    roles.push('ramp');
  }

  if (/draw (a|an|\d+|two|three|four|five|six|seven|x|up to \d+) cards?/.test(o)) {
    roles.push('draw');
  }

  if (/counter (target (noncreature |nonland |creature |instant |sorcery |artifact |enchantment )*spell|any number of target spells|all spells|that spell)/.test(o)) {
    roles.push('counter');
  }

  if (/search your library for (a|an|one|any number of|up to \d+) (card|artifact|enchantment|creature|instant|sorcery|planeswalker|permanent|dragon|spell)s?/.test(o)) {
    roles.push('tutor');
  }

  if (/deals? \d+ damage to (any target|target (player|opponent|planeswalker)|each opponent|each player)/.test(o)) {
    roles.push('burn');
  }

  if (/discard|exile [^.]*graveyard|remove [^.]*graveyard/.test(o)) {
    roles.push('disruption');
  }

  if (/hexproof|indestructible|shroud|protection from|ward \{|prevent (all|\d+) damage/.test(o)) {
    roles.push('protection');
  }

  if (/creates? (a|an|\d+|two|three|four|five|six|x|up to \d+) [\w\s/]*?token|puts? (a|an|one|two|three|four) .{0,45}?token/.test(o)) {
    roles.push('tokens');
  }

  return roles;
}

// ── DECK ANALYSIS ───────────────────────────────────────────────────────

function analyzeDeck(parsed) {
  const uniqueNames = parsed;

  let creatureCount = 0;
  let landCount = 0;
  let instantCount = 0;
  let sorceryCount = 0;
  let artifactCount = 0;
  let enchantmentCount = 0;
  let planeswalkerCnt = 0;
  let otherCount = 0;

  const curveCounts = [0, 0, 0, 0, 0, 0, 0];
  let totalSpellCmc = 0;
  let totalSpells = 0;

  const spellColorPips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let totalSpellPips = 0;

  const landColorSources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let totalLandSources = 0;

  const creatureTypes = {};
  const creatureTypeCards = {};

  const cardRoles = {};
  const cardRoleCards = {};

  const groups = {
    'Creatures': [],
    'Instants': [],
    'Sorceries': [],
    'Artifacts & Enchantments': [],
    'Planeswalkers': [],
    'Lands': [],
    'Other': []
  };

  uniqueNames.forEach(e => {
    const qty = e.qty;
    const card = e.card || {};
    const type = (card.type_line || '').toLowerCase();
    const cmc = typeof card.cmc === 'number' ? card.cmc : 0;
    const manaCost = card.mana_cost || '';
    const produced = card.produced_mana || deduceLandMana(card.type_line, card.oracle_text);

    if (type.includes('land')) {
      landCount += qty;
      produced.forEach(c => {
        const u = c.toUpperCase();
        if (landColorSources[u] !== undefined) {
          landColorSources[u] += qty;
          totalLandSources += qty;
        }
      });
      groups['Lands'].push({ name: e.name, qty, cmc, manaCost });
    } else {
      totalSpells += qty;
      totalSpellCmc += (cmc * qty);
      curveCounts[Math.min(6, Math.max(0, Math.floor(cmc)))] += qty;

      detectCardRoles(card).forEach(r => {
        cardRoles[r] = (cardRoles[r] || 0) + qty;
        if (!cardRoleCards[r]) cardRoleCards[r] = [];
        if (!cardRoleCards[r].some(c => c.name === e.name)) cardRoleCards[r].push({ name: e.name, qty });
      });

      if (manaCost) {
        const symbols = manaCost.match(/\{([^}]+)\}/g) || [];
        symbols.forEach(sym => {
          const inner = sym.replace(/[{}]/g, '').toUpperCase();
          ['W', 'U', 'B', 'R', 'G', 'C'].forEach(c => {
            if (inner.includes(c)) {
              spellColorPips[c] += qty;
              totalSpellPips += qty;
            }
          });
        });
      }

      let assignedGroup = 'Other';
      if (type.includes('creature')) {
        creatureCount += qty;
        addCreatureSubtypes((card.type_line || ''), creatureTypes, qty, creatureTypeCards, e.name);
        assignedGroup = 'Creatures';
      } else if (type.includes('instant')) {
        instantCount += qty;
        assignedGroup = 'Instants';
      } else if (type.includes('sorcery')) {
        sorceryCount += qty;
        assignedGroup = 'Sorceries';
      } else if (type.includes('artifact') || type.includes('enchantment')) {
        if (type.includes('artifact')) artifactCount += qty;
        if (type.includes('enchantment')) enchantmentCount += qty;
        assignedGroup = 'Artifacts & Enchantments';
      } else if (type.includes('planeswalker')) {
        planeswalkerCnt += qty;
        assignedGroup = 'Planeswalkers';
      } else {
        if (e.card) otherCount += qty;
      }
      groups[assignedGroup].push({ name: e.name, qty, cmc, manaCost });
    }
  });

  const typeCounts = {
    'Creatures': creatureCount,
    'Lands': landCount,
    'Instants': instantCount,
    'Sorceries': sorceryCount,
    'Artifacts': artifactCount,
    'Enchantments': enchantmentCount,
    'Planeswalkers': planeswalkerCnt,
    'Other': otherCount
  };

  return {
    totalCards: parsed.reduce((s, e) => s + e.qty, 0),
    uniqueCount: uniqueNames.length,
    totalSpells,
    landCount,
    avgCmc: totalSpells > 0 ? (totalSpellCmc / totalSpells).toFixed(2) : '0.0',
    typeCounts,
    curveCounts,
    spellColorPips,
    totalSpellPips,
    landColorSources,
    totalLandSources,
    creatureTypes,
    creatureTypeCards,
    cardRoles,
    cardRoleCards,
    groups
  };
}