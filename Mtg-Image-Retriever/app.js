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
      const batch = await lookupBatch(chunk);

      for (const identifier of chunk) {
        const card = batch.found.get(identifier.id);
        if (card) found.set(identifier.id, card);
        else notFound.push(identifier);
      }

    if (chunks.length > 1) await sleep(DELAY_MS);
    }

    render(identifiers, found, notFound);
    statusEl.textContent = `Done — ${found.size} found, ${notFound.length} not found.`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    if (err instanceof TypeError) {
      statusEl.textContent += " — check your internet connection, or open this page from github.io (file:// pages cannot reach the Scryfall API).";
    }
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

  const found = new Map();
  for (const card of json.data || []) {
    found.set(cardKey(card.name, card.set), card);
  }
  const notFound = new Map();
  for (const miss of json.not_found || []) {
    notFound.set(cardKey(miss.name, miss.set), miss);
  }

  return { found, notFound };
}

function cardKey(name, set) {
  return `${String(name || "").toLowerCase()}|${String(set || "").toLowerCase()}`;
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
  document.getElementById("results-title").textContent =
    `Results (${found.size} found, ${notFound.length} not found)`;

  const csvLines = identifiers.map((identifier) => {
    const match = found.get(identifier.id);
    const url = match ? imageUrl(match) : "";
    const set = identifier.set ? identifier.set.toUpperCase() : "";
    const name = String(identifier.name).replace(/"/g, '""');
    return `"${name}",${set},${url}`;
  });

  const csvEl = document.getElementById("csv-output");
  csvEl.textContent = csvLines.join("\n");

  const copyBtn = document.getElementById("copy-csv");
  copyBtn.hidden = false;
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(csvEl.textContent);
    } catch {
      csvEl.select();
      document.execCommand("copy");
    }
    const prev = copyBtn.textContent;
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = prev), 1500);
  };

  resultsEl.hidden = false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}