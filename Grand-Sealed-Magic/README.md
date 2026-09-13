# Grand Sealed Magic

A lightweight tool for visualizing a limited Magic: The Gathering pool. Paste a card list (or load a `.txt`/`.csv` pool file), and cards are fetched in one bulk request from the [Scryfall API](https://scryfall.com/docs/api) and displayed in groupable grids.

## Pages

- `index.html` — the app itself (single-file HTML, no build step).

## Usage

Open `index.html`, paste a pool list (one card per line), and press **Load Pool** (or Ctrl+Enter). Try the **Use sample pool** button to see it in action.

Pool list format (`#` comments are ignored):

```
2 Plains
1 Lightning Bolt
2x Grizzly Bears
2,Serra Angel         # CSV-style "qty,name" also works
```

## Pool files

Drop seed/original pool files next to `index.html` and list them in `pools.json`:

```json
{
  "pools": [
    { "name": "My sealed pool", "file": "my-sealed-pool.txt" }
  ]
}
```

They appear in the **Saved Pools** dropdown. Plain text (`.txt`) uses the format above; `.csv` files use `qty,name` rows. The **Browse local file…** button loads any `.txt`/`.csv` from disk. Note: the dropdown reads `pools.json` over HTTP (e.g. on GitHub Pages); when opening `index.html` directly from disk, use the browse button instead.

## Features

- Load a pool by card name; quantities supported (`2x Serra Angel`, `2 Serra Angel`, `2,Serra Angel`).
- Cards resolve via Scryfall's bulk lookup (up to 75 names per request), falling back to per-card exact/fuzzy search for any misses.
- Group the pool by **Color**, **Mana Value**, **Card Type**, **Set**, or **Rarity**.
- Sort cards within a group, search/filter by name, type, ability, or set.
- Pool stats: total/unique counts, average mana value, and color pip breakdown.
- Click any card for a detail view (art, oracle text, set, rarity, price).
- Your pool is remembered in the browser for next time.

Card data and images are fetched live from [Scryfall](https://scryfall.com/docs/api). Everything runs client-side; no server needed.

Grand Sealed Magic is a fan tool. Magic: The Gathering is © Wizards of the Coast.