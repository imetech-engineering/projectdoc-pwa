/**
 * Minimale ZIP-lezer/schrijver voor .docx, zonder externe pakketten.
 *
 * Belangrijk voor documentbehoud: van alle onderdelen die we niet aanpassen
 * bewaren we de *gecomprimeerde bytes ongewijzigd*. Alleen word/document.xml
 * wordt opnieuw ingepakt. Daardoor blijven afbeeldingen, stijlen, thema's en
 * nummeringen exact zoals Word ze heeft weggeschreven.
 */
"use strict";

const zlib = require("node:zlib");

const CRC_TABEL = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABEL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Leest een zip. Metadata komt uit de centrale directory (die is leidend);
 * de lokale header gebruiken we alleen om te bepalen waar de data begint,
 * want naam- en extra-veldlengtes verschillen daar regelmatig van.
 */
function leesZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Geen zip-einde gevonden — is dit wel een .docx?");

  const aantal = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error("Zip64-bestanden worden niet ondersteund");

  const onderdelen = [];
  let p = cdOffset;
  for (let i = 0; i < aantal; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Beschadigde zip-directory");
    const vlaggen = buf.readUInt16LE(p + 8);
    const methode = buf.readUInt16LE(p + 10);
    const modTijd = buf.readUInt16LE(p + 12);
    const modDatum = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const compGrootte = buf.readUInt32LE(p + 20);
    const ruweGrootte = buf.readUInt32LE(p + 24);
    const naamLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externeAttr = buf.readUInt32LE(p + 38);
    const lokaalOffset = buf.readUInt32LE(p + 42);
    const naam = buf.toString("utf8", p + 46, p + 46 + naamLen);

    const lokaalNaamLen = buf.readUInt16LE(lokaalOffset + 26);
    const lokaalExtraLen = buf.readUInt16LE(lokaalOffset + 28);
    const dataStart = lokaalOffset + 30 + lokaalNaamLen + lokaalExtraLen;

    onderdelen.push({
      naam,
      vlaggen,
      methode,
      modTijd,
      modDatum,
      crc,
      ruweGrootte,
      externeAttr,
      data: buf.subarray(dataStart, dataStart + compGrootte),
    });
    p += 46 + naamLen + extraLen + commentLen;
  }
  return onderdelen;
}

/** Pakt één onderdeel uit naar bytes. */
function pakUit(onderdeel) {
  if (onderdeel.methode === 0) return Buffer.from(onderdeel.data);
  if (onderdeel.methode === 8) return zlib.inflateRawSync(onderdeel.data);
  throw new Error(`Onbekende compressiemethode ${onderdeel.methode} voor ${onderdeel.naam}`);
}

/** Vervangt de inhoud van één onderdeel; de rest blijft byte-voor-byte gelijk. */
function vervangOnderdeel(onderdelen, naam, nieuweBytes) {
  return onderdelen.map((o) => {
    if (o.naam !== naam) return o;
    const gecomprimeerd = zlib.deflateRawSync(nieuweBytes, { level: 9 });
    return {
      ...o,
      // Bit 3 (data descriptor) uit: we schrijven de groottes zelf in de header.
      vlaggen: o.vlaggen & ~0x0008,
      methode: 8,
      crc: crc32(nieuweBytes),
      ruweGrootte: nieuweBytes.length,
      data: gecomprimeerd,
    };
  });
}

function schrijfZip(onderdelen) {
  const stukken = [];
  const directory = [];
  let offset = 0;

  for (const o of onderdelen) {
    const naam = Buffer.from(o.naam, "utf8");
    const lokaal = Buffer.alloc(30 + naam.length);
    lokaal.writeUInt32LE(0x04034b50, 0);
    lokaal.writeUInt16LE(20, 4);
    lokaal.writeUInt16LE(o.vlaggen & ~0x0008, 6);
    lokaal.writeUInt16LE(o.methode, 8);
    lokaal.writeUInt16LE(o.modTijd, 10);
    lokaal.writeUInt16LE(o.modDatum, 12);
    lokaal.writeUInt32LE(o.crc, 14);
    lokaal.writeUInt32LE(o.data.length, 18);
    lokaal.writeUInt32LE(o.ruweGrootte, 22);
    lokaal.writeUInt16LE(naam.length, 26);
    lokaal.writeUInt16LE(0, 28);
    naam.copy(lokaal, 30);

    const cd = Buffer.alloc(46 + naam.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(o.vlaggen & ~0x0008, 8);
    cd.writeUInt16LE(o.methode, 10);
    cd.writeUInt16LE(o.modTijd, 12);
    cd.writeUInt16LE(o.modDatum, 14);
    cd.writeUInt32LE(o.crc, 16);
    cd.writeUInt32LE(o.data.length, 20);
    cd.writeUInt32LE(o.ruweGrootte, 24);
    cd.writeUInt16LE(naam.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(o.externeAttr >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    naam.copy(cd, 46);

    stukken.push(lokaal, o.data);
    directory.push(cd);
    offset += lokaal.length + o.data.length;
  }

  const cdBuf = Buffer.concat(directory);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(onderdelen.length, 8);
  eocd.writeUInt16LE(onderdelen.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...stukken, cdBuf, eocd]);
}

module.exports = { leesZip, pakUit, vervangOnderdeel, schrijfZip, crc32 };
