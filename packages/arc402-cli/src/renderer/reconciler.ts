// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactReconciler = require('react-reconciler');
import { DOMNode, createNode, appendChild, removeChild, insertBefore } from './dom.js';
import type { BoxStyle } from './layout.js';
import type { Color } from './cell.js';

// Props types
interface BoxProps { style?: BoxStyle; children?: unknown; }
interface TextProps {
  color?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  children?: unknown;
}
type Props = BoxProps | TextProps;

let onCommit: (() => void) | null = null;

export function setOnCommit(fn: () => void): void {
  onCommit = fn;
}

function applyProps(node: DOMNode, props: Props): void {
  if (node.type === 'box') {
    const boxProps = props as BoxProps;
    if (boxProps.style !== undefined) {
      node.style = boxProps.style;
    }
  } else if (node.type === 'text') {
    const textProps = props as TextProps;
    node.textStyle = {
      fg: textProps.color ?? null,
      bold: textProps.bold,
      dim: textProps.dim,
      italic: textProps.italic,
      underline: textProps.underline,
    };
  }
}

// react-reconciler v0.26.x host config
const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  now: Date.now,

  createInstance(type: string, props: Props): DOMNode {
    const node = createNode(type === 'arc-text' ? 'text' : 'box');
    applyProps(node, props);
    return node;
  },

  createTextInstance(text: string): DOMNode {
    const node = createNode('text');
    node.text = text;
    return node;
  },

  appendInitialChild: appendChild,
  appendChild,
  insertBefore,
  removeChild,
  appendChildToContainer: appendChild,
  insertInContainerBefore: insertBefore,
  removeChildFromContainer: removeChild,

  prepareForCommit() { return null; },

  resetAfterCommit() {
    if (onCommit) onCommit();
  },

  getPublicInstance(instance: DOMNode) { return instance; },
  getRootHostContext() { return {}; },
  getChildHostContext() { return {}; },
  shouldSetTextContent() { return false; },
  finalizeInitialChildren() { return false; },
  prepareUpdate() { return {}; },

  commitUpdate(node: DOMNode, _updatePayload: unknown, _type: string, _oldProps: Props, newProps: Props) {
    applyProps(node, newProps);
  },

  commitTextUpdate(node: DOMNode, _old: string, newText: string) {
    node.text = newText;
  },

  clearContainer() {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,

  // v0.26 specific
  getInstanceFromNode() { return null; },
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  preparePortalMount() {},
  getInstanceFromScope() { return null; },
  detachDeletedInstance() {},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciler: any = ReactReconciler(hostConfig);
