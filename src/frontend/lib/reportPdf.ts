"use client";

import { jsPDF } from "jspdf";

/**
 * Client-side PDF export for bloom reports (jsPDF vector output).
 *
 * window.print() screenshots the whole page including nav/footer — this
 * builds a standalone document instead: brand header, coordinates subtitle,
 * live assessment summary, trajectory chart, model block, report sections.
 * Everything is drawn with vector primitives (no html2canvas, which breaks
 * on Tailwind v4 oklch colors).
 */

export interface ReportPdfInput {
  latitude: number;
  longitude: number;
  placeName?: string;
  fetchedAt?: string;
  provenance?: string;
  headlineRiskPct: number;
  headlineRiskLevel: string;
  rainfall48hMm: number | string;
  dryDays: number | string;
  weekTempC: number | string | null;
  weekWindMs: number | string | null;
  signals: string[];
  trajectory: Array<{ date: string; risk: number }>;
  past30d?: string | null;
  methodLine?: string | null;
  modelEstimate?: {
    pct: number;
    ciLo: number;
    ciHi: number;
    drivers: Array<{ human: string; contribution: string }>;
    trainingLine?: string | null;
    caveats?: string | null;
  } | null;
  reportText: string;
  provider?: string | null;
}

const INK = {
  bg: [2, 6, 15] as [number, number, number],
  panel: [4, 17, 31] as [number, number, number],
  line: [21, 58, 74] as [number, number, number],
  primary: [232, 251, 255] as [number, number, number],
  secondary: [159, 184, 199] as [number, number, number],
  faint: [90, 120, 136] as [number, number, number],
  cyan: [0, 240, 212] as [number, number, number],
  violet: [139, 92, 246] as [number, number, number],
  green: [0, 255, 136] as [number, number, number],
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 18;

/**
 * WinAnsi sanitize: jsPDF core fonts only encode WinAnsi, so anything
 * outside it (→ — – “ ” …) renders as mojibake like "Cause!’effect".
 * Map the common cases to ASCII twins, drop the rest. ° is WinAnsi-safe.
 */
function san(str: string): string {
  return str
    .replace(/→/g, "->")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/−/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/×/g, "x")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

function riskColor(level: string): [number, number, number] {  const l = (level ?? "").toLowerCase();
  if (l === "low") return INK.green;
  if (l === "moderate") return [255, 204, 0];
  if (l === "elevated") return [255, 136, 0];
  if (l === "high") return [255, 51, 85];
  if (l === "critical") return [255, 0, 170];
  return INK.cyan;
}

function paintBackground(doc: jsPDF) {
  doc.setFillColor(...INK.bg);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

function drawBrandMark(doc: jsPDF, x: number, y: number, s: number) {
  // Rounded dark tile + dashed cyan ring + cyan disc + highlight,
  // mirroring public/favicon.svg in vector primitives.
  doc.setFillColor(...INK.bg);
  doc.roundedRect(x, y, s, s, s * 0.22, s * 0.22, "F");
  doc.setDrawColor(...INK.cyan);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([1.2, 1.4], 0);
  doc.circle(x + s / 2, y + s / 2, s * 0.36, "D");
  doc.setLineDashPattern([], 0);
  doc.setFillColor(...INK.cyan);
  doc.circle(x + s / 2, y + s / 2, s * 0.24, "F");
  doc.setFillColor(255, 255, 255);
  doc.circle(x + s * 0.42, y + s * 0.4, s * 0.07, "F");
}

export function downloadReportPdf(input: ReportPdfInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  paintBackground(doc);
  let y = MARGIN;

  const need = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      paintBackground(doc);
      y = MARGIN;
    }
  };
  const text = (str: string, x: number, yy: number, opts?: { size?: number; color?: [number, number, number]; style?: string; font?: string }) => {
    doc.setFontSize(opts?.size ?? 9.5);
    doc.setTextColor(...(opts?.color ?? INK.primary));
    doc.setFont(opts?.font ?? "helvetica", opts?.style ?? "normal");
    doc.text(san(str), x, yy);
  };
  const wrapped = (str: string, maxW: number, size = 9.5): string[] =>
    doc.splitTextToSize(san(str), maxW) as string[];
  const paragraph = (str: string, size = 9.5, color: [number, number, number] = INK.secondary, gap = 4.5, align: "left" | "center" = "left", style = "normal") => {
    const lines = wrapped(str, CONTENT_W, size);
    need(lines.length * gap + 2);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.setFont("helvetica", style);
    if (align === "center") doc.text(lines, PAGE_W / 2, y, { align: "center" });
    else doc.text(lines, MARGIN, y);
    y += lines.length * gap + 2;
  };
  const kicker = (str: string) => {
    need(10);
    text(str, MARGIN, y + 4, { size: 8, color: INK.cyan, style: "bold", font: "courier" });
    y += 9;
  };

  // ---- Header ----
  drawBrandMark(doc, MARGIN, y, 14);
  text("BloomCast", MARGIN + 18, y + 8, { size: 20, style: "bold" });
  text("Predictive freshwater intelligence", MARGIN + 18, y + 13, { size: 8.5, color: INK.secondary });
  doc.setFontSize(8);
  doc.setTextColor(...INK.faint);
  doc.setFont("courier", "normal");
  const stamp = input.fetchedAt ?? new Date().toISOString();
  doc.text("BLOOM ASSESSMENT", PAGE_W - MARGIN, y + 5, { align: "right" });
  doc.text(stamp.slice(0, 16).replace("T", " "), PAGE_W - MARGIN, y + 10, { align: "right" });
  y += 19;
  doc.setDrawColor(...INK.cyan);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 7;

  // ---- Subtitle: place + coordinates ----
  text(input.placeName ?? "Picked point", MARGIN, y, { size: 13, style: "bold" });
  y += 6;
  text(`${input.latitude.toFixed(2)}°, ${input.longitude.toFixed(2)}`, MARGIN, y, { size: 11, color: INK.cyan, font: "courier" });
  y += 8;

  // ---- Live assessment ----
  kicker("LIVE ASSESSMENT");
  const rc = riskColor(input.headlineRiskLevel);
  text(`${Math.round(input.headlineRiskPct)}%`, MARGIN, y + 8, { size: 26, style: "bold", color: rc });
  const levelLabel = (input.headlineRiskLevel ?? "").toUpperCase();
  doc.setFontSize(9);
  doc.setFont("courier", "bold");
  const badgeW = doc.getTextWidth(levelLabel) + 8;
  doc.setDrawColor(...rc);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN + 24, y + 1, badgeW, 7, 2, 2, "D");
  doc.setTextColor(...rc);
  doc.text(levelLabel, MARGIN + 28, y + 6);
  y += 13;

  const stats: Array<[string, string]> = [
    ["Rainfall 48h", `${input.rainfall48hMm} mm`],
    ["Dry days", `${input.dryDays}`],
    ["Week mean temp", input.weekTempC == null ? "—" : `${input.weekTempC}°C`],
    ["Week mean wind", input.weekWindMs == null ? "—" : `${input.weekWindMs} m/s`],
  ];
  const boxW = (CONTENT_W - 9) / 4;
  need(24);
  stats.forEach(([label, value], i) => {
    const bx = MARGIN + i * (boxW + 3);
    doc.setFillColor(...INK.panel);
    doc.setDrawColor(...INK.line);
    doc.setLineWidth(0.3);
    doc.roundedRect(bx, y, boxW, 20, 2, 2, "FD");
    text(label, bx + 3, y + 6, { size: 7.5, color: INK.faint });
    text(value, bx + 3, y + 13.5, { size: 10.5, font: "courier" });
  });
  y += 25;

  if (input.signals.length) {
    input.signals.slice(0, 5).forEach((signal) => {
      const lines = wrapped(`→  ${signal}`, CONTENT_W - 4, 9);
      need(lines.length * 4.5 + 1);
      doc.setFontSize(9);
      doc.setTextColor(...INK.secondary);
      doc.setFont("helvetica", "normal");
      doc.text(lines, MARGIN + 2, y);
      y += lines.length * 4.5 + 1;
    });
    y += 2;
  }
  if (input.past30d) paragraph(input.past30d, 8, INK.faint);
  if (input.methodLine) paragraph(input.methodLine, 8, INK.faint);

  // ---- Trajectory chart ----
  if (input.trajectory.length >= 2) {
    need(62);
    kicker("RISK TRAJECTORY");
    const plotX = MARGIN;
    const plotW = CONTENT_W;
    const plotH = 38;
    const plotY = y;
    const maxV = Math.max(0.2, ...input.trajectory.map((d) => d.risk));
    doc.setFontSize(7);
    doc.setTextColor(...INK.faint);
    doc.setFont("courier", "normal");
    [0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
      const gy = plotY + plotH - frac * plotH;
      doc.setDrawColor(40, 70, 85);
      doc.setLineWidth(0.2);
      if (frac > 0) doc.setLineDashPattern([1.5, 1.5], 0);
      doc.line(plotX, gy, plotX + plotW, gy);
      doc.setLineDashPattern([], 0);
      doc.text(`${Math.round(frac * 100)}`, plotX - 2, gy + 1, { align: "right" });
    });
    const px = (i: number) => plotX + (i / (input.trajectory.length - 1)) * plotW;
    const py = (v: number) => plotY + plotH - Math.min(1, Math.max(0, v / maxV)) * plotH;
    doc.setDrawColor(...INK.cyan);
    doc.setLineWidth(0.8);
    input.trajectory.forEach((d, i) => {
      if (i > 0) doc.line(px(i - 1), py(input.trajectory[i - 1].risk), px(i), py(d.risk));
    });
    doc.setFillColor(...INK.cyan);
    input.trajectory.forEach((d, i) => doc.circle(px(i), py(d.risk), 1.4, "F"));
    doc.setFontSize(7.5);
    doc.setTextColor(...INK.faint);
    input.trajectory.forEach((d, i) => {
      if (i % 2 === 0 || i === input.trajectory.length - 1) {
        doc.text(d.date.slice(5), px(i), plotY + plotH + 5, { align: "center" });
      }
    });
    y = plotY + plotH + 11;
  }

  // ---- Model prediction ----
  if (input.modelEstimate) {
    const m = input.modelEstimate;
    need(50);
    kicker("MODEL PREDICTION · EXPERIMENTAL");
    text(`${Math.round(m.pct)}%`, MARGIN, y + 8, { size: 24, style: "bold", color: INK.violet });
    text(`CI ${Math.round(m.ciLo)}–${Math.round(m.ciHi)}%`, MARGIN + 26, y + 8, { size: 10, color: INK.secondary, font: "courier" });
    y += 13;
    m.drivers.slice(0, 5).forEach((driver) => {
      const lines = wrapped(`${driver.human} — ${driver.contribution}`, CONTENT_W - 4, 9);
      need(lines.length * 4.5 + 1);
      doc.setFontSize(9);
      doc.setTextColor(...INK.secondary);
      doc.setFont("helvetica", "normal");
      doc.text(lines, MARGIN + 2, y);
      y += lines.length * 4.5 + 1;
    });
    y += 1;
    if (m.trainingLine) paragraph(m.trainingLine, 8, INK.faint);
    if (m.caveats) paragraph(m.caveats, 8, INK.faint);
  }

  // ---- Report sections: headings lead, body smaller, italic, centered ----
  need(14);
  kicker(`GROUNDED REPORT${input.provider ? ` · ${input.provider.toUpperCase()}` : ""}`);
  const HEADINGS = ["What", "Why", "Cause→effect chain", "What to check next", "Disclaimer"];
  input.reportText.split("\n").forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      y += 2;
      return;
    }
    if (HEADINGS.includes(line.trim())) {
      need(11);
      text(line.trim(), MARGIN, y + 4, { size: 12.5, style: "bold" });
      y += 9;
    } else {
      paragraph(line, 9, INK.secondary, 4.2, "center", "italic");
      y -= 2;
    }
  });

  // ---- Footers ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...INK.faint);
    doc.setFont("helvetica", "normal");
    doc.text("BloomCast outputs are advisory support and never a safety determination.", MARGIN, PAGE_H - 10);
    doc.text(`${i}/${pages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
  }

  const safe = (n: number) => n.toFixed(2).replace("-", "m");
  doc.save(`bloomcast-report-${safe(input.latitude)}_${safe(input.longitude)}.pdf`);
}
