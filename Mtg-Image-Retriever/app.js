const API = "https://api.scryfall.com";
const BATCH_SIZE = 75;
const DELAY_MS = 75;

const form = document.getElementById("lookup-form");
const input = document.getElementById("card-input");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const lookupBtn = document.getElementById("lookup-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await run();
});

function parseLine(line) {
  if (!line.trim()) return null;

  // Tab-separated (e.g. pasted straight from a spreadsheet): name<TAB>set, qty<TAB>name<TAB>set, ...
  if (line.includes("\t")) {
    const parts = line.split("\t").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { name: parts.slice(0, -1).join(" "), set: parts[parts.length - 1] };
    }
  }

  // Comma-separated: name,set
  const csvMatch = line.match(/^([\s\S]+?)\s*,\s*(\S+)\s*$/);
  if (csvMatch) return { name: csvMatch[1].trim(), set: csvMatch[2] };

  // Space-separated: assume the last token is the set code
  const parts = line.trim().split(/\s+/);
  if (parts.length >= 2 && /^[A-Z0-9]{2,5}$/.test(parts[parts.length - 1])) {
    return { name: parts.slice(0, -1).join(" "), set: parts[parts.length - 1] };
  }

  return null;
}

async function run() {
  const lines = input.value.split(/\r?\n/);
  const identifiers = [];
  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (!parsed || !parsed.name) continue;
    const id = `${parsed.name.toLowerCase()}|${parsed.set.toLowerCase()}`;
    identifiers.push({ id, name: parsed.name, set: parsed.set });
  }

  if (identifiers.length === 0) {
    resultsEl.hidden = true;
    statusEl.textContent = "Nothing to look up.";
    return;
  }

  lookupBtn.disabled = true;
  statusEl.textContent = `Looking up ${identifiers.length} card${identifiers.length > 1 ? "s" : ""}…`;
  resultsEl.hidden = true;

  try {
    const found = new Map();
    const notFound = [];

    const chunks = [];
    for (let i = 0; i < identifiers.length; i += BATCH_SIZE) {
      chunks.push(identifiers.slice(i, i + BATCH_SIZE));
    }

    for (const chunk of chunks) {
      const data = await lookupBatch(chunk);

      for (const identifier of chunk) {
        const card = data.cards.get(identifier.id) || data.notFound.get(identifier.id);
        if (card) found.set(identifier.id, card);
        else notFound.push(identifier);
      }

    if (chunks.length > 1) await sleep(DELAY_MS);
    }

    render(identifiers, found, notFound);
    statusEl.textContent = `Done — ${found.size} found, ${notFound.length} not found.`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    lookupBtn.disabled = false;
  }
}

async function lookupBatch(identifiers) {
  const res = await fetch(`${API}/cards/collection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Image-Retriever/1.3.0 (MTG card image lookup tool)",
    },
    body: JSON.stringify({
      identifiers: identifiers.map(({ name, set }) => ({ name, set })),
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    throw new Error(json?.details || `Request failed (${res.status})`);
  }
  if (json.warnings?.length) statusEl.textContent = json.warnings[0];

  const cards = new Map();
  const notFound = new Map();

  for (const card of json.data || []) {
    const cardsIn = identifiers.find((i) => i.name.toLowerCase() === card.name.toLowerCase() && i.set === card.set);
    const id = cardsIn ? cardsIn.id : card.name.toLowerCase();
    cards.set(id, card);
  }
  for (const miss of json.not_found || []) {
    notFound.set(`${miss.name.toLowerCase()}|${(miss.set || "").toLowerCase()}`, miss);
  }

  return { cards, notFound };
}

function imageUrl(card) {
  if (card.image_uris?.png) return card.image_uris.png;
  if (card.card_faces && card.card_faces.length > 0) {
    for (const face of card.card_faces) {
      if (face.image_uris?.png) return face.image_uris.png;
    }
  }
  return null;
}

function render(identifiers, found, notFound) {
  if (identifiers.length === 0 || (found.size === 0 && notFound.length === 0)) {
    resultsEl.hidden = true;
    return;
  }

  const rows = [];
  for (const identifier of identifiers) {
    const match = found.get(identifier.id);
    if (match) {
      rows.push(renderRow(identifier, match, true));
    } else {
      rows.push(renderRow(identifier, null, false));
    }
  }

  const title = document.createElement("h2");
  title.textContent = `Results (${found.size} found, ${notFound.length} not found)`;

  const list = document.createElement("section");
  list.append(...rows);

  resultsEl.replaceChildren(title, list);
  resultsEl.hidden = false;
}

function renderRow(identifier, match, isFound) {
  const row = document.createElement("div");
  row.className = "card-row" + (isFound ? "" : " not-found");

  const info = document.createElement("div");
  info.className = "card-info";

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = identifier.name;

  const meta = document.createElement("div");
  meta.className = "card-set";
  meta.textContent = identifier.set ? identifier.set.toUpperCase() : "—";

  info.append(name, meta);

  if (isFound && match && imageUrl(match)) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = imageUrl(match);
    img.alt = identifier.name;
    img.loading = "lazy";

    const link = document.createElement("a");
    link.className = "link";
    link.href = imageUrl(match);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = imageUrl(match);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Found";

    row.prepend(img);
    row.append(info, link, badge);
  } else {
    const badge = document.createElement("span");
    badge.className = "badge not-found";
    badge.textContent = "Not found";
    row.append(info, badge);
  }

  return row;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}