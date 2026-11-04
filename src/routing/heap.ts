/**
 * A binary min-heap of ids by cost. It is not stable: ids of equal cost pop in an order that the heap's shape sets, not
 * the push order. So a search that must break ties the same way each time pushes in a fixed order.
 */
export class Heap {
  entries: { id: number; cost: number }[] = [];
  push(id: number, cost: number): void {
    const item = { id, cost };
    let i = this.entries.length;
    this.entries.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1,
        parent = this.entries[p];
      if (!parent || parent.cost <= cost) break;
      this.entries[i] = parent;
      i = p;
    }
    this.entries[i] = item;
  }
  pop(): { id: number; cost: number } | undefined {
    const first = this.entries[0],
      last = this.entries.pop();
    if (!this.entries.length || !last) return first;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      const left = this.entries[child],
        right = this.entries[child + 1];
      if (!left) break;
      if (right && right.cost < left.cost) child++;
      const next = this.entries[child];
      if (!next || next.cost >= last.cost) break;
      this.entries[i] = next;
      i = child;
    }
    this.entries[i] = last;
    return first;
  }
}
