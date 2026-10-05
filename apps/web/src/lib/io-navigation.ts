export type IoNavSheet = {
  filename: string;
  title?: string;
  engineeringModel?: {
    crossReferences?: {
      signal?: string;
      address?: string;
      targetIdentifier?: string;
      targetSheet?: string;
    }[];
  };
};

export type IoNavRecord = {
  ioType: string;
  channel?: string;
  slave?: string;
  deviceTag?: string;
  rawIoTag: string;
  loopTag?: string;
  description?: string;
  cadFile?: string;
  destinationCads: string[];
};

export type IoNavLink = {
  file: string;
  title?: string;
  reason: string;
};

export type IoNavHit = {
  label: string;
  ioType?: string;
  channel?: string;
  slave?: string;
  deviceTag?: string;
  loopTag?: string;
  description?: string;
  links: IoNavLink[];
};

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();

function sheetOf(token: string | undefined, sheets: IoNavSheet[]): IoNavSheet | undefined {
  if (!token) return undefined;
  const t = token.replace(/\.CAD$/i, "").toUpperCase();
  return sheets.find((s) => s.filename.replace(/\.CAD$/i, "").toUpperCase() === t);
}

function addLink(hit: IoNavHit, link: IoNavLink) {
  if (hit.links.some((l) => norm(l.file) === norm(link.file))) return;
  hit.links.push(link);
}

/**
 * Index of AI/AO/DI/DO labels drawn on the sheets. A click on one of these
 * labels resolves to the other CAD files that carry the same point.
 */
export function buildIoIndex(sheets: IoNavSheet[], records: IoNavRecord[]): Map<string, IoNavHit> {
  const index = new Map<string, IoNavHit>();

  const touch = (key: string | undefined, seed: Omit<IoNavHit, "links">): IoNavHit | null => {
    if (!key) return null;
    const k = norm(key);
    if (k.length < 4) return null;
    let hit = index.get(k);
    if (!hit) {
      hit = { ...seed, label: key.trim(), links: [] };
      index.set(k, hit);
    } else {
      hit.ioType ??= seed.ioType;
      hit.channel ??= seed.channel;
      hit.slave ??= seed.slave;
      hit.deviceTag ??= seed.deviceTag;
      hit.loopTag ??= seed.loopTag;
      hit.description ??= seed.description;
    }
    return hit;
  };

  for (const r of records) {
    if (!/^(AI|AO|DI|DO)$/.test(r.ioType)) continue;
    const home = sheetOf(r.cadFile, sheets);
    const seed = {
      label: r.rawIoTag,
      ioType: r.ioType,
      channel: r.channel,
      slave: r.slave,
      deviceTag: r.deviceTag,
      loopTag: r.loopTag,
      description: r.description,
    };
    const keys = [r.rawIoTag, r.deviceTag, r.loopTag];
    const hits = keys.map((k) => touch(k, seed)).filter((h): h is IoNavHit => Boolean(h));
    if (home) {
      for (const hit of hits) {
        addLink(hit, { file: home.filename, title: home.title, reason: `${r.ioType} sheet` });
      }
    }
    for (const dest of r.destinationCads) {
      const sheet = sheetOf(dest, sheets);
      if (!sheet) continue;
      for (const hit of hits) {
        addLink(hit, {
          file: sheet.filename,
          title: sheet.title,
          reason: "Cross-CAD reference",
        });
      }
    }
  }

  for (const sheet of sheets) {
    for (const x of sheet.engineeringModel?.crossReferences ?? []) {
      const target = sheetOf(x.targetSheet, sheets);
      if (!target || norm(target.filename) === norm(sheet.filename)) continue;
      const reason = x.address ? `Reference ${x.address}` : "Cross-sheet reference";
      for (const key of [x.signal, x.address, x.targetIdentifier]) {
        const hit = touch(key, { label: (key ?? "").trim() });
        if (hit) addLink(hit, { file: target.filename, title: target.title, reason });
        const home = touch(key, { label: (key ?? "").trim() });
        if (home) addLink(home, { file: sheet.filename, title: sheet.title, reason: "Referenced from" });
      }
    }
  }

  return index;
}

export function lookupIo(index: Map<string, IoNavHit>, text: string): IoNavHit | null {
  const k = norm(text);
  if (k.length < 4) return null;
  return index.get(k) ?? null;
}

export function linksFromSheet(hit: IoNavHit, currentFile: string | null): IoNavLink[] {
  const cur = currentFile ? norm(currentFile) : "";
  return hit.links.filter((l) => norm(l.file) !== cur);
}
