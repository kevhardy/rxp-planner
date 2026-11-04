export function wholeRowsHeight(body: HTMLElement, rows: string, top: number, room: number): number {
  const rule = parseFloat(getComputedStyle(body).borderBottomWidth) || 0;
  let end = 0;
  for (const row of body.querySelectorAll(rows)) {
    const bottom = row.getBoundingClientRect().bottom - top + body.scrollTop + rule;
    if (bottom <= room && bottom > end) end = bottom;
  }
  return end || rule;
}
