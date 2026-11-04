/** Calls `make` again only when an argument is not the one, by identity, of the last call. */
export function memo<A extends unknown[], R>(make: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | undefined;
  return (...args) => {
    if (!last || args.some((arg, i) => arg !== last!.args[i])) last = { args, value: make(...args) };
    return last.value;
  };
}
