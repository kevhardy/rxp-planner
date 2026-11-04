/** An amount of copper as the game shows it, such as `1g 2s 3c`. */
export function moneyText(copper: number): string {
  const parts = [
    [Math.floor(copper / 10_000), "g"],
    [Math.floor(copper / 100) % 100, "s"],
    [copper % 100, "c"],
  ] as const;
  return parts.flatMap(([n, unit]) => (n > 0 ? [`${n}${unit}`] : [])).join(" ") || "0c";
}
