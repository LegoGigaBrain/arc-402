import { c } from "./colors";

export interface TreeItem {
  label: string;
  value: string;
  last?: boolean;
}

export function renderTree(items: TreeItem[]): void {
  items.forEach((item, i) => {
    const isLast = item.last ?? (i === items.length - 1);
    const branch = isLast ? "└" : "├";
    const paddedLabel = item.label.padEnd(10);
    console.log(` ${c.dim(branch)} ${c.dim(paddedLabel)} ${c.white(item.value)}`);
  });
}
