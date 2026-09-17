// ── SHARED DECK ANALYSIS ──────────────────────────────────────────────
//
// This file contains the core deck analysis functions that were previously
// duplicated across Mtg-Deck-Stats, Mtg-Shadowboxing, and Grand-Sealed-Magic.
// All three apps now import from this single source.
// Functions are defined at global scope so browser HTML files can use them.

// ── CARD ROLE DEFINITIONS ─────────────────────────────────────────────

const CARD_ROLE_DEFS = [
  { key: 'removal',    name: 'Targeted Removal',
    desc: 'Kills or exiles a single target — creatures, planeswalkers, artifacts, enchantments, or lands. Includes damage-to-target and fight effects.',
    examples: 'Swords to Plowshares, Doom Blade, Lightning Bolt, Abrupt Decay, Diabolic Edict' },
  { key: 'wipe',       name: 'Board Wipes',
    desc: 'Clears many or all permanents at once — mass destroy/exile, "damage to all", or mass bounce/bypass effects.',
    examples: 'Wrath of God, Damnation, Blasphemous Act, Supreme Verdict, Toxic Deluge' },
  { key: 'ramp',       name: 'Ramp',
    desc: 'Gets you ahead on mana — extra lands from the library, mana dorks, mana rocks, or rituals.',
    examples: 'Rampant Growth, Nature\'s Lore, Birds of Paradise, Sol Ring, Dark Ritual' },
  { key: 'draw',       name: 'Card Draw',
    desc: 'Adds cards to your hand — cantrips, repeatable draw triggers, or big draw spells, including looters.',
    examples: 'Opt, Brainstorm, Ancestral Recall, Ponder, Faithless Looting, Skullclamp' },
  { key: 'counter',    name: 'Counterspells',
    desc: 'Stops spells before they resolve — unconditional counters or type-specific ones (noncreature, instant, etc.).',
    examples: 'Counterspell, Mana Drain, Force of Will, Negate, Dovin\'s Veto' },
  { key: 'tutor',      name: 'Tutors',
    desc: 'Searches the library for a card into hand, top, or battlefield — restricted by type or completely open.',
    examples: 'Demonic Tutor, Vampiric Tutor, Enlightened Tutor, Green Sun\'s Zenith, Worldly Tutor' },
  { key: 'burn',       name: 'Burn',
    desc: 'Direct damage aimed at a player or planeswalker — reach to close games or face-damage spells.',
    examples: 'Lightning Bolt, Lava Spike, Chain Lightning, Fireblast, Skewer the Critics' },
  { key: 'disruption', name: 'Disruption',
    desc: 'Hand attacks (discard) and graveyard hate — strips the opponent\'s resources or exiles their graveyard.',
    examples: 'Thoughtseize, Inquisition of Kozilek, Duress, Surgical Extraction, Rest in Peace' },
  { key: 'protection', name: 'Protection',
    desc: 'Hexproof, indestructible, shroud, ward, or damage prevention — shields your board or your life from harm.',
    examples: 'Heroic Intervention, Lightning Greaves, Mother of Runes, Teferi\'s Protection' },
  { key: 'tokens',     name: 'Token Generation',
    desc: 'Creates token creatures or non-creature tokens (treasure, clues) as go-wide threats, blockers, or mana.',
    examples: 'Young Pyromancer, Lingering Souls, Secure the Wastes, Hordeling Outburst, Smothering Tithe' }
];

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

  if (o && oracleText.includes('{' + c + '}')) {
    ['W', 'U', 'B', 'R', 'G', 'C'].forEach(c => {
      if (oracleText.includes('{' + c + '}')) res.add(c);
    });
  }

  return Array.from(res);
}

// ── CREATURE SUBTYPES ───────────────────────────────────────────────────

const CARD_TYPES = new Set([
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
    if (!clean || CARD_TYPES.has(clean.toLowerCase())) return;
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