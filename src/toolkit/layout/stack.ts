export interface LayoutRect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface StackItem<Key extends string = string> {
  readonly key: Key;
  readonly rect: LayoutRect;
}

export interface StackedItem<Key extends string = string> extends StackItem<Key> {
  readonly dx: number;
  readonly dy: number;
}

export function translateRect(rect: LayoutRect, dx: number, dy: number): LayoutRect {
  return {
    x1: rect.x1 + dx,
    y1: rect.y1 + dy,
    x2: rect.x2 + dx,
    y2: rect.y2 + dy,
  };
}

export function unionRect(a: LayoutRect | undefined, b: LayoutRect): LayoutRect {
  if (a === undefined) return b;
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

export function unionRects(rects: Iterable<LayoutRect>): LayoutRect | undefined {
  let out: LayoutRect | undefined;
  for (const rect of rects) out = unionRect(out, rect);
  return out;
}

export function stackVertical<Key extends string>(
  items: readonly StackItem<Key>[],
  opts: { readonly gap: number },
): StackedItem<Key>[] {
  const stacked: StackedItem<Key>[] = [];
  let cursorBottom: number | undefined;

  for (const item of items) {
    const dy = cursorBottom === undefined ? 0 : cursorBottom + opts.gap - item.rect.y1;
    const rect = translateRect(item.rect, 0, dy);
    stacked.push({ ...item, rect, dx: 0, dy });
    cursorBottom = rect.y2;
  }

  return stacked;
}
