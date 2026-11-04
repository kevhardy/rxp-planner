import { checkExamples } from "../examples.ts";
import rule from "./no-raw-control.ts";

checkExamples("no-raw-control", rule, [
  { name: "B01", code: 'const save = <button type="button">Save</button>;', reports: [['<button type="button">', 14]], tsx: true },
  { name: "B02", code: "const close = <button />;", reports: [["<button />", 15]], tsx: true },
  {
    name: "B03",
    code: 'const bar = <div><button type="submit" /><button type="button" /></div>;',
    reports: [
      ['<button type="submit" />', 18],
      ['<button type="button" />', 42],
    ],
    tsx: true,
  },
  { name: "B04", code: 'const save = <Button variant="primary">Save</Button>;', tsx: true },
  { name: "B05", code: 'const close = <IconButton icon="x" label="Close" />;', tsx: true },
  { name: "B06", code: "const custom = <ui.button />;", tsx: true },
  { name: "B07", code: 'const tag = "button"; const html = "<button>";' },
  { name: "B08", code: 'const el = document.createElement("button");' },
  { name: "B09", code: 'const zone = <input value="Elwynn Forest" />;', reports: [['<input value="Elwynn Forest" />', 14]], tsx: true },
  { name: "B10", code: 'const tag = <input type="checkbox" checked />;', reports: [['<input type="checkbox" checked />', 13]], tsx: true },
  {
    name: "B11",
    code: 'const speed = <select value="1"><option value="1">1x</option></select>;',
    reports: [['<select value="1">', 15]],
    tsx: true,
  },
  { name: "B12", code: "const raw = <textarea rows={4} />;", reports: [["<textarea rows={4} />", 13]], tsx: true },
  { name: "B13", code: 'const zone = <Input value="Elwynn Forest" />;', tsx: true },
  { name: "B14", code: 'const speed = <Select value="1"><option value="1">1x</option></Select>;', tsx: true },
  { name: "B15", code: 'const tag = <Checkbox label="Optional" checked />;', tsx: true },
  { name: "B16", code: 'const list = <datalist id="zones"><option value="Elwynn Forest" /></datalist>;', tsx: true },
]);
