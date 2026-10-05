// Accuracy of the generated M10 IO list.
//
// Device tags, addresses and slave sheets must be exactly what I90XREF.OUT says,
// and every loop tag must be a label that exists in the CAD. The engineering IO
// list (Excel) is then compared point by point, keyed by IO address. Where the
// Excel disagrees with the OUT/CAD sources the difference is pinned below with
// the reason; any other difference fails the test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { IoRecord } from "@infi90/core";
import { canonicalLoopTag } from "./loop-tags";
import { parseOutFile } from "./out";
import { processExtractedDir } from "./pipeline";
import { normalizeTag, parseTagMap, type TagMapEntry } from "./tag-map";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const M10 = path.join(root, "tools/fc-manual/cache/m10");
const OUT = path.join(M10, "M10/I90XREF.OUT");
const LIST = path.join(root, "Guiding Material/Test 2 Data - CAD/Expected Output - IO List.xls");

/** Addresses the Excel lists that the OUT file assigns to no point (or to another channel). */
const ONLY_IN_EXCEL: Record<string, string> = {
  "AI|4|14": "OUT has 131SC-109 at AI14-SL3, not a slave 4 point",
  "AI|14|1": "OUT has 131ST-M110 at channel 5",
  "AO|16|8": "OUT has 131SY-M505 at channel 9",
  "AO|16|11": "OUT has 131HV136 at channel 12",
  "DI|17|9": "no such point in OUT",
  "DI|17|12": "no such point in OUT",
  "DI|20|15": "no such point in OUT",
  "AO|46|1": "OUT has 431LV-247 at AO4-16",
};

/** Points in the OUT file that the Excel omits or lists at another address. */
const ONLY_IN_OUT: Record<string, string> = {
  "AI|3|14": "AI14-SL3/131SC-109",
  "AI|14|5": "AI5-SL14/131ST-M110",
  "AO|16|12": "AO12-16/131HV136",
  "AO|16|9": "AO9-16/131SY-M505",
  "DI|25|15": "DI7-25B/131XS-M330f",
  "DI|31|1": "DI1-31A/131XS-M204rf (Excel lists it at DI|31|15)",
  "DI|31|11": "DI3-31B/131XS-SPARE",
  "DI|36|11": "DI3-36B/131XS-SPARE",
};

/** Device tags where the Excel text differs from the OUT beyond dash/zero formatting. */
const DEVICE_DIFFS: Record<string, string> = {
  "AI|3|3": "Excel 131AT-254, OUT 131CT-254",
  "DI|5|15": "Excel spells 'alarm', OUT 'alrm'",
  "DI|6|11": "Excel spells 'alarm', OUT 'alrm'",
  "DI|6|13": "OUT has the typo 13WT102",
  "DI|6|15": "Excel adds an M: 131XS-M102",
  "AO|15|2": "Excel 131SC-M122, OUT 131SY-M117",
  "AO|16|4": "OUT area 431, Excel 131",
  "AO|16|7": "Excel drops the M: 131SY-146",
  "DI|20|4": "Excel adds an M: 131XS-M103alrm",
  "DI|20|6": "Excel adds an M: 131XS-M103",
  "DI|20|14": "Excel adds an M: 131XS-M103",
  "AI|21|9": "Excel typo 1313LT-301",
  "AI|21|13": "Excel 131TT-412, OUT 131WT0412",
  "AI|22|10": "Excel 131PT-0450, OUT 131PT0380",
  "AI|22|14": "Excel typo 131T-M421",
  "AI|23|14": "Excel joins the pair with '/', OUT with ','",
  "DI|26|11": "Excel leaves the spare unnamed",
  "DO|29|4": "Excel 131XY-M418mc, OUT 131HS-M418",
  "DO|29|5": "Excel leaves the spare unnamed",
  "DO|29|8": "Excel drops the M: 131XY-509Amc",
  "DI|31|15": "Excel 131XS-M204rf, OUT 131XS-M417lsp",
  "DO|38|6": "Excel drops the M: 131XY-346mc",
  "DO|38|7": "Excel uses a capital I in 'le'",
};

/** Loop tags where the CAD drawing does not support the Excel value. */
const LOOP_DIFFS: Record<string, string> = {
  "AI|3|2": "CAD labels the loop 131AI-104; 131AC-104C is not drawn",
  "AI|3|3": "device is 131CT-254 in the OUT, CAD labels it 131CI-254",
  "AI|4|3": "CAD wiring reaches 131AC-211A; 131AI-211A is not drawn",
  "DI|5|15": "CAD labels 131XA-107; 131WA-M107 is not drawn",
  "DI|7|12": "CAD labels 131HS-M104; 131FS-109 is not on the device's sheets",
  "DO|10|10": "CAD labels 131HS-M110; 131HS-M110A is not drawn",
  "DO|13|2": "CAD label reads 151HS-157",
  "DO|13|4": "CAD labels 131HS-180B",
  "AI|14|4": "CAD labels 131II-M105 (Excel drops the M)",
  "AI|14|6": "CAD labels 131II-M110 (Excel drops the M)",
  "AI|14|8": "CAD labels 131II-M508; 131NI-258 is not drawn",
  "AO|15|2": "OUT device is 131SY-M117, CAD loop 131SC-M117",
  "AO|16|4": "CAD label reads 131LC-247",
  "DI|17|5": "CAD labels 131HS-M110; 131HS-M110A is not drawn",
  "DI|17|6": "CAD labels 131HS-M110; 131HS-M110A is not drawn",
  "DI|17|7": "CAD labels 131HS-M110; 131HS-M110A is not drawn",
  "DI|19|1": "CAD wiring reaches 131LSH-556; 131LAH-556 is not drawn",
  "DI|19|5": "CAD labels 131HS-M112; Excel transposes to M211",
  "DI|20|4": "CAD label reads 131WA-103",
  "DI|20|9": "131XS-004 is not drawn; no loop label reaches 131UPS-102",
  "AI|21|6": "CAD labels 131FI-550; 131LI-550 is not drawn",
  "AI|21|7": "CAD labels 131FI-551; 131LI-551 is not drawn",
  "DI|26|10": "CAD labels 131HS-M342; Excel has 131HS-M302",
  "DI|26|11": "spare point, no loop label in CAD",
  "DI|28|13": "CAD labels 131HS-M401; Excel has 131HS-M509A",
  "DI|28|15": "low switch 131LSL411A is labelled 131LAL-411A in CAD",
  "DO|29|5": "spare point, no loop label in CAD",
  "DO|29|15": "CAD labels 131HS-M342; Excel has 131HS-385",
  "DI|31|7": "CAD labels 131HS-M342; 131XI-M342A is not drawn",
  "DI|31|12": "CAD labels 131HS-M341; 131XI-M341A is not drawn",
  "DI|31|15": "OUT device here is 131XS-M417lsp, CAD loop 131HS-M417",
  "DI|33|14": "CAD wires 131XS-M420 as its own loop label",
  "DO|43|2": "CAD sheet mislabels this loop 131XS-M407; 131XS-M417 is not drawn",
};

const num = (s?: string) => Number(/(\d+)/.exec(s ?? "")?.[1] ?? NaN);

function addressOf(r: IoRecord): string {
  let ch = num(r.channel);
  if (/\d+B$/i.test(r.slave ?? "")) ch += 8;
  return `${r.ioType}|${num(r.slave)}|${ch}`;
}

/** Excel writes 131FT0427 as 131FT-427; both name the same device. */
const formatFree = (t: string) =>
  normalizeTag(t).replace(/([A-Z])0+(\d)/g, "$1$2");

function sameDevice(e: TagMapEntry, device: string): boolean {
  return [e.deviceTag, ...e.aliases].some((a) => formatFree(a) === formatFree(device));
}

describe("IO list accuracy (M10)", { skip: !(fs.existsSync(OUT) && fs.existsSync(LIST)) && "M10 data not present" }, () => {
  const project = processExtractedDir(M10);
  const records = project.ioRecords;

  it("lists every physical IO point of I90XREF.OUT exactly once", () => {
    const text = fs.readFileSync(OUT, "latin1");
    const points = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*((?:AI|AO|DI|DO)\d+-\S+)/i.exec(line);
      if (m) points.add(m[1].toUpperCase());
    }
    const listed = records.map((r) => r.rawIoTag.toUpperCase());
    assert.equal(new Set(listed).size, listed.length, "duplicate IO rows");
    assert.deepEqual([...listed].sort(), [...points].sort());
  });

  it("takes type, channel, slave and device tag verbatim from the IO tag", () => {
    const re = /^(AI|AO|DI|DO)(\d+)-(?:SL)?(\d+)([AB]?)\/(.*)$/i;
    for (const r of records) {
      const m = re.exec(r.rawIoTag);
      assert.ok(m, r.rawIoTag);
      assert.equal(r.ioType, m[1].toUpperCase(), r.rawIoTag);
      assert.equal(num(r.channel), Number(m[2]), r.rawIoTag);
      assert.equal(num(r.slave), Number(m[3]), r.rawIoTag);
      assert.equal(/([AB])$/i.exec(r.slave ?? "")?.[1]?.toUpperCase() ?? "", m[4].toUpperCase(), r.rawIoTag);
      assert.equal(r.deviceTag, m[5], r.rawIoTag);
    }
  });

  it("places each point on its IO slave sheet when the OUT lists it there", () => {
    const listedOn = new Map<string, Set<string>>();
    for (const e of parseOutFile(fs.readFileSync(OUT)).entries) {
      const k = e.description.split(/\s+/)[0].toUpperCase();
      if (!listedOn.has(k)) listedOn.set(k, new Set());
      listedOn.get(k)!.add(e.cadFile.toUpperCase());
    }
    for (const r of records) {
      const sheets = listedOn.get(r.rawIoTag.toUpperCase());
      assert.ok(sheets, r.rawIoTag);
      assert.ok(sheets.has(r.cadFile!.toUpperCase()), `${r.rawIoTag} on ${r.cadFile}`);
      const slaveSheet = [...sheets].find((f) =>
        new RegExp(`^\\d{5}${String(num(r.slave)).padStart(2, "0")}C\\.CAD$`).test(f)
      );
      if (slaveSheet) assert.equal(r.cadFile!.toUpperCase(), slaveSheet, r.rawIoTag);
    }
  });

  it("only uses loop tags that are drawn as labels in the CAD", () => {
    const drawn = new Set<string>();
    for (const s of project.cadSheets) {
      for (const a of s.engineeringModel?.annotations ?? []) {
        const t = canonicalLoopTag(a.text);
        if (t) drawn.add(t);
      }
    }
    for (const r of records) {
      if (!r.loopTag) continue;
      assert.ok(drawn.has(r.loopTag), `${r.rawIoTag}: ${r.loopTag}`);
      assert.equal(r.loopTagSource, "CAD_LABEL");
      assert.ok(r.loopTagNote, r.rawIoTag);
    }
  });

  it("describes each point with the page description of its loop-tag sheet", () => {
    const sheets = new Map(project.cadSheets.map((s) => [s.filename.toUpperCase(), s]));
    for (const r of records) {
      if (!r.loopTag) {
        assert.equal(r.description, undefined, r.rawIoTag);
        continue;
      }
      const loopSheet = sheets.get(r.loopTagNote!.split(/[\s,]/)[0].toUpperCase());
      assert.ok(loopSheet, r.rawIoTag);
      assert.equal(r.description, loopSheet.pageDescription, r.rawIoTag);
      assert.ok(!/SLAVE/.test(r.description ?? ""), `${r.rawIoTag}: slave-sheet title used`);
      assert.ok(r.descriptionNote, r.rawIoTag);
    }
    const byTag = new Map(records.map((r) => [r.rawIoTag, r]));
    assert.equal(byTag.get("AI1-3/131LT103")?.description, "HcL AND NaOH TANK LEVEL");
    // Two title lines, read top to bottom, internal spacing kept.
    assert.equal(byTag.get("AI3-3/131CT-254")?.description, "STORM DRAIN pH  AND PRIM EFFLUENT INLET CONDUCT.");
    assert.equal(byTag.get("DI7-SL25A/131AUX-M418")?.description, undefined);
    assert.match(byTag.get("DI7-SL25A/131AUX-M418")!.descriptionNote!, /no library-defined title block/);
  });

  it("matches the engineering IO list except for pinned source discrepancies", () => {
    const map = parseTagMap(fs.readFileSync(LIST), path.basename(LIST))!;
    const expected = new Map<string, TagMapEntry>();
    for (const e of map.entries) {
      if (e.address && e.ioType) expected.set(`${e.ioType}|${e.address.slave}|${e.address.channel}`, e);
    }
    // The OUT can wire two devices to one channel (AI14-23); the Excel lists them as a pair.
    const ours = new Map<string, IoRecord[]>();
    for (const r of records) {
      const k = addressOf(r);
      if (!ours.has(k)) ours.set(k, []);
      ours.get(k)!.push(r);
    }

    const found = { excel: new Set<string>(), out: new Set<string>(), device: new Set<string>(), loop: new Set<string>() };
    const unexpected: string[] = [];
    let loopAgree = 0;
    for (const [k, e] of expected) {
      const rs = ours.get(k);
      if (!rs) {
        found.excel.add(k);
        if (!(k in ONLY_IN_EXCEL)) unexpected.push(`${k} only in Excel: ${e.deviceTag}`);
        continue;
      }
      if (!rs.some((r) => sameDevice(e, r.deviceTag ?? ""))) {
        found.device.add(k);
        if (!(k in DEVICE_DIFFS)) unexpected.push(`${k} device: Excel ${e.deviceTag}, generated ${rs.map((r) => r.deviceTag)}`);
      }
      const want = canonicalLoopTag(e.loopTag) ?? e.loopTag.toUpperCase();
      if (rs.some((r) => r.loopTag === want)) loopAgree++;
      else {
        found.loop.add(k);
        if (!(k in LOOP_DIFFS)) unexpected.push(`${k} loop: Excel ${e.loopTag}, generated ${rs.map((r) => r.loopTag ?? "(none)")}`);
      }
    }
    for (const [k, rs] of ours) {
      if (expected.has(k)) continue;
      found.out.add(k);
      if (!(k in ONLY_IN_OUT)) unexpected.push(`${k} only in OUT: ${rs[0].rawIoTag}`);
    }

    assert.deepEqual(unexpected, []);
    const stale = [
      ...Object.keys(ONLY_IN_EXCEL).filter((k) => !found.excel.has(k)),
      ...Object.keys(ONLY_IN_OUT).filter((k) => !found.out.has(k)),
      ...Object.keys(DEVICE_DIFFS).filter((k) => !found.device.has(k)),
      ...Object.keys(LOOP_DIFFS).filter((k) => !found.loop.has(k)),
    ];
    assert.deepEqual(stale, [], "pinned discrepancies that now agree; remove them");
    assert.ok(loopAgree >= 385, `loop agreement ${loopAgree}`);
  });
});
