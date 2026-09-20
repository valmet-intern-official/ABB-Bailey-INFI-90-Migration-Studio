/**
 * Module-prefix registry.
 *
 * A reference address is `<modulePrefix:2><sheetSuffix:2>-<block:2>.<port:2>`.
 * The sheet suffix names the target drawing, but the loop prefix and revision
 * letter that complete the filename come from the module prefix — a reference
 * can point into a different loop entirely:
 *
 *   AH65-06.07 on sheet 2121009A  ->  2120565A   (not 2121065A)
 *   AGZ2-08.03 on sheet 2121070A  ->  21110Z2A
 *   AA72-01.07 on sheet 2121072A  ->  2030572C
 *
 * The mapping is not stored in the records, but it is fully determined by the
 * archive: for a given module prefix, only one (loopPrefix, revision) pair
 * makes the referenced sheet suffixes resolve to drawings that actually exist.
 * This registry recovers the mapping by that constraint, so cross-sheet
 * resolution needs no external report.
 */

export interface ModuleCandidate {
  loopPrefix: string;
}

export interface ModuleResolution extends ModuleCandidate {
  /** Fraction of referenced suffixes that resolve to an existing drawing. */
  score: number;
  /** How many distinct sheet suffixes supported this choice. */
  support: number;
}

/**
 * Learns `modulePrefix -> (loopPrefix, revision)` from the set of drawing
 * names in the archive plus the references those drawings contain.
 */
export class ModuleRegistry {
  /** Uppercase stems of every drawing available, e.g. `30705D6A`. */
  private readonly stems = new Set<string>();
  /** modulePrefix -> set of referenced sheet suffixes. */
  private readonly observed = new Map<string, Set<string>>();
  private readonly resolved = new Map<string, ModuleResolution>();
  private dirty = true;

  /** Register a drawing that exists in the archive. */
  addSheet(filename: string) {
    const stem = filename.replace(/\.[A-Z0-9]+$/i, "").toUpperCase();
    if (stem.length >= 8) this.stems.add(stem);
    this.dirty = true;
  }

  /** Register a reference seen on a sheet. */
  addReference(modulePrefix: string, sheetSuffix: string) {
    const p = modulePrefix.trim().toUpperCase();
    const s = sheetSuffix.trim().toUpperCase();
    if (p.length !== 2 || s.length !== 2) return;
    let set = this.observed.get(p);
    if (!set) {
      set = new Set();
      this.observed.set(p, set);
    }
    set.add(s);
    this.dirty = true;
  }

  /**
   * `loopPrefix + sheetSuffix` -> full stem. The revision letter varies per
   * drawing (`21210Q7Q` sits alongside `21210Q6A`), so it is looked up rather
   * than assumed to be constant within a module.
   */
  private readonly byLoopAndSuffix = new Map<string, string>();

  /** Distinct loop prefixes present in the archive. */
  private candidates(): ModuleCandidate[] {
    const out = new Set<string>();
    for (const stem of this.stems) out.add(stem.slice(0, 5));
    return [...out].map((loopPrefix) => ({ loopPrefix }));
  }

  private build() {
    if (!this.dirty) return;
    this.resolved.clear();
    this.byLoopAndSuffix.clear();
    for (const stem of this.stems) {
      this.byLoopAndSuffix.set(stem.slice(0, 7), stem);
    }
    const cands = this.candidates();

    for (const [prefix, suffixes] of this.observed) {
      let best: ModuleResolution | undefined;
      let runnerUp = 0;
      for (const c of cands) {
        let hits = 0;
        for (const s of suffixes) {
          if (this.byLoopAndSuffix.has(`${c.loopPrefix}${s}`)) hits++;
        }
        const score = suffixes.size === 0 ? 0 : hits / suffixes.size;
        // Ties are broken by support, so a prefix seen referencing many
        // sheets outweighs a coincidental single-sheet match.
        if (!best || score > best.score || (score === best.score && hits > best.support)) {
          if (best) runnerUp = Math.max(runnerUp, best.support);
          best = { ...c, score, support: hits };
        } else {
          runnerUp = Math.max(runnerUp, hits);
        }
      }
      // Only accept a mapping that is both well supported and clearly better
      // than the next candidate. A weakly supported guess would silently
      // redirect real signals to the wrong drawing, which is worse than
      // reporting the reference as unresolved.
      if (
        best &&
        best.support >= ModuleRegistry.MIN_SUPPORT &&
        best.score >= ModuleRegistry.MIN_SCORE &&
        best.support > runnerUp
      ) {
        this.resolved.set(prefix, best);
      }
    }
    this.dirty = false;
  }

  /** Distinct sheet suffixes a prefix must explain before it is trusted. */
  static readonly MIN_SUPPORT = 40;
  static readonly MIN_SCORE = 0.98;

  resolve(modulePrefix: string): ModuleResolution | undefined {
    this.build();
    return this.resolved.get(modulePrefix.trim().toUpperCase());
  }

  /** Full target filename for a reference, or undefined when unknown. */
  targetFor(modulePrefix: string, sheetSuffix: string): string | undefined {
    const m = this.resolve(modulePrefix);
    if (!m) return undefined;
    const stem = this.byLoopAndSuffix.get(
      `${m.loopPrefix}${sheetSuffix.trim().toUpperCase()}`
    );
    return stem ? `${stem}.CAD` : undefined;
  }

  get stats() {
    this.build();
    return {
      sheets: this.stems.size,
      prefixes: this.observed.size,
      resolvedPrefixes: this.resolved.size,
    };
  }

  /** Inspectable mapping, for reporting and documentation. */
  entries(): Array<{ prefix: string } & ModuleResolution> {
    this.build();
    return [...this.resolved].map(([prefix, r]) => ({ prefix, ...r }));
  }
}
