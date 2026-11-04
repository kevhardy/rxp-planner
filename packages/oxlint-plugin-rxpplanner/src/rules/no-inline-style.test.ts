import { checkExamples } from "../examples.ts";
import rule from "./no-inline-style.ts";

checkExamples("no-inline-style", rule, [
  { name: "S01", code: "const mark = <span style={{ left: `${x}%` }} />;", reports: [["left", 29]], tsx: true },
  { name: "S02", code: 'const box = <div style={{ "--at-x": "12px" }} />;', reports: [['"12px"', 37]], tsx: true },
  { name: "S03", code: 'const box = <div style={{ "--fade": 0.5 }} />;', reports: [["0.5", 37]], tsx: true },
  { name: "S04", code: "const box = <div style={place} />;", reports: [["place", 25]], tsx: true },
  { name: "S05", code: "const box = <div style={{ ...vars }} />;", reports: [["...vars", 27]], tsx: true },
  { name: "S06", code: 'const box = <div style="color: red" />;', reports: [['"color: red"', 24]], tsx: true },
  { name: "S07", code: 'const box = <div style={{ ["--fill" as string]: fill }} />;', reports: [['"--fill" as string', 28]], tsx: true },
  { name: "S08", code: 'el.style.setProperty("--zoom", "2");', reports: [['"2"', 32]] },
  { name: "S09", code: 'el.style.setProperty("left", `${x}px`);', reports: [['"left"', 22]] },
  { name: "S10", code: "const mark = <span style={{ \"--at-x\": `${x}%`, '--at-y': `${y}%` }} />;", tsx: true },
  { name: "S11", code: 'const area = <g style={{ "--fill": color }} />;', tsx: true },
  { name: "S12", code: "const view = <div style={{ [`--zoom`]: zoom.s }} />;", tsx: true },
  { name: "S13", code: "el.style.setProperty(name, value);" },
  { name: "S14", code: 'root.setProperty("--icon-sheet", `url("${url}")`);' },
  { name: "S15", code: 'const scene = <InteriorImage style="plan" />;', reports: [['"plan"', 36]], tsx: true },
  { name: "S16", code: 'const pin = <Card vars={{ "--fade": 0.5 }} />;', reports: [["0.5", 37]], tsx: true },
  { name: "S17", code: 'const v = { top: "10px" }; const box = <Card vars={v} />;', reports: [["v", 52]], tsx: true },
  { name: "S18", code: 'const box = <div style={{ "--text": ink }} />;', reports: [['"--text"', 27]], tsx: true },
  { name: "S19", code: 'const box = <Card vars={{ "--space-3": gap }} />;', reports: [['"--space-3"', 27]], tsx: true },
  { name: "S20", code: 'el.style.setProperty("--kind-accept", ink);', reports: [['"--kind-accept"', 22]] },
  { name: "S21", code: 'CSS.registerProperty({ name: "--text", syntax: "<color>", inherits: true });', reports: [['"--text"', 30]] },
  { name: "S22", code: 'CSS.registerProperty({ name: "--at-x", syntax: "<length>", inherits: false, initialValue: "0px" });' },
  { name: "S23", code: 'const v = { "--control-small": "100px" }; const box = <Card vars={v} />;', reports: [["v", 67]], tsx: true },
]);
