export type NodeType = 'root' | 'box' | 'text';

export interface DOMNode {
  type: NodeType;
  parent: DOMNode | null;
  children: DOMNode[];

  // For 'box' nodes
  style?: import('./layout.js').BoxStyle;

  // For 'text' nodes
  text?: string;
  textStyle?: {
    fg?: import('./cell.js').Color | null;
    bg?: import('./cell.js').Color | null;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
  };
}

export function createNode(type: NodeType): DOMNode {
  return { type, parent: null, children: [] };
}

export function appendChild(parent: DOMNode, child: DOMNode): void {
  child.parent = parent;
  parent.children.push(child);
}

export function removeChild(parent: DOMNode, child: DOMNode): void {
  const idx = parent.children.indexOf(child);
  if (idx !== -1) {
    parent.children.splice(idx, 1);
    child.parent = null;
  }
}

export function insertBefore(parent: DOMNode, child: DOMNode, before: DOMNode): void {
  const idx = parent.children.indexOf(before);
  if (idx !== -1) {
    parent.children.splice(idx, 0, child);
    child.parent = parent;
  } else {
    appendChild(parent, child);
  }
}
