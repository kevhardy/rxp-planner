/**
 * The tallest border-box height of `body`, up to `room`, whose content ends at
 * the bottom of a whole `rows` match. The bottom border of `body` is the
 * gutter below that row, and a scroller paints no content there.
 */
export function wholeRowsHeight(body: HTMLElement, rows: string, room: number): number {
  const rule = parseFloat(getComputedStyle(body).borderBottomWidth) || 0;
  const top = body.getBoundingClientRect().top - body.scrollTop;
  let end = 0;
  for (const row of body.querySelectorAll(rows)) {
    const bottom = row.getBoundingClientRect().bottom - top + rule;
    if (bottom <= room && bottom > end) end = bottom;
  }
  return end || rule;
}
