/**
 * Eén ingang voor een projectdocument, of het nu Markdown (nieuw) of Word (oud) is.
 *
 *   const doc = projectdoc.open(pad);
 *   doc.header()            -> [{label, waarde}]
 *   doc.entries(max)        -> [{datum, kop, blokken}]
 *   doc.tekst()             -> platte tekst voor Claude
 *   doc.bestellingen()      -> [{datum, leverancier, ordernr, wat, bedrag, status}]
 *   doc.zetHeader(l, w)     -> true/false
 *   doc.voegEntryToe(entry)
 *   doc.voegBestellingToe(b)
 *   doc.bewaar([pad])
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const docx = require("./docx");
const md = require("./md");

function isMd(pad) {
  return /\.md$/i.test(pad);
}

function openMd(pad) {
  let tekst = fs.readFileSync(pad, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  return {
    soort: "md",
    header: () => md.headerVelden(tekst),
    entries: (max) => md.logboekEntries(tekst, max),
    tekst: () => tekst,
    bestellingen: () => md.bestellingen(tekst),
    zetHeader(label, waarde) {
      const uit = md.zetHeaderWaarde(tekst, label, waarde);
      if (uit == null) return false;
      tekst = uit;
      return true;
    },
    voegEntryToe(entry) {
      tekst = md.voegEntryToe(tekst, entry);
    },
    voegBestellingToe(b) {
      tekst = md.voegBestellingToe(tekst, b);
    },
    bewaar(doel = pad) {
      // eerst naast het bestand schrijven en dan hernoemen: nooit een half bestand in OneDrive
      const tmp = path.join(path.dirname(doel), `.~${path.basename(doel)}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, tekst, "utf8");
      fs.renameSync(tmp, doel);
    },
  };
}

function openDocx(pad) {
  let { onderdelen, xml } = docx.open(pad);
  return {
    soort: "docx",
    header: () => docx.headerVelden(xml),
    entries: (max) => docx.logboekEntries(xml, max),
    tekst: () => docx.documentTekst(xml),
    bestellingen: () => [],
    zetHeader(label, waarde) {
      const uit = docx.zetHeaderWaarde(xml, label, waarde);
      if (!uit) return false;
      xml = uit;
      return true;
    },
    voegEntryToe(entry) {
      xml = docx.voegEntryToe(xml, entry);
    },
    voegBestellingToe() {
      // Word-documenten hebben geen bestellingentabel; de entry zelf noemt de bestelling al.
    },
    bewaar(doel = pad) {
      docx.bewaar(doel, onderdelen, xml);
    },
  };
}

function open(pad) {
  return isMd(pad) ? openMd(pad) : openDocx(pad);
}

/** Nieuw leeg projectdocument (altijd Markdown). */
function maakNieuw(doel, { titel, header }) {
  fs.writeFileSync(doel, md.nieuwDocument({ titel, header }), { encoding: "utf8", flag: "wx" });
}

module.exports = { open, isMd, maakNieuw };
